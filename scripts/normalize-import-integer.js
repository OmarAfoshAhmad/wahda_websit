const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function familySuffixRegex(baseCard) {
  return `^${escapeRegex(baseCard)}[A-Z][0-9]+$`;
}

function chooseRemainderRecipientIndex(recipients, remainder) {
  if (!Array.isArray(recipients) || recipients.length === 0) return 0;
  if (remainder <= 0) return 0;

  let bestIndex = 0;
  let bestIsActive = false;
  let bestBalance = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < recipients.length; i++) {
    const isActive = String(recipients[i].status || "") === "ACTIVE";
    const balance = Number(recipients[i].availableBalance || 0);
    if ((isActive && !bestIsActive) || (isActive === bestIsActive && balance > bestBalance)) {
      bestIsActive = isActive;
      bestBalance = balance;
      bestIndex = i;
    }
  }

  return bestIndex;
}

async function getFacilityId() {
  const configured = (process.env.WAAD_FACILITY_ID || "").trim();
  if (configured) {
    const ok = await prisma.facility.findFirst({ where: { id: configured, deleted_at: null }, select: { id: true } });
    if (ok?.id) return ok.id;
  }
  const any = await prisma.facility.findFirst({ where: { deleted_at: null }, select: { id: true }, orderBy: { created_at: "asc" } });
  if (!any?.id) throw new Error("No active facility found for IMPORT create fallback");
  return any.id;
}

async function main() {
  const facilityId = await getFacilityId();

  console.log(DRY_RUN ? "=== DRY RUN: NORMALIZE IMPORT INTEGER ===" : "=== EXECUTE: NORMALIZE IMPORT INTEGER ===");

  const families = await prisma.$queryRaw`
    WITH family_imports AS (
      SELECT
        REGEXP_REPLACE(b.card_number, '([A-Z][0-9]+)$', '') AS family_base_card,
        t.id,
        t.beneficiary_id,
        t.amount
      FROM "Transaction" t
      JOIN "Beneficiary" b ON b.id = t.beneficiary_id
      WHERE t.type = 'IMPORT'
        AND t.is_cancelled = false
        AND b.deleted_at IS NULL
    )
    SELECT family_base_card
    FROM family_imports
    WHERE family_base_card ~ '^WAB[0-9]+$'
    GROUP BY family_base_card
    HAVING BOOL_OR(ABS(amount - ROUND(amount)) > 0.000001)
    ORDER BY family_base_card
  `;

  console.log("families_with_fractional_import:", families.length);

  let processedFamilies = 0;
  let processedMembers = 0;
  let updatedTx = 0;
  let createdTx = 0;
  let cancelledTx = 0;

  for (const f of families) {
    const baseCard = String(f.family_base_card || "").trim();
    if (!baseCard) continue;

    await prisma.$transaction(async (tx) => {
      const members = await tx.$queryRaw`
        SELECT id, name, card_number, remaining_balance, status::text, completed_via
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          AND (
            card_number = ${baseCard}
            OR card_number ~ ${familySuffixRegex(baseCard)}
          )
        ORDER BY card_number ASC
        FOR UPDATE
      `;

      if (!Array.isArray(members) || members.length === 0) return;

      const memberIds = members.map((m) => m.id);
      const imports = await tx.transaction.findMany({
        where: {
          beneficiary_id: { in: memberIds },
          type: "IMPORT",
          is_cancelled: false,
        },
        orderBy: { created_at: "asc" },
        select: { id: true, beneficiary_id: true, amount: true },
      });

      if (imports.length === 0) return;

      const totalUsed = Math.max(0, Math.round(imports.reduce((s, it) => s + Number(it.amount), 0)));
      const divisor = Math.max(1, members.length);
      const baseShare = Math.floor(totalUsed / divisor);
      const remainder = totalUsed - baseShare * divisor;

      const byMember = new Map();
      for (const imp of imports) {
        const arr = byMember.get(imp.beneficiary_id) || [];
        arr.push({ id: imp.id, amount: Number(imp.amount) });
        byMember.set(imp.beneficiary_id, arr);
      }

      const pre = members.map((m) => {
        const existing = byMember.get(m.id) || [];
        const previousImported = existing.reduce((s, e) => s + Number(e.amount), 0);
        const balanceBeforeImport = round2(Number(m.remaining_balance) + previousImported);
        return { m, existing, balanceBeforeImport };
      });

      const remIdx = chooseRemainderRecipientIndex(
        pre.map((x) => ({ status: String(x.m.status || ""), availableBalance: x.balanceBeforeImport })),
        remainder,
      );

      for (let i = 0; i < pre.length; i++) {
        const { m, existing, balanceBeforeImport } = pre[i];
        const deductAmount = i === remIdx ? baseShare + remainder : baseShare;
        const newBalance = round2(Math.max(0, balanceBeforeImport - deductAmount));
        const newStatus = String(m.status) === "SUSPENDED" ? "SUSPENDED" : (newBalance <= 0 ? "FINISHED" : "ACTIVE");

        if (!DRY_RUN) {
          await tx.beneficiary.update({
            where: { id: m.id },
            data: {
              remaining_balance: newBalance,
              status: newStatus,
              completed_via: newStatus === "FINISHED" ? "IMPORT" : (newStatus === "SUSPENDED" ? m.completed_via : null),
            },
          });
        }

        if (existing.length === 0) {
          if (deductAmount > 0) {
            if (!DRY_RUN) {
              await tx.transaction.create({
                data: {
                  beneficiary_id: m.id,
                  facility_id: facilityId,
                  amount: deductAmount,
                  type: "IMPORT",
                },
              });
            }
            createdTx++;
          }
        } else {
          if (!DRY_RUN) {
            await tx.transaction.update({ where: { id: existing[0].id }, data: { amount: deductAmount } });
          }
          updatedTx++;

          if (existing.length > 1) {
            const extraIds = existing.slice(1).map((x) => x.id);
            if (!DRY_RUN) {
              const cancelled = await tx.transaction.updateMany({ where: { id: { in: extraIds }, is_cancelled: false }, data: { is_cancelled: true } });
              cancelledTx += cancelled.count;
            } else {
              cancelledTx += extraIds.length;
            }
          }
        }

        processedMembers++;
      }

      processedFamilies++;
    }, {
      maxWait: 20000,
      timeout: 120000,
    });
  }

  console.log("processed_families:", processedFamilies);
  console.log("processed_members:", processedMembers);
  console.log("updated_transactions:", updatedTx);
  console.log("created_transactions:", createdTx);
  console.log("cancelled_transactions:", cancelledTx);

  const remainingFractional = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS c
    FROM "Transaction"
    WHERE type='IMPORT' AND is_cancelled=false
      AND ABS(amount - ROUND(amount)) > 0.001
  `;
  console.log("fractional_remaining:", remainingFractional[0].c);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
