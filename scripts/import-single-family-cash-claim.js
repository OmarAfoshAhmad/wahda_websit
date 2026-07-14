/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const ExcelJS = require("exceljs");
const { PrismaClient, Prisma, TransactionType } = require("@prisma/client");

const prisma = new PrismaClient();

const DEFAULT_DIR = path.resolve(__dirname, "المخصص كاش كليم طرابلس", "نتائج معالجة الحسميات");
const DEFAULT_GENERAL_FILE = path.join(DEFAULT_DIR, "حركات Cash Claim - الكشوفات - توزيع متساوي.xlsx");
const DEFAULT_MEDICINE_FILE = path.join(DEFAULT_DIR, "حركات Cash Claim - الأدوية - توزيع متساوي.xlsx");

function parseArgs(argv) {
  const args = {
    actor: "superadmin",
    dataDir: "",
    generalFile: DEFAULT_GENERAL_FILE,
    medicineFile: DEFAULT_MEDICINE_FILE,
    familyCard: "",
    invoiceId: "",
    confirmFamily: "",
    apply: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--actor") args.actor = argv[++index] || args.actor;
    else if (arg === "--data-dir") args.dataDir = path.resolve(argv[++index] || "");
    else if (arg === "--general-file") args.generalFile = path.resolve(argv[++index] || args.generalFile);
    else if (arg === "--medicine-file") args.medicineFile = path.resolve(argv[++index] || args.medicineFile);
    else if (arg === "--family-card") args.familyCard = String(argv[++index] || "").trim().toUpperCase();
    else if (arg === "--invoice-id") args.invoiceId = String(argv[++index] || "").trim();
    else if (arg === "--confirm-family") args.confirmFamily = String(argv[++index] || "").trim().toUpperCase();
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`وسيط غير معروف: ${arg}`);
  }

  if (args.dataDir) {
    args.generalFile = path.join(args.dataDir, "حركات Cash Claim - الكشوفات - توزيع متساوي.xlsx");
    args.medicineFile = path.join(args.dataDir, "حركات Cash Claim - الأدوية - توزيع متساوي.xlsx");
  }

  return args;
}

function printHelp() {
  console.log(`
استيراد Cash Claim لعائلة واحدة فقط (الوضع الافتراضي: معاينة بلا كتابة)

المعاينة حسب بطاقة العائلة:
  node scripts/import-single-family-cash-claim.js --family-card WAB2025104484

التنفيذ بعد مراجعة المعاينة وأخذ نسخة احتياطية:
  node scripts/import-single-family-cash-claim.js --family-card WAB2025104484 --apply --confirm-family WAB2025104484

معاينة فاتورة واحدة فقط:
  node scripts/import-single-family-cash-claim.js --invoice-id CC-100-6

خيارات:
  --actor superadmin         اسم حساب المشرف الذي تُنسب إليه العملية
  --data-dir <path>          مجلد ملفات Cash Claim المصححة
  --general-file <path>      ملف حركات الكشوفات
  --medicine-file <path>     ملف حركات الأدوية
  --family-card <card>       استيراد جميع فواتير عائلة واحدة
  --invoice-id <id>          استيراد فاتورة واحدة فقط
  --apply                    تفعيل الكتابة الفعلية
  --confirm-family <card>    تأكيد إلزامي مطابق لبطاقة العائلة عند --apply
`);
}

function text(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.result != null) return text(value.result);
    if (value.text != null) return String(value.text).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
  }
  return String(value).trim();
}

