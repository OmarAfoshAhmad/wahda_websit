const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = path.join(process.cwd(), "reports", "jfz-cleanup");
const cleanInput = path.join(root, "JFZ-01-clean-confirmed-V12-family-sequences.xlsx");
const reviewInput = path.join(root, "JFZ-02-manual-review-V12-family-sequences.xlsx");
const cleanOutput = path.join(root, "JFZ-01-clean-confirmed-V13-after-gender-review.xlsx");
const remainingOutput = path.join(root, "JFZ-02-remaining-V13-organized.xlsx");
const text = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const digits = (v) => text(v).replace(/\D/g, "");
const norm = (v) => text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "", raw: true }); }
function card(row) { return text(row.A || row["البطاقة النظيفة"] || row["البطاقة الحالية"]).toUpperCase(); }
function gender(row) { const g = norm(row["جنس الشخص نفسه"]); return /انث/.test(g) ? "أنثى" : /ذكر/.test(g) ? "ذكر" : "غير محسوم"; }
function expectedCode(row) {
  const rel = norm(row["الصلة الحالية"] || row["الصلة المعتمدة"]), g = gender(row);
  if (/موظف/.test(rel)) return "";
  if (/^اب$|والد|father/.test(rel)) return "F";
  if (/^ام$|والده|mother/.test(rel)) return "M";
  if (/زوج/.test(rel)) return g === "أنثى" ? "W" : g === "ذكر" ? "H" : null;
  if (/ابن|ابنه|بنت|ولد/.test(rel)) return g === "أنثى" ? "D" : g === "ذكر" ? "S" : null;
  return null;
}
function add(map, key, value) { const list = map.get(key) || []; list.push(value); map.set(key, list); }
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; if (ws.columnCount) ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; ws.columns.forEach((c) => c.width = Math.min(48, Math.max(14, ...c.values.slice(1, 100).map((v) => text(v).length + 2)))); }
async function write(file, sheets) { const w = new ExcelJS.Workbook(); for (const spec of sheets) { const ws = w.addWorksheet(spec.name); const headers = [...new Set(spec.rows.flatMap(Object.keys))]; ws.columns = headers.map((key) => ({ header: key, key })); ws.addRows(spec.rows); style(ws); } await w.xlsx.writeFile(file); }

async function main() {
  const clean = read(cleanInput);
  const review = read(reviewInput, "متبقي للمراجعة");
  const cleanCards = new Map(), cleanNationals = new Map(), baseOwners = new Set();
  clean.forEach((r) => { add(cleanCards, card(r), r); const n = digits(r["الرقم الوطني"]); if (n) add(cleanNationals, n, r); const fin = digits(r["الرقم المالي"]); if (card(r) === `JFZ2025${fin}`) baseOwners.add(fin); });
  review.forEach((r) => { const fin = digits(r["الرقم المالي"]); if (expectedCode(r) === "" && card(r) === `JFZ2025${fin}`) baseOwners.add(fin); });
  const reviewCards = new Map(), reviewNationals = new Map();
  review.forEach((r) => { add(reviewCards, card(r), r); const n = digits(r["الرقم الوطني"]); if (n) add(reviewNationals, n, r); });

  const promoted = [], remaining = [];
  for (const row of review) {
    const reasons = [], fin = digits(row["الرقم المالي"]), c = card(row), n = digits(row["الرقم الوطني"]), code = expectedCode(row), g = gender(row);
    const originalReason = text(row["سبب المراجعة"] || row["قرار V12"] || row["قرار V11"]);
    if (g === "غير محسوم") reasons.push("الجنس ما زال غير محسوم");
    if (!fin) reasons.push("الرقم الوظيفي مفقود");
    if (!text(row["الاسم"])) reasons.push("الاسم مفقود");
    if (code === null) reasons.push("صلة القرابة غير واضحة");
    if (!n || n.length < 10) reasons.push("الرقم الوطني مفقود أو غير صالح");
    if (!c) reasons.push("البطاقة مفقودة");
    const base = `JFZ2025${fin}`;
    if (code === "" && c !== base) reasons.push(`بطاقة الموظف يجب أن تكون ${base}`);
    if (code && !new RegExp(`^${base}${code}\\d+$`).test(c)) reasons.push(`لاحقة البطاقة لا توافق الجنس/الصلة؛ المتوقع ${code}`);
    if (code !== "" && !baseOwners.has(fin)) reasons.push("لا يوجد موظف أساسي مثبت تحت الرقم الوظيفي نفسه");
    if ((cleanCards.get(c) || []).length || (reviewCards.get(c) || []).length > 1) reasons.push("رقم البطاقة مكرر");
    if (n && ((cleanNationals.get(n) || []).length || (reviewNationals.get(n) || []).length > 1)) reasons.push("الرقم الوطني مكرر");
    if (/مرتبط بأكثر من هوية|تعارض بطاقة/.test(originalReason)) reasons.push("تعارض هوية سابق لم يحسمه تعديل الجنس");
    if (reasons.length) remaining.push({ ...row, "حالة V13": "متبقي", "أسباب البقاء المنظمة": [...new Set(reasons)].join(" | ") });
    else promoted.push({ ...row, "جنس الشخص نفسه": g, "حالة V13": "تمت الترقية للنظيف", "دليل الترقية": "جنس وصلة وبطاقة وعائلة ورقم وطني متوافقة دون تكرار" });
  }

  const outputClean = [...clean];
  for (const r of promoted) outputClean.push({ "الرقم المالي": r["الرقم المالي"], "الاسم": r["الاسم"], "جنس الشخص نفسه": r["جنس الشخص نفسه"], "درجة ثقة جنس الشخص": "حسم يدوي من المستخدم", "الصلة المعتمدة": r["الصلة الحالية"], "تاريخ الميلاد المعتمد": r["المواليد الحالية"], "البطاقة النظيفة": card(r), "الرقم الوطني": r["الرقم الوطني"], "البطاقة الحالية": r["البطاقة الحالية"] || card(r), "نوع التغيير": "ترقية بعد مراجعة الجنس V13", "دليل القرار": r["دليل الترقية"], "ملف المصدر": r["ملف المصدر"] });
  await write(cleanOutput, [{ name: "القائمة النظيفة الكاملة", rows: outputClean }]);
  const byReason = new Map(); remaining.forEach((r) => { const key = r["أسباب البقاء المنظمة"]; add(byReason, key, r); });
  const summary = [...byReason].map(([reason, rows]) => ({ "سبب البقاء": reason, "عدد الحالات": rows.length }));
  await write(remainingOutput, [{ name: "المتبقي المنظم", rows: remaining }, { name: "ملخص أسباب البقاء", rows: summary }]);
  const cards = outputClean.map(card).filter(Boolean), nationals = outputClean.map((r) => digits(r["الرقم الوطني"])).filter(Boolean);
  console.log(JSON.stringify({ inputClean: clean.length, reviewedRows: review.length, promotedToClean: promoted.length, remaining: remaining.length, outputClean: outputClean.length, duplicateCards: cards.length - new Set(cards).size, duplicateNationals: nationals.length - new Set(nationals).size, cleanOutput, remainingOutput }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
