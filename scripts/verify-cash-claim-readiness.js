/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const DATA_DIR = path.resolve(__dirname, "المخصص كاش كليم طرابلس", "نتائج معالجة الحسميات - قاعدة البيانات الحالية");
const GENERAL_FILE = path.join(DATA_DIR, "حركات Cash Claim - الكشوفات - توزيع متساوي.xlsx");
const MEDICINE_FILE = path.join(DATA_DIR, "حركات Cash Claim - الأدوية - توزيع متساوي.xlsx");
const CONSOLIDATED_FILE = path.join(DATA_DIR, "تقرير الحسميات المجمع.xlsx");
const EXCLUDED_FILE = path.join(DATA_DIR, "فواتير Cash Claim المستبعدة من الاستيراد.xlsx");
const INSUFFICIENT_FILE = path.join(DATA_DIR, "العائلات غير المغطية لقيمة الفاتورة.xlsx");
const OUTPUT_FILE = path.join(DATA_DIR, "تقرير جاهزية Cash Claim الفعلي.xlsx");

function valueText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.result != null) return valueText(value.result);
    if (value.text != null) return String(value.text).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
  }
  return String(value).trim();
}

function numberValue(value) {
  const parsed = Number(valueText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function readSheet(filePath, sheetName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName) || workbook.worksheets[0];
  const headers = [];
  sheet.getRow(1).eachCell((cell, column) => { headers[column] = valueText(cell.value); });
  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const item = {};
    let hasValue = false;
    for (let column = 1; column < headers.length; column += 1) {
      if (!headers[column]) continue;
      const value = row.getCell(column).value;
      if (valueText(value)) hasValue = true;
      item[headers[column]] = value;
    }
    if (hasValue) rows.push(item);
  }
  return rows;
}

function parseMovement(row) {
  const serviceType = valueText(row["نوع الخدمة"]).toUpperCase();
  const movementId = valueText(row["معرف الحركة"]);
  const invoiceId = valueText(row["معرف الفاتورة"]);
  const card = valueText(row["رقم البطاقة"]).toUpperCase();
  return {
    movementId,
    invoiceId,
    card,
    beneficiaryName: valueText(row["اسم المستفيد"]),
    familyCard: valueText(row["رقم بطاقة العائلة"]).toUpperCase(),
    serviceType,
    amount: roundMoney(numberValue(row["المبلغ"])),
    componentTotal: roundMoney(numberValue(row["قيمة بند الفاتورة"])),
    balanceBefore: roundMoney(numberValue(row["الرصيد قبل الحركة"])),
    balanceAfter: roundMoney(numberValue(row["الرصيد بعد الحركة"])),
    batch: Number(numberValue(row["الدفعة"])),
    sourceRow: Number(numberValue(row["صف المصدر"])),
    idempotencyKey: `cash-claim-import:${invoiceId}:${serviceType}:${card}`,
  };
}

function movementSort(a, b) {
  const typeOrder = { GENERAL: 0, MEDICINE: 1 };
  return a.batch - b.batch || a.sourceRow - b.sourceRow || typeOrder[a.serviceType] - typeOrder[b.serviceType] || a.movementId.localeCompare(b.movementId);
}

function countBy(items, keyFn) {
  const result = new Map();
  for (const item of items) {
    const key = keyFn(item);
    result.set(key, (result.get(key) || 0) + 1);
  }
  return result;
}

function uniqueSourcePersonKey(row) {
  const employee = valueText(row["الرقم الوظيفي"]);
  const employeeName = valueText(row["اسم الموظف في المصدر"]);
  const patient = valueText(row["اسم المستفيد في المصدر"]);
  const relation = valueText(row["صلة القرابة"]);
  return `${employee || employeeName}|${patient || "نفسه"}|${relation}`;
}

