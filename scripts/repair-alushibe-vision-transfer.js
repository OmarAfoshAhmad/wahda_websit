"use strict";

const IDS = {
  beneficiary: "cmpzp12yb0e87p40r5rraywfx",
  visionCompany: "cmpzo9j4g0003p4i9ttjrbjex",
  alushibeCompany: "cmr7pcs3c03zuk30rwwlu2ej3",
  superAdmin: "cmpzni5sz0000p409a825wxqs",
  originalTransactions: ["cmq9c1gmz004eri0rl3gdx1t9", "cmqta6dxq01p9k30r1eu92kpj"],
  duplicateTransaction: "cmrbxrneu04fwk30rn1pesc2i",
};

function assertExpectedRows(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const expected = [
    { id: IDS.originalTransactions[0], amount: 360, companyId: IDS.visionCompany },
    { id: IDS.originalTransactions[1], amount: 300, companyId: IDS.visionCompany },
    { id: IDS.duplicateTransaction, amount: 360, companyId: IDS.alushibeCompany },
  ];
  for (const item of expected) {
    const row = byId.get(item.id);
    if (!row) throw new Error(`Expected transaction is missing: ${item.id}`);
    if (row.beneficiary_id !== IDS.beneficiary) throw new Error(`Beneficiary mismatch: ${item.id}`);
    if (Number(row.amount) !== item.amount) throw new Error(`Amount mismatch: ${item.id}`);
    if (row.company_id !== item.companyId) throw new Error(`Company mismatch: ${item.id}`);
    if (row.is_cancelled || row.type !== "DENTAL") throw new Error(`Transaction is not an active dental movement: ${item.id}`);
  }
}

async function main() {
  const { Client } = await import("pg");
  const { randomUUID } = await import("node:crypto");
  const { assertTestDatabase } = await import("./assert-test-database.js");
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assertTestDatabase(databaseUrl);
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const rows = await client.query(
      `SELECT id, beneficiary_id, company_id, amount::text, type::text, is_cancelled,
              facility_id, created_at, service_category, ceiling_consumed::text,
              consumed_before::text, consumed_after::text, policy_snapshot
       FROM "Transaction" WHERE id = ANY($1::text[]) ORDER BY created_at, id`,
      [[...IDS.originalTransactions, IDS.duplicateTransaction]],
    );
    assertExpectedRows(rows.rows);
    const existingCancellation = await client.query(
      `SELECT id FROM "Transaction" WHERE original_transaction_id=$1 AND type='CANCELLATION' AND is_cancelled=false`,
      [IDS.duplicateTransaction],
    );
    if (existingCancellation.rowCount) throw new Error("The duplicate movement already has an active cancellation.");
    const preview = {
      mode: apply ? "apply" : "preview",
      beneficiaryId: IDS.beneficiary,
      moveToAlushibe: IDS.originalTransactions,
      cancelDuplicate: IDS.duplicateTransaction,
      uniqueDentalConsumption: 660,
      expectedDentalRemaining: 2340,
      before: rows.rows,
    };
    if (!apply) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const locked = await client.query(
        `SELECT id, beneficiary_id, company_id, amount::text, type::text, is_cancelled,
                facility_id, created_at, service_category, ceiling_consumed::text,
                consumed_before::text, consumed_after::text, policy_snapshot
         FROM "Transaction" WHERE id = ANY($1::text[]) ORDER BY created_at, id FOR UPDATE`,
        [[...IDS.originalTransactions, IDS.duplicateTransaction]],
      );
      assertExpectedRows(locked.rows);
      const admin = await client.query(
        `SELECT id,username FROM "Facility" WHERE id=$1 AND role_v2='SUPER_ADMIN' AND deleted_at IS NULL FOR UPDATE`,
        [IDS.superAdmin],
      );
      if (admin.rowCount !== 1 || admin.rows[0].username !== "admin") {
        throw new Error("Confirmed SUPER_ADMIN account is unavailable.");
      }
      const cancellationId = randomUUID();
      await client.query(
        `UPDATE "Transaction" SET company_id=$1 WHERE id=ANY($2::text[])`,
        [IDS.alushibeCompany, IDS.originalTransactions],
      );
      await client.query(`UPDATE "Transaction" SET is_cancelled=true WHERE id=$1`, [IDS.duplicateTransaction]);
      await client.query(
        `INSERT INTO "Transaction" (
           id,beneficiary_id,facility_id,amount,type,created_at,is_cancelled,
           original_transaction_id,company_id,service_category,ceiling_consumed
         ) VALUES ($1,$2,$3,-360,'CANCELLATION',NOW(),false,$4,$5,'DENTAL',-360)`,
        [cancellationId, IDS.beneficiary, IDS.superAdmin, IDS.duplicateTransaction, IDS.alushibeCompany],
      );
      await client.query(
        `INSERT INTO "WalletConsumption" (
           id,beneficiary_id,company_id,wallet_type,fiscal_year,consumed_amount,version,created_at,updated_at
         ) VALUES ($1,$2,$3,'DENTAL',2026,660,1,NOW(),NOW())
         ON CONFLICT (beneficiary_id,company_id,wallet_type,fiscal_year)
         DO UPDATE SET consumed_amount=660,version="WalletConsumption".version+1,updated_at=NOW()`,
        [randomUUID(), IDS.beneficiary, IDS.alushibeCompany],
      );
      await client.query(
        `INSERT INTO "AuditLog" (id,"user",action,metadata,created_at,facility_id,company_id)
         VALUES ($1,'admin','REPAIR_ALUSHIBE_VISION_TRANSFER',$2::jsonb,NOW(),$3,$4)`,
        [
          randomUUID(),
          JSON.stringify({
            beneficiary_id: IDS.beneficiary,
            moved_transaction_ids: IDS.originalTransactions,
            cancelled_duplicate_transaction_id: IDS.duplicateTransaction,
            cancellation_transaction_id: cancellationId,
            consumed_after: 660,
            expected_remaining_after: 2340,
            before: locked.rows,
            reason: "Confirmed duplicate manual entry after transferring employees from Vision to Alushibe",
          }),
          IDS.superAdmin,
          IDS.alushibeCompany,
        ],
      );
      await client.query("COMMIT");
      process.stdout.write(`${JSON.stringify({ ...preview, cancellationId, applied: true }, null, 2)}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Transfer repair failed: ${error.message}`);
  process.exitCode = 1;
});
