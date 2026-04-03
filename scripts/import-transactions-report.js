/* eslint-disable no-console */
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const { PrismaClient, TransactionType } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    file: "transactions-report.xlsx",
    apply: false,
    adminUsername: "admin",
    timeAsUtc: false,
    linkExistingCancellations: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file" && argv[i + 1]) {
      out.file = argv[++i];
    } else if (arg.startsWith("--file=")) {
      out.file = arg.slice("--file=".length);
    } else if (arg === "--apply") {
      out.apply = true;
    } else if (arg === "--admin" && argv[i + 1]) {
      out.adminUsername = argv[++i];
    } else if (arg.startsWith("--admin=")) {
      out.adminUsername = arg.slice("--admin=".length);
    } else if (arg === "--time-as-utc") {
      out.timeAsUtc = true;
    } else if (arg === "--link-existing-cancellations") {
      out.linkExistingCancellations = true;
    }
  }

  return out;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  const s = String(value ?? "").trim().replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseDateTime(dateValue, timeValue, useUtc) {
  const dateStr = String(dateValue ?? "").trim();
  const timeStr = String(timeValue ?? "").trim();

  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);

  let hour = 0;
  let minute = 0;
  let second = 0;

  if (timeStr) {
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!timeMatch) return null;
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] ?? "0");
  }

  if (useUtc) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  // Preserve wall-clock time as local server time.
  return new Date(year, month - 1, day, hour, minute, second);
}

function mapTransactionType(typeText, amount) {
  const t = normalizeText(typeText);

  if (amount < 0) return TransactionType.CANCELLATION;
  if (t.includes("ادوية")) return TransactionType.MEDICINE;
  return TransactionType.SUPPLIES;
}

function buildFacilityUsername(name, used) {
  const hash = crypto.createHash("sha1").update(name).digest("hex").slice(0, 12);
  const base = `import_${hash}`;

  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let idx = 2;
  while (used.has(`${base}_${idx}`)) idx++;
  const username = `${base}_${idx}`;
  used.add(username);
  return username;
}

async function readRows(filePath, options = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const ws = workbook.worksheets[0];
  if (!ws) throw new Error("Excel workbook has no worksheets");

  const rows = [];
  const warnings = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const txId = String(row.getCell(1).value ?? "").trim();
    const beneficiaryName = String(row.getCell(2).value ?? "").trim();
    const cardNumber = String(row.getCell(3).value ?? "").trim().toUpperCase();
    const amount = parseNumber(row.getCell(4).value);
    const remaining = parseNumber(row.getCell(5).value);
    const typeText = String(row.getCell(6).value ?? "").trim();
    const dateValue = row.getCell(7).value;
    const timeValue = row.getCell(8).value;
    const facilityName = String(row.getCell(9).value ?? "").trim();

    if (!txId || !txId.startsWith("c")) return;
    if (!cardNumber || !beneficiaryName) {
      warnings.push(`row ${rowNumber}: missing card/name`);
      return;
    }
    if (!Number.isFinite(amount) || !Number.isFinite(remaining)) {
      warnings.push(`row ${rowNumber}: invalid amount/remaining`);
      return;
    }

    const createdAt = parseDateTime(dateValue, timeValue, Boolean(options.timeAsUtc));
    if (!createdAt) {
      warnings.push(`row ${rowNumber}: invalid date/time ${String(dateValue)} ${String(timeValue)}`);
      return;
    }

    rows.push({
      rowNumber,
      txId,
      beneficiaryName,
      cardNumber,
      amount,
      remaining,
      typeText,
      facilityName: facilityName || "System Admin",
      createdAt,
      txType: mapTransactionType(typeText, amount),
    });
  });

  return { rows, warnings };
}

