const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = process.cwd();
const v15 = path.join(root, "reports", "jfz-cleanup", "JFZ-FINAL-V15-clean-verified.xlsx");
const active = path.join(root, "beneficiaries-active (4).xlsx");
const output = path.join(root, "reports", "jfz-cleanup", "JFZ-complete-employees-with-missing-added.xlsx");
const text = (v) => String(v ?? "").trim();
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "" }); }
function employeeBase(card) { return text(card).toUpperCase().match(/^(JFZ2025\d+)$/)?.[1] || ""; }
function fin(card) { return employeeBase(card).replace(/^JFZ2025/, ""); }
async function main() {
  const employees = read(v15, "القائمة النهائية النظيفة").filter((r) => text(r["صلة القرابة المعتمدة"]) === "الموظف").map((r) => ({ "الرقم الوظيفي": text(r["الرقم الوظيفي للعائلة"]), "اسم الموظف": r["اسم المستفيد"], الجنس: r["الجنس المعتمد"], "تاريخ الميلاد": r["تاريخ الميلاد"], "رقم بطاقة الموظف": r["رقم البطاقة النهائي"], "الرقم الوطني": r["الرقم الوطني"], "مصدر السجل": "V15" }));
  const knownCards = new Set(employees.map((r) => text(r["رقم بطاقة الموظف"]).toUpperCase()));
  for (const r of read(active)) {
    const card = employeeBase(r["رقم البطاقة"]);
    if (!card || knownCards.has(card)) continue;
    employees.push({ "الرقم الوظيفي": fin(card), "اسم الموظف": r["الاسم"], الجنس: "ذكر", "تاريخ الميلاد": r["تاريخ الميلاد"], "رقم بطاقة الموظف": card, "الرقم الوطني": "", "مصدر السجل": "قائمة المنظومة النشطة — موظف مفقود من V15" });
    knownCards.add(card);
  }
  employees.sort((a, b) => Number(a["الرقم الوظيفي"]) - Number(b["الرقم الوظيفي"]));
  const finCounts = new Map(), cardCounts = new Map();
  employees.forEach((r) => { finCounts.set(r["الرقم الوظيفي"], (finCounts.get(r["الرقم الوظيفي"]) || 0) + 1); cardCounts.set(r["رقم بطاقة الموظف"], (cardCounts.get(r["رقم بطاقة الموظف"]) || 0) + 1); });
  const summary = [{ الفحص: "إجمالي الموظفين", النتيجة: employees.length }, { الفحص: "أرقام وظيفية مكررة", النتيجة: [...finCounts.values()].filter((n) => n > 1).length }, { الفحص: "بطاقات موظفين مكررة", النتيجة: [...cardCounts.values()].filter((n) => n > 1).length }, { الفحص: "الموظفون المضافون من قائمة المنظومة", النتيجة: employees.filter((r) => r["مصدر السجل"] !== "V15").length }];
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of [["كامل الموظفين", employees], ["نتيجة التحقق", summary]]) { const ws = wb.addWorksheet(name); ws.columns = Object.keys(rows[0]).map((key) => ({ header: key, key })); ws.addRows(rows); ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }; ws.columns.forEach((c) => c.width = 24); }
  await wb.xlsx.writeFile(output);
  console.log(JSON.stringify({ employees: employees.length, duplicateEmployeeNumbers: summary[1].النتيجة, duplicateCards: summary[2].النتيجة, added: summary[3].النتيجة, output }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