function money(value) {
  const parsed = Number(text(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`قيمة مالية غير صالحة: ${text(value)}`);
  return Math.round(parsed * 100) / 100;
}

function parseServiceDate(rawValue) {
  const raw = text(rawValue).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = raw.match(/^(\d{1,2})[\\/-](\d{1,2})[\\/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

async function readMovementFile(filePath, expectedType) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("الحركات") || workbook.worksheets[0];
  if (!sheet) throw new Error(`الملف لا يحتوي على ورقة حركات: ${filePath}`);

  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(text(cell.value), column));
  const required = [
    "معرف الحركة",
    "معرف الفاتورة",
    "نوع الخدمة",
    "رقم البطاقة",
    "اسم المستفيد",
    "المبلغ",
    "قيمة بند الفاتورة",
    "إجمالي الفاتورة",
    "رقم بطاقة العائلة",
    "الرصيد قبل الحركة",
    "الرصيد بعد الحركة",
    "الدفعة",
    "صف المصدر",
    "تاريخ الخدمة",
  ];
  for (const header of required) {
    if (!headers.has(header)) throw new Error(`العمود المطلوب غير موجود (${header}) في ${path.basename(filePath)}`);
  }

  const get = (row, header) => row.getCell(headers.get(header)).value;
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const movementId = text(get(row, "معرف الحركة"));
    if (!movementId) continue;
    const serviceType = text(get(row, "نوع الخدمة")).toUpperCase();
    if (serviceType !== expectedType) {
      throw new Error(`نوع الخدمة ${serviceType} غير متوقع في ${path.basename(filePath)} صف ${rowNumber}`);
    }
    rows.push({
      filePath,
      fileRow: rowNumber,
      movementId,
      invoiceId: text(get(row, "معرف الفاتورة")),
      serviceType,
      card: text(get(row, "رقم البطاقة")).toUpperCase(),
      beneficiaryName: text(get(row, "اسم المستفيد")),
      amount: money(get(row, "المبلغ")),
      componentInvoiceTotal: money(get(row, "قيمة بند الفاتورة")),
      fullInvoiceTotal: money(get(row, "إجمالي الفاتورة")),
      familyCard: text(get(row, "رقم بطاقة العائلة")).toUpperCase(),
      balanceBefore: money(get(row, "الرصيد قبل الحركة")),
      balanceAfter: money(get(row, "الرصيد بعد الحركة")),
      batch: Number(text(get(row, "الدفعة"))) || 0,
      sourceRow: Number(text(get(row, "صف المصدر"))) || 0,
      serviceDateRaw: text(get(row, "تاريخ الخدمة")),
      serviceDate: parseServiceDate(get(row, "تاريخ الخدمة")),
    });
  }
  return rows;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function validateFileRows(rows) {
  if (rows.length === 0) throw new Error("لا توجد حركات مطابقة للاختيار.");

  const movementIds = new Set();
  for (const row of rows) {
    if (!row.invoiceId || !row.card || !row.familyCard) throw new Error(`بيانات ناقصة في الحركة ${row.movementId}`);
    if (row.amount <= 0) throw new Error(`مبلغ الحركة غير موجب: ${row.movementId}`);
    if (roundMoney(row.balanceBefore - row.amount) !== row.balanceAfter) {
      throw new Error(`الرصيد قبل/بعد لا يطابق مبلغ الحركة: ${row.movementId}`);
    }
    if (movementIds.has(row.movementId)) throw new Error(`معرف حركة مكرر: ${row.movementId}`);
    movementIds.add(row.movementId);
  }

  const componentGroups = new Map();
  for (const row of rows) {
    const key = `${row.invoiceId}|${row.serviceType}`;
    if (!componentGroups.has(key)) componentGroups.set(key, []);
    componentGroups.get(key).push(row);
  }
  for (const [key, group] of componentGroups) {
    const allocated = roundMoney(group.reduce((sum, row) => sum + row.amount, 0));
    const expected = group[0].componentInvoiceTotal;
    if (allocated !== expected) throw new Error(`مجموع توزيع ${key} (${allocated}) لا يساوي قيمة البند (${expected})`);
  }
}

function sortRows(rows) {
  const typeOrder = { GENERAL: 0, MEDICINE: 1 };
  return [...rows].sort((a, b) =>
    a.batch - b.batch ||
    a.sourceRow - b.sourceRow ||
    typeOrder[a.serviceType] - typeOrder[b.serviceType] ||
    a.movementId.localeCompare(b.movementId),
  );
}

function selectRows(allRows, args) {
  if (args.familyCard && args.invoiceId) throw new Error("استخدم --family-card أو --invoice-id، وليس الاثنين معاً.");
  if (!args.familyCard && !args.invoiceId) throw new Error("يجب تحديد --family-card أو --invoice-id.");
  const selected = allRows.filter((row) =>
    args.familyCard ? row.familyCard === args.familyCard : row.invoiceId === args.invoiceId,
  );
  validateFileRows(selected);
  const families = [...new Set(selected.map((row) => row.familyCard))];
  if (families.length !== 1) throw new Error(`الاختيار يحتوي على ${families.length} عائلات؛ السكربت يسمح بعائلة واحدة فقط.`);
  return { rows: sortRows(selected), familyCard: families[0] };
}

function idempotencyKey(row) {
  return `cash-claim-import:${row.invoiceId}:${row.serviceType}:${row.card}`;
}

function buildExpectedChains(rows) {
  const byCard = new Map();
  for (const row of rows) {
    if (!byCard.has(row.card)) byCard.set(row.card, []);
    byCard.get(row.card).push(row);
  }
  for (const [card, chain] of byCard) {
    for (let index = 1; index < chain.length; index += 1) {
      if (chain[index].balanceBefore !== chain[index - 1].balanceAfter) {
        throw new Error(`تسلسل الرصيد غير متصل للبطاقة ${card} بين ${chain[index - 1].movementId} و${chain[index].movementId}`);
      }
    }
  }
  return byCard;
}

async function loadContext(rows, actorUsername) {
  const actor = await prisma.facility.findFirst({
    where: { username: { equals: actorUsername, mode: "insensitive" }, deleted_at: null },
    select: { id: true, username: true, name: true, is_admin: true, role: true },
  });
  if (!actor) throw new Error(`حساب المشرف غير موجود أو محذوف: ${actorUsername}`);
  if (!actor.is_admin && actor.role !== "ADMIN") throw new Error(`الحساب ${actor.username} ليس حساب مشرف ADMIN.`);

  const cards = [...new Set(rows.map((row) => row.card))];
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { card_number: { in: cards }, deleted_at: null },
    select: { id: true, card_number: true, name: true, remaining_balance: true, status: true, company_id: true },
  });
  return { actor, beneficiaries, cards };
}

