const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = process.cwd();
const activeFile = path.join(root, "beneficiaries-active (4).xlsx");
const v15File = path.join(root, "reports", "jfz-cleanup", "JFZ-FINAL-V15-clean-verified.xlsx");
const output = path.join(root, "reports", "jfz-cleanup", "JFZ-missing-employees-from-active-list.xlsx");
const text = (v) => String(v ?? "").trim();
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "" }); }
function base(card) { return text(card).toUpperCase().match(/^(JFZ2025\d+)/)?.[1] || ""; }
function fin(card) { return base(card).replace(/^JFZ2025/, ""); }
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }; ws.columns.forEach((c) => c.width = Math.min(42, Math.max(14, ...c.values.slice(1).map((v) => text(v).length + 2)))); }
async function main() {
  const active = read(activeFile);
  const clean = read(v15File, "القائمة النهائية النظيفة");
  const failed = read(v15File, "حالات فشلت في التحقق");
  const cleanCards = new Set(clean.map((r) => text(r["رقم البطاقة النهائي"]).toUpperCase()));
  const failedFins = new Set(failed.filter((r) => /لا يوجد موظف أساسي/.test(text(r["السبب"]))).map((r) => text(r["الرقم الوظيفي"])));
  const employees = active.filter((r) => text(r["رقم البطاقة"]).toUpperCase() === base(r["رقم البطاقة"]));
  const missing = employees.filter((r) => failedFins.has(fin(r["رقم البطاقة"])) && !cleanCards.has(text(r["رقم البطاقة"]).toUpperCase())).map((r) => ({ "الرقم الوظيفي للعائلة": fin(r["رقم البطاقة"]), "اسم الموظف المفقود من V15": r["الاسم"], "بطاقة الموظف": r["رقم البطاقة"], "الحالة في المنظومة": r["الحالة"], "الرصيد الكلي": r["الرصيد الكلي"], "الرصيد المتبقي": r["الرصيد المتبقي"], "عدد الحركات": r["عدد الحركات"], "قرار الربط": "يعتمد كموظف أساسي للعائلة" }));
  const missingFins = new Set(missing.map((r) => r["الرقم الوظيفي للعائلة"]));
  const members = active.filter((r) => missingFins.has(fin(r["رقم البطاقة"]))).map((r) => ({ "الرقم الوظيفي للعائلة": fin(r["رقم البطاقة"]), الاسم: r["الاسم"], "رقم البطاقة في المنظومة": r["رقم البطاقة"], "هل هو الموظف": text(r["رقم البطاقة"]).toUpperCase() === base(r["رقم البطاقة"]) ? "نعم" : "لا", الحالة: r["الحالة"], "الرصيد الكلي": r["الرصيد الكلي"], "الرصيد المتبقي": r["الرصيد المتبقي"], "عدد الحركات": r["عدد الحركات"] }));
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of [["الموظفون المفقودون", missing], ["أفراد العائلات", members]]) { const ws = wb.addWorksheet(name); ws.columns = Object.keys(rows[0] || { "لا توجد نتائج": "" }).map((key) => ({ header: key, key })); ws.addRows(rows); style(ws); }
  await wb.xlsx.writeFile(output);
  console.log(JSON.stringify({ activeRows: active.length, activeFamilies: new Set(active.map((r) => base(r["رقم البطاقة"]))).size, missingEmployees: missing.length, linkedFamilyMembers: members.length, output }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