async function writeReport(summary, multiMovementCards, multiSourceCards, readinessIssues, unmatchedRows, excludedRows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Codex - WAAD";
  const definitions = [
    { name: "الملخص", columns: [
      { header: "المؤشر", key: "metric", width: 44 },
      { header: "القيمة", key: "value", width: 18 },
      { header: "التوضيح", key: "note", width: 70 },
    ], rows: summary },
    { name: "متعدد الحركات", columns: [
      { header: "رقم البطاقة", key: "card", width: 24 },
      { header: "اسم المستفيد", key: "name", width: 36 },
      { header: "عدد الحركات الكلي", key: "total", width: 22 },
      { header: "المنفذ", key: "executed", width: 14 },
      { header: "المتبقي", key: "remaining", width: 14 },
      { header: "إجمالي المبلغ", key: "amount", width: 18 },
    ], rows: multiMovementCards },
    { name: "متعدد المطالبات الأصلية", columns: [
      { header: "رقم البطاقة", key: "card", width: 24 },
      { header: "اسم المستفيد", key: "name", width: 36 },
      { header: "عدد المطالبات", key: "count", width: 18 },
    ], rows: multiSourceCards },
    { name: "مشكلات الجاهزية", columns: [
      { header: "رقم البطاقة", key: "card", width: 24 },
      { header: "المشكلة", key: "issue", width: 70 },
      { header: "الرصيد الحالي", key: "currentBalance", width: 20 },
      { header: "الرصيد المتوقع", key: "expectedBalance", width: 20 },
    ], rows: readinessIssues },
    { name: "غير مطابق", columns: [
      { header: "الدفعة", key: "batch", width: 10 },
      { header: "صف المصدر", key: "sourceRow", width: 12 },
      { header: "الموظف", key: "employee", width: 34 },
      { header: "الرقم الوظيفي", key: "employeeNumber", width: 16 },
      { header: "المستفيد في المصدر", key: "patient", width: 32 },
      { header: "سبب عدم المطابقة", key: "reason", width: 60 },
    ], rows: unmatchedRows.map((row) => ({
      batch: numberValue(row["الدفعة"]),
      sourceRow: numberValue(row["صف المصدر"]),
      employee: valueText(row["اسم الموظف في المصدر"]),
      employeeNumber: valueText(row["الرقم الوظيفي"]),
      patient: valueText(row["اسم المستفيد في المصدر"]),
      reason: valueText(row["طريقة مطابقة المستفيد"]),
    })) },
    { name: "فواتير مستبعدة", columns: [
      { header: "معرف الفاتورة", key: "invoiceId", width: 20 },
      { header: "الموظف", key: "employee", width: 34 },
      { header: "إجمالي الفاتورة", key: "total", width: 18 },
      { header: "العجز", key: "deficit", width: 16 },
      { header: "سبب الاستبعاد", key: "reason", width: 65 },
    ], rows: excludedRows.map((row) => ({
      invoiceId: valueText(row["معرف الفاتورة"]),
      employee: valueText(row["اسم الموظف"]),
      total: numberValue(row["إجمالي الفاتورة"]),
      deficit: numberValue(row["قيمة العجز"]),
      reason: valueText(row["سبب الاستبعاد"]),
    })) },
  ];

  for (const definition of definitions) {
    const sheet = workbook.addWorksheet(definition.name);
    sheet.columns = definition.columns;
    sheet.addRows(definition.rows);
    sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  await workbook.xlsx.writeFile(OUTPUT_FILE);
}

async function main() {
  const [generalRaw, medicineRaw, allClaims, familySummaryRows, unmatchedRows, excludedRows, insufficientRows] = await Promise.all([
    readSheet(GENERAL_FILE, "الحركات"),
    readSheet(MEDICINE_FILE, "الحركات"),
    readSheet(CONSOLIDATED_FILE, "كل الحسميات"),
    readSheet(CONSOLIDATED_FILE, "ملخص العائلات"),
    readSheet(CONSOLIDATED_FILE, "مطابقات تحتاج مراجعة"),
    readSheet(EXCLUDED_FILE, "فواتير مستبعدة"),
    readSheet(INSUFFICIENT_FILE, "العائلات غير المغطاة"),
  ]);
  const movements = [...generalRaw, ...medicineRaw].map(parseMovement).sort(movementSort);
  const cards = [...new Set(movements.map((row) => row.card))];
  const [beneficiaries, existingTransactions] = await Promise.all([
    prisma.beneficiary.findMany({
      where: { card_number: { in: cards }, deleted_at: null },
      select: { card_number: true, name: true, remaining_balance: true },
    }),
    prisma.transaction.findMany({
      where: { idempotency_key: { startsWith: "cash-claim-import:" }, is_cancelled: false },
      select: { idempotency_key: true },
    }),
  ]);
  const beneficiaryMap = new Map(beneficiaries.map((row) => [row.card_number.toUpperCase(), row]));
  const existingKeys = new Set(existingTransactions.map((row) => row.idempotency_key));
  const chains = new Map();
  for (const movement of movements) {
    if (!chains.has(movement.card)) chains.set(movement.card, []);
    chains.get(movement.card).push(movement);
  }

  const readinessIssues = [];
  for (const [card, chain] of chains) {
    const beneficiary = beneficiaryMap.get(card);
    if (!beneficiary) {
      readinessIssues.push({ card, issue: "البطاقة غير موجودة في قاعدة البيانات", currentBalance: "", expectedBalance: chain[0].balanceBefore });
      continue;
    }
    let sawPending = false;
    let lastExecuted = null;
    for (const movement of chain) {
      const executed = existingKeys.has(movement.idempotencyKey);
      if (!executed) sawPending = true;
      if (executed && sawPending) {
        readinessIssues.push({ card, issue: `حركة منفذة بعد فجوة غير منفذة: ${movement.movementId}`, currentBalance: numberValue(beneficiary.remaining_balance), expectedBalance: "" });
      }
      if (executed) lastExecuted = movement;
      if (roundMoney(movement.balanceBefore - movement.amount) !== movement.balanceAfter) {
        readinessIssues.push({ card, issue: `خطأ حساب داخل الملف: ${movement.movementId}`, currentBalance: numberValue(beneficiary.remaining_balance), expectedBalance: movement.balanceAfter });
      }
    }
    const firstPending = chain.find((movement) => !existingKeys.has(movement.idempotencyKey));
    const expectedCurrent = firstPending ? firstPending.balanceBefore : lastExecuted?.balanceAfter;
    const current = roundMoney(numberValue(beneficiary.remaining_balance));
    if (expectedCurrent != null && current !== expectedCurrent) {
      readinessIssues.push({ card, issue: "الرصيد الحالي لا يطابق نقطة استكمال ملف الاستيراد", currentBalance: current, expectedBalance: expectedCurrent });
    }
  }

  const movementCounts = countBy(movements, (row) => row.card);
  const movementAmounts = new Map();
  for (const row of movements) movementAmounts.set(row.card, roundMoney((movementAmounts.get(row.card) || 0) + row.amount));
  const multiMovementCards = [...movementCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([card, total]) => {
      const rows = chains.get(card);
      const executed = rows.filter((row) => existingKeys.has(row.idempotencyKey)).length;
      return {
        card,
        name: beneficiaryMap.get(card)?.name || rows[0].beneficiaryName,
        total,
        executed,
        remaining: total - executed,
        amount: movementAmounts.get(card),
      };
    })
    .sort((a, b) => b.total - a.total || a.card.localeCompare(b.card));

  const matchedSourceClaims = allClaims.filter((row) => valueText(row["رقم البطاقة"]));
  const sourceClaimCounts = countBy(matchedSourceClaims, (row) => valueText(row["رقم البطاقة"]).toUpperCase());
  const sourceNameByCard = new Map(matchedSourceClaims.map((row) => [valueText(row["رقم البطاقة"]).toUpperCase(), valueText(row["اسم المستفيد"])]));
  const multiSourceCards = [...sourceClaimCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([card, count]) => ({ card, name: sourceNameByCard.get(card), count }))
    .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card));

  const unmatchedUniquePeople = new Set(unmatchedRows.map(uniqueSourcePersonKey)).size;
  const unmatchedFamilyRows = unmatchedRows.filter((row) => valueText(row["ثقة مطابقة العائلة"]) === "غير مطابق");
  const unmatchedUniqueFamilies = new Set(unmatchedFamilyRows.map((row) => valueText(row["الرقم الوظيفي"]) || valueText(row["اسم الموظف في المصدر"]))).size;
  const individuallyInsufficientRows = allClaims.filter((row) => valueText(row["كفاية رصيد المستفيد"]) === "غير مغطى من رصيد المستفيد");
  const individuallyInsufficientCards = new Set(individuallyInsufficientRows.map((row) => valueText(row["رقم البطاقة"])).filter(Boolean));
  const allocationOverBalance = movements.filter((row) => row.amount > row.balanceBefore || row.balanceAfter < 0);
  const excludedByMissing = excludedRows.filter((row) => valueText(row["سبب الاستبعاد"]).includes("غير مطابقة"));
  const excludedByBalance = excludedRows.filter((row) => valueText(row["سبب الاستبعاد"]).includes("لا يغطي"));
  const coveredFamilies = familySummaryRows.filter((row) => valueText(row["حالة التغطية"]) === "مغطاة");
  const trueInsufficientDeficit = roundMoney(insufficientRows.reduce((sum, row) => sum + numberValue(row["قيمة المستحق منهم (العجز)"]), 0));
  const missingFamilyValue = roundMoney(excludedByMissing.reduce((sum, row) => sum + numberValue(row["إجمالي الفاتورة"]), 0));
  const trueUncoveredValue = roundMoney(missingFamilyValue + trueInsufficientDeficit);
  const executedMovements = movements.filter((row) => existingKeys.has(row.idempotencyKey));
  const pendingMovements = movements.filter((row) => !existingKeys.has(row.idempotencyKey));

  const summary = [
    { metric: "إجمالي فواتير المصدر", value: allClaims.length, note: "كل صف مطالبة في الملفات السبعة" },
    { metric: "فواتير جاهزة وموزعة", value: new Set(movements.map((row) => row.invoiceId)).size, note: "تشمل الفاتورة المنفذة بالفعل" },
    { metric: "فواتير مستبعدة", value: excludedRows.length, note: `غير مطابقة: ${excludedByMissing.length}، رصيد عائلة غير كافٍ: ${excludedByBalance.length}` },
    { metric: "العائلات المطابقة التي جرى تقييمها", value: familySummaryRows.length, note: `مغطاة: ${coveredFamilies.length}، غير مغطاة: ${insufficientRows.length}` },
    { metric: "صفوف مطالبات لم تُطابق بالمستفيد بثقة", value: unmatchedRows.length, note: `${unmatchedUniquePeople} مستفيد/هوية مصدر مميزة` },
    { metric: "عائلات غير مطابقة", value: unmatchedUniqueFamilies, note: `${unmatchedFamilyRows.length} فاتورة مصدر` },
    { metric: "عائلات لا يغطي مجموع رصيدها", value: insufficientRows.length, note: `إجمالي العجز الحقيقي ${trueInsufficientDeficit} د.ل` },
    { metric: "القيمة غير القابلة للاستيراد حالياً", value: trueUncoveredValue, note: `عائلات مفقودة ${missingFamilyValue} د.ل + عجز عائلة مطابقة ${trueInsufficientDeficit} د.ل` },
    { metric: "مستفيدون لا يغطي رصيدهم الشخصي كامل مطالباتهم الأصلية", value: individuallyInsufficientCards.size, note: `${individuallyInsufficientRows.length} صف مطالبة؛ ليست مانعاً إذا غطت العائلة` },
    { metric: "تخصيصات تتجاوز رصيد الفرد", value: allocationOverBalance.length, note: "يجب أن تكون صفراً" },
    { metric: "إجمالي حركات التوزيع", value: movements.length, note: `منفذ: ${executedMovements.length}، متبقٍ: ${pendingMovements.length}` },
    { metric: "المستفيدون المشاركون في التوزيع", value: movementCounts.size, note: "عدد البطاقات الفريدة" },
    { metric: "مستفيدون لديهم أكثر من حركة توزيع", value: multiMovementCards.length, note: "في ملفي الكشف والأدوية معاً" },
    { metric: "مستفيدون لديهم أكثر من مطالبة أصلية باسمهم", value: multiSourceCards.length, note: "قبل توزيع المطالبة على العائلة" },
    { metric: "مشكلات جاهزية مقابل الرصيد الحالي", value: readinessIssues.length, note: "تشمل بطاقات مفقودة أو تغير رصيد أو فجوة تنفيذ" },
  ];

  await writeReport(summary, multiMovementCards, multiSourceCards, readinessIssues, unmatchedRows, excludedRows);
  console.log(JSON.stringify({
    summary,
    excluded: {
      total: excludedRows.length,
      missingFamily: excludedByMissing.length,
      insufficientBalance: excludedByBalance.length,
      totalValue: roundMoney(excludedRows.reduce((sum, row) => sum + numberValue(row["إجمالي الفاتورة"]), 0)),
      missingFamilyValue,
      trueInsufficientDeficit,
      trueUncoveredValue,
    },
    execution: {
      executedMovements: executedMovements.length,
      pendingMovements: pendingMovements.length,
      executedInvoices: new Set(executedMovements.map((row) => row.invoiceId)).size,
      pendingInvoices: new Set(pendingMovements.map((row) => row.invoiceId)).size,
    },
    readinessIssueSample: readinessIssues.slice(0, 10),
    outputFile: OUTPUT_FILE,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