function validateDatabaseSnapshot(rows, context) {
  const chains = buildExpectedChains(rows);
  const beneficiaryByCard = new Map(context.beneficiaries.map((row) => [row.card_number.toUpperCase(), row]));
  const missing = context.cards.filter((card) => !beneficiaryByCard.has(card));
  if (missing.length) throw new Error(`بطاقات غير موجودة في قاعدة البيانات: ${missing.join("، ")}`);

  for (const [card, chain] of chains) {
    const beneficiary = beneficiaryByCard.get(card);
    if (beneficiary.status === "SUSPENDED") throw new Error(`المستفيد موقوف: ${card} - ${beneficiary.name}`);
    const databaseBalance = roundMoney(Number(beneficiary.remaining_balance));
    if (databaseBalance !== chain[0].balanceBefore) {
      throw new Error(
        `الرصيد الحالي للبطاقة ${card} هو ${databaseBalance} بينما الملف يتوقع ${chain[0].balanceBefore}. ` +
        "أوقف التنفيذ وأعد تصدير الأرصدة وتوليد الملفات.",
      );
    }
  }
  return { chains, beneficiaryByCard };
}

function printPreview(rows, familyCard, context) {
  const invoiceIds = [...new Set(rows.map((row) => row.invoiceId))];
  const totalGeneral = roundMoney(rows.filter((row) => row.serviceType === "GENERAL").reduce((sum, row) => sum + row.amount, 0));
  const totalMedicine = roundMoney(rows.filter((row) => row.serviceType === "MEDICINE").reduce((sum, row) => sum + row.amount, 0));
  const invalidDates = rows.filter((row) => row.serviceDateRaw && !row.serviceDate);
  console.log(JSON.stringify({
    mode: "DRY_RUN",
    actor: context.actor.username,
    actorFacilityId: context.actor.id,
    familyCard,
    invoices: invoiceIds.length,
    transactionRows: rows.length,
    beneficiaries: new Set(rows.map((row) => row.card)).size,
    totalGeneral,
    totalMedicine,
    grandTotal: roundMoney(totalGeneral + totalMedicine),
    invalidServiceDates: invalidDates.map((row) => ({ movementId: row.movementId, value: row.serviceDateRaw })),
  }, null, 2));
}