function buildBeneficiarySnapshots(rows) {
  const byCard = new Map();

  for (const row of rows) {
    const existing = byCard.get(row.cardNumber);
    if (!existing) {
      byCard.set(row.cardNumber, {
        cardNumber: row.cardNumber,
        name: row.beneficiaryName,
        remaining: row.remaining,
        latestCreatedAt: row.createdAt,
        netAmount: row.amount,
      });
      continue;
    }

    existing.netAmount += row.amount;

    if (row.createdAt > existing.latestCreatedAt) {
      existing.name = row.beneficiaryName;
      existing.remaining = row.remaining;
      existing.latestCreatedAt = row.createdAt;
    }
  }

  return byCard;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);

  console.log("[import-report] file:", filePath);
  console.log("[import-report] mode:", args.apply ? "APPLY" : "DRY-RUN");
  console.log("[import-report] time parsing:", args.timeAsUtc ? "UTC" : "SERVER_LOCAL");
  console.log(
    "[import-report] cancellation linking:",
    args.linkExistingCancellations ? "ALLOW_EXISTING_TRANSACTIONS" : "ONLY_NEWLY_IMPORTED",
  );

  const { rows, warnings } = await readRows(filePath, { timeAsUtc: args.timeAsUtc });
  if (rows.length === 0) {
    throw new Error("No valid transaction rows found in report");
  }

  const admin = await prisma.facility.findUnique({
    where: { username: args.adminUsername },
    select: { id: true, username: true },
  });

  if (!admin) {
    throw new Error(`Admin facility '${args.adminUsername}' was not found`);
  }

  const snapshots = buildBeneficiarySnapshots(rows);
  const cardNumbers = [...snapshots.keys()];
  const txIds = rows.map((r) => r.txId);
  const facilityNames = [...new Set(rows.map((r) => r.facilityName))];

  const [existingFacilities, existingBeneficiaries, existingTransactions] = await Promise.all([
    prisma.facility.findMany({ where: { name: { in: facilityNames } }, select: { id: true, name: true, username: true } }),
    prisma.beneficiary.findMany({ where: { card_number: { in: cardNumbers } }, select: { id: true, card_number: true } }),
    prisma.transaction.findMany({ where: { id: { in: txIds } }, select: { id: true } }),
  ]);

  const existingFacilityByName = new Map(existingFacilities.map((f) => [f.name, f]));
  const existingBeneficiaryByCard = new Map(existingBeneficiaries.map((b) => [b.card_number, b]));
  const existingTxIds = new Set(existingTransactions.map((t) => t.id));

  const missingFacilityNames = facilityNames.filter((name) => !existingFacilityByName.has(name));
  const missingBeneficiaries = cardNumbers.filter((card) => !existingBeneficiaryByCard.has(card));
  const insertableRows = rows.filter((r) => !existingTxIds.has(r.txId));

  // Count unique beneficiaries whose balances will be affected
  const beneficiariesWithBalanceChange = new Set(
    insertableRows.map((r) => r.cardNumber),
  ).size;

  const summary = {
    totalRows: rows.length,
    warnings: warnings.length,
    facilitiesFound: existingFacilities.length,
    facilitiesToCreate: missingFacilityNames.length,
    beneficiariesFound: existingBeneficiaries.length,
    beneficiariesToCreate: missingBeneficiaries.length,
    transactionsExisting: existingTransactions.length,
    transactionsToInsert: insertableRows.length,
    beneficiariesBalanceUpdate: beneficiariesWithBalanceChange,
  };

  console.log("[import-report] summary:", summary);

  if (!args.apply) {
    console.log("[import-report] dry-run complete. Add --apply to execute import.");
    if (warnings.length > 0) {
      console.log("[import-report] warnings sample:");
      warnings.slice(0, 15).forEach((w) => console.log(" -", w));
    }
    return;
  }

  const usedUsernames = new Set(existingFacilities.map((f) => f.username));
  const defaultPasswordHash = await bcrypt.hash("ImportOnly-ChangeMe-2026", 10);

  await prisma.$transaction(async (tx) => {
    const facilityByName = new Map(existingFacilityByName);
    const beneficiaryByCard = new Map(existingBeneficiaryByCard);

    for (const name of missingFacilityNames) {
      const username = buildFacilityUsername(name, usedUsernames);
      const created = await tx.facility.create({
        data: {
          name,
          username,
          password_hash: defaultPasswordHash,
          is_admin: false,
          is_manager: false,
          must_change_password: true,
        },
        select: { id: true, name: true, username: true },
      });
      facilityByName.set(name, created);
    }

    for (const card of missingBeneficiaries) {
      const snap = snapshots.get(card);
      const remaining = Number(snap.remaining);
      const created = await tx.beneficiary.create({
        data: {
          card_number: card,
          name: snap.name,
          total_balance: 600,
          remaining_balance: remaining,
          status: remaining <= 0 ? "FINISHED" : "ACTIVE",
          ...(remaining <= 0 ? { completed_via: "IMPORT" } : {}),
        },
        select: { id: true, card_number: true },
      });
      beneficiaryByCard.set(card, created);
    }

    const createdTransactions = [];

    for (const row of insertableRows) {
      const beneficiary = beneficiaryByCard.get(row.cardNumber);
      const facility = facilityByName.get(row.facilityName) || facilityByName.get("System Admin");

      if (!beneficiary || !facility) {
        throw new Error(`Missing beneficiary/facility mapping for tx ${row.txId}`);
      }

      const created = await tx.transaction.create({
        data: {
          id: row.txId,
          beneficiary_id: beneficiary.id,
          facility_id: facility.id,
          amount: row.amount,
          type: row.txType,
          is_cancelled: false,
          created_at: row.createdAt,
        },
        select: {
          id: true,
          beneficiary_id: true,
          amount: true,
          type: true,
          created_at: true,
          is_cancelled: true,
        },
      });

      createdTransactions.push(created);
    }

    let candidateTxs = createdTransactions;
    if (args.linkExistingCancellations) {
      candidateTxs = await tx.transaction.findMany({
        where: {
          beneficiary_id: { in: [...new Set(createdTransactions.map((t) => t.beneficiary_id))] },
        },
        select: {
          id: true,
          beneficiary_id: true,
          amount: true,
          type: true,
          created_at: true,
          is_cancelled: true,
        },
        orderBy: [{ beneficiary_id: "asc" }, { created_at: "asc" }],
      });
    }

    let linkedCancellations = 0;

    for (const cancelTx of candidateTxs) {
      if (cancelTx.type !== TransactionType.CANCELLATION) continue;

      const targetAmount = Math.abs(Number(cancelTx.amount));
      if (targetAmount <= 0) continue;

      const original = [...candidateTxs]
        .reverse()
        .find((txItem) =>
          txItem.beneficiary_id === cancelTx.beneficiary_id &&
          txItem.type !== TransactionType.CANCELLATION &&
          !txItem.is_cancelled &&
          txItem.created_at <= cancelTx.created_at &&
          Math.abs(Number(txItem.amount) - targetAmount) < 0.0001,
        );

      if (!original) continue;

      await tx.transaction.update({
        where: { id: original.id },
        data: { is_cancelled: true },
      });

      await tx.transaction.update({
        where: { id: cancelTx.id },
        data: { original_transaction_id: original.id },
      });

      linkedCancellations++;
    }

    // ── Update beneficiary balances ──────────────────────────────
    // Compute net deduction per beneficiary from all inserted rows.
    // Positive amounts (MEDICINE/SUPPLIES) decrease balance.
    // Cancellations (negative amounts) increase balance back.
    const netByBeneficiaryId = new Map();

    for (const row of insertableRows) {
      const beneficiary = beneficiaryByCard.get(row.cardNumber);
      if (!beneficiary) continue;

      const current = netByBeneficiaryId.get(beneficiary.id) || 0;
      // row.amount is positive for normal tx, negative for cancellations
      netByBeneficiaryId.set(beneficiary.id, current + row.amount);
    }

    let updatedBeneficiaries = 0;

    for (const [beneficiaryId, netAmount] of netByBeneficiaryId) {
      if (Math.abs(netAmount) < 0.001) continue; // no net change

      const ben = await tx.beneficiary.findUnique({
        where: { id: beneficiaryId },
        select: { id: true, remaining_balance: true, total_balance: true, status: true },
      });
      if (!ben) continue;

      const currentBalance = Number(ben.remaining_balance);
      // netAmount is the total spent — subtract it from remaining
      const newBalance = Math.max(0, currentBalance - netAmount);
      const newStatus = newBalance <= 0 ? "FINISHED" : ben.status;

      await tx.beneficiary.update({
        where: { id: beneficiaryId },
        data: {
          remaining_balance: newBalance,
          status: newStatus,
          ...(newStatus === "FINISHED" && ben.status !== "FINISHED"
            ? { completed_via: "IMPORT" }
            : {}),
        },
      });

      updatedBeneficiaries++;
    }

    console.log("[import-report] updated beneficiary balances:", updatedBeneficiaries);

    await tx.auditLog.create({
      data: {
        facility_id: admin.id,
        user: admin.username,
        action: "IMPORT_TRANSACTIONS_REPORT",
        metadata: {
          source_file: path.basename(filePath),
          imported_rows: insertableRows.length,
          created_facilities: missingFacilityNames.length,
          created_beneficiaries: missingBeneficiaries.length,
          linked_cancellations: linkedCancellations,
          updated_beneficiaries: updatedBeneficiaries,
        },
      },
    });

    console.log("[import-report] import committed.");
    console.log("[import-report] linked cancellations:", linkedCancellations);
  });

  if (warnings.length > 0) {
    console.log("[import-report] warnings sample:");
    warnings.slice(0, 15).forEach((w) => console.log(" -", w));
  }
}

main()
  .catch((err) => {
    console.error("[import-report] failed:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
