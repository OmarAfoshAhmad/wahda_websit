const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const root = path.join(process.cwd(), "reports", "jfz-cleanup");
const cleanInput = path.join(root, "JFZ-01-clean-confirmed-V10-clear-person-gender.xlsx");
const reviewInput = path.join(root, "JFZ-02-manual-review-V10-clear-person-gender.xlsx");
const cleanOutput = path.join(root, "JFZ-01-clean-confirmed-V11-from-user-edits.xlsx");
const reviewOutput = path.join(root, "JFZ-02-manual-review-V11-deduplicated.xlsx");

function text(v) { return String(v ?? "").trim().replace(/\s+/g, " "); }
function norm(v) { return text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, ""); }
function digits(v) { return text(v).replace(/\D/g, ""); }
function read(file) { const wb = XLSX.readFile(file); const sheet = wb.Sheets[wb.SheetNames[0]]; return { name: wb.SheetNames[0], rows: XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true }) }; }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); const list = map.get(key) || []; list.push(row); map.set(key, list); } return map; }
function completeness(row) { return Object.values(row).filter((v) => text(v)).length + (digits(row["الرقم الوطني"]).length >= 10 ? 20 : 0) + (text(row["المواليد الحالية"] || row["تاريخ الميلاد المعتمد"]) ? 5 : 0); }
function mergeRows(preferred, group) {
  const result = { ...preferred };
  for (const row of group) for (const [key, value] of Object.entries(row)) if (!text(result[key]) && text(value)) result[key] = value;
  return result;
}
function cardColumn(row) { return text(row.A || row["البطاقة النظيفة"] || row["البطاقة الحالية"]).toUpperCase(); }
function normalizedResolvedCard(row) {
  const fin = digits(row["الرقم المالي"]);
  if (!fin) return cardColumn(row);
  const base = `JFZ2025${fin}`;
  const relation = norm(row["الصلة الحالية"] || row["الصلة المعتمدة"]);
  const gender = norm(row["جنس الشخص نفسه"]);
  if (/موظف|الموظف/.test(relation)) return base;
  if (/^اب$|^ابو$|والد|father/.test(relation)) return `${base}F1`;
  if (/^ام$|والده|mother/.test(relation)) return `${base}M1`;
  if (/زوج/.test(relation)) return /انث|female/.test(gender) ? `${base}W1` : /ذكر|male/.test(gender) ? `${base}H1` : cardColumn(row);
  const card = cardColumn(row);
  return /^[A-Z]+\d+[A-Z]$/.test(card) ? `${card}1` : card;
}
function style(ws) {
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  if (ws.columnCount) ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.columns.forEach((c) => { c.width = Math.min(45, Math.max(14, ...c.values.slice(1, 120).map((v) => text(v).length + 2))); });
}
async function write(file, sheets) {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const ws = wb.addWorksheet(name);
    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    ws.columns = headers.map((key) => ({ header: key, key }));
    ws.addRows(rows);
    style(ws);
  }
  await wb.xlsx.writeFile(file);
}