async function applyImport(rows, familyCard, args) {
  if (args.confirmFamily !== familyCard) {
    throw new Error(`للتنفيذ يجب إضافة --confirm-family ${familyCard}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const actor = await tx.facility.findFirst({
      where: { username: { equals: args.actor, mode: "insensitive" }, deleted_at: null },
      select: { id: true, username: true, name: true, is_admin: true, role: true },
    });
    if (!actor || (!actor.is_admin && actor.role !== "ADMIN")) throw new Error("حساب superadmin غير موجود أو ليس مشرفاً.");

    const cards = [...new Set(rows.map((row) => row.card))];
    const locked = await tx.$queryRaw`
      SELECT id, card_number, name, remaining_balance, status, company_id
      FROM "Beneficiary"
      WHERE UPPER(card_number) IN (${Prisma.join(cards)})
        AND deleted_at IS NULL
      ORDER BY card_number
      FOR UPDATE
    `;
    const context = { actor, beneficiaries: locked, cards };
    const { chains, beneficiaryByCard } = validateDatabaseSnapshot(rows, context);

    const keys = rows.map(idempotencyKey);
    const existing = await tx.transaction.findMany({
      where: { idempotency_key: { in: keys } },
      select: { id: true, idempotency_key: true },
    });
    if (existing.length) {
      throw new Error(`الاستيراد مكرر: توجد ${existing.length} حركة مسجلة مسبقاً لنفس الفواتير.`);
    }

    const transactionIds = [];
    for (const row of rows) {
      const beneficiary = beneficiaryByCard.get(row.card);
      const transaction = await tx.transaction.create({
        data: {
          beneficiary_id: beneficiary.id,
          facility_id: actor.id,
          amount: row.amount,
          type: row.serviceType === "GENERAL" ? TransactionType.GENERAL : TransactionType.MEDICINE,
          service_category: row.serviceType,
          company_id: beneficiary.company_id,
          idempotency_key: idempotencyKey(row),
          ...(row.serviceDate ? { created_at: row.serviceDate } : {}),
        },
        select: { id: true },
      });
      transactionIds.push(transaction.id);
    }

    const balanceSnapshots = [];
    for (const [card, chain] of chains) {
      const beneficiary = beneficiaryByCard.get(card);
      const finalBalance = chain[chain.length - 1].balanceAfter;
      await tx.beneficiary.update({
        where: { id: beneficiary.id },
        data: {
          remaining_balance: finalBalance,
          status: finalBalance <= 0 ? "FINISHED" : "ACTIVE",
          completed_via: finalBalance <= 0 ? "IMPORT_CASH_CLAIM" : null,
        },
      });
      balanceSnapshots.push({
        beneficiary_id: beneficiary.id,
        card_number: card,
        balance_before: chain[0].balanceBefore,
        balance_after: finalBalance,
      });
    }

    const audit = await tx.auditLog.create({
      data: {
        facility_id: actor.id,
        user: actor.username,
        action: "IMPORT_CASH_CLAIM_SINGLE_FAMILY",
        metadata: {
          family_card: familyCard,
          invoice_ids: [...new Set(rows.map((row) => row.invoiceId))],
          transaction_ids: transactionIds,
          movement_ids: rows.map((row) => row.movementId),
          general_total: roundMoney(rows.filter((row) => row.serviceType === "GENERAL").reduce((sum, row) => sum + row.amount, 0)),
          medicine_total: roundMoney(rows.filter((row) => row.serviceType === "MEDICINE").reduce((sum, row) => sum + row.amount, 0)),
          balance_snapshots: balanceSnapshots,
          source_files: [...new Set(rows.map((row) => path.basename(row.filePath)))],
        },
      },
      select: { id: true },
    });

    return { auditLogId: audit.id, transactionIds, balanceSnapshots, actor };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 60_000,
  });

  console.log(JSON.stringify({
    mode: "APPLIED",
    actor: result.actor.username,
    familyCard,
    auditLogId: result.auditLogId,
    transactionsCreated: result.transactionIds.length,
    beneficiariesUpdated: result.balanceSnapshots.length,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const [generalRows, medicineRows] = await Promise.all([
    readMovementFile(args.generalFile, "GENERAL"),
    readMovementFile(args.medicineFile, "MEDICINE"),
  ]);
  const { rows, familyCard } = selectRows([...generalRows, ...medicineRows], args);
  const context = await loadContext(rows, args.actor);
  validateDatabaseSnapshot(rows, context);
  printPreview(rows, familyCard, context);

  if (!args.apply) {
    console.log("\nلم تُكتب أي بيانات. بعد أخذ نسخة احتياطية ومراجعة المعاينة، أعد الأمر مع --apply و--confirm-family.");
    return;
  }
  await applyImport(rows, familyCard, args);
}

main()
  .catch((error) => {
    console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