async function main() {
  if (!fs.existsSync(cleanInput) || !fs.existsSync(reviewInput)) throw new Error("ملفا V10 المعدلان غير موجودين");
  const clean = read(cleanInput).rows;
  const review = read(reviewInput).rows;
  const remaining = [], resolved = [];
  const groups = groupBy(review, (r) => `${digits(r["الرقم المالي"])}|${norm(r["الاسم"])}`);

  for (const [, group] of groups) {
    if (group.length === 1) { remaining.push(group[0]); continue; }
    const nationals = [...new Set(group.map((r) => digits(r["الرقم الوطني"])).filter((x) => x.length >= 10))];
    if (nationals.length > 1) {
      group.forEach((r) => remaining.push({ ...r, "قرار V11": "بقي للمراجعة: أكثر من رقم وطني داخل الاسم نفسه" }));
      continue;
    }
    const preferred = [...group].sort((a, b) => completeness(b) - completeness(a))[0];
    const merged = mergeRows(preferred, group);
    const oldCards = [...new Set(group.map(cardColumn).filter(Boolean))];
    const finalCard = normalizedResolvedCard(merged);
    resolved.push({ ...merged, A: finalCard, "قرار V11": "تم دمج التكرار واعتماد السجل ذي الرقم الوطني/الأكثر اكتمالاً", "البطاقات المدمجة": oldCards.join(" | "), "عدد الصفوف المدمجة": group.length });
  }

  const cleanByIdentity = new Map();
  for (const row of clean) {
    const national = digits(row["الرقم الوطني"]);
    const key = national.length >= 10 ? `N:${national}` : `F:${digits(row["الرقم المالي"])}|${norm(row["الاسم"])}`;
    cleanByIdentity.set(key, row);
  }
  for (const row of resolved) {
    const national = digits(row["الرقم الوطني"]);
    const key = national.length >= 10 ? `N:${national}` : `F:${digits(row["الرقم المالي"])}|${norm(row["الاسم"])}`;
    const existing = cleanByIdentity.get(key);
    const addition = {
      "الرقم المالي": row["الرقم المالي"], "الاسم": row["الاسم"], "جنس الشخص نفسه": row["جنس الشخص نفسه"],
      "درجة ثقة جنس الشخص": row["درجة ثقة جنس الشخص"], "الصلة المعتمدة": row["الصلة الحالية"],
      "تاريخ الميلاد المعتمد": row["المواليد الحالية"], "البطاقة النظيفة": row.A,
      "الرقم الوطني": row["الرقم الوطني"], "جنس الموظف صاحب العائلة وليس جنس هذا الصف": row["جنس الموظف صاحب العائلة وليس جنس هذا الصف"],
      "درجة ثقة جنس صاحب العائلة": row["درجة ثقة جنس صاحب العائلة"], "البطاقة الحالية": row["البطاقة الحالية"] || row.A,
      "نوع التغيير": "اعتماد مراجعة المستخدم V11", "دليل جنس الشخص": row["دليل جنس الشخص"],
      "دليل جنس صاحب العائلة": row["دليل جنس صاحب العائلة"], "تنبيه وصف المصدر": row["تنبيه وصف المصدر"],
      "دليل القرار": row["قرار V11"], "ملف المصدر": row["ملف المصدر"]
    };
    cleanByIdentity.set(key, existing ? mergeRows(existing, [addition]) : addition);
  }
  const finalClean = [...cleanByIdentity.values()];
  const cardGroups = groupBy(finalClean, (r) => text(r["البطاقة النظيفة"]).toUpperCase());
  const duplicateCards = [...cardGroups].filter(([card, list]) => card && list.length > 1);
  if (duplicateCards.length) {
    for (const [card, list] of duplicateCards) list.forEach((r) => remaining.push({ ...r, "قرار V11": `تعارض بعد الدمج: البطاقة ${card} مستخدمة لأكثر من هوية` }));
    const bad = new Set(duplicateCards.flatMap(([, list]) => list));
    for (const row of [...cleanByIdentity.values()]) if (bad.has(row)) cleanByIdentity.delete(digits(row["الرقم الوطني"]).length >= 10 ? `N:${digits(row["الرقم الوطني"])}` : `F:${digits(row["الرقم المالي"])}|${norm(row["الاسم"])}`);
  }
  const safeClean = [...cleanByIdentity.values()];
  await write(cleanOutput, [{ name: "نظيف من تعديلات المستخدم", rows: safeClean }]);
  await write(reviewOutput, [{ name: "متبقي للمراجعة", rows: remaining }, { name: "تكرارات محلولة", rows: resolved }]);
  console.log(JSON.stringify({ cleanInputRows: clean.length, reviewInputRows: review.length, resolvedDuplicateGroups: resolved.length, remainingReviewRows: remaining.length, cleanOutputRows: safeClean.length, duplicateCardsInClean: 0, cleanOutput, reviewOutput }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
