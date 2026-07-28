const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = process.cwd();
const v15 = path.join(root, "reports", "jfz-cleanup", "JFZ-FINAL-V15-clean-verified.xlsx");
const active = path.join(root, "beneficiaries-active (4).xlsx");
const output = path.join(root, "reports", "jfz-cleanup", "JFZ-complete-employees-and-families.xlsx");
const text = (v) => String(v ?? "").trim();
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "" }); }
function base(card) { return text(card).toUpperCase().match(/^(JFZ2025\d+)/)?.[1] || ""; }
function fin(card) { return base(card).replace(/^JFZ2025/, ""); }
function relationFromCard(card) { const suffix = text(card).toUpperCase().slice(base(card).length); if (!suffix) return "الموظف"; if (/^W/.test(suffix)) return "زوجة"; if (/^H/.test(suffix)) return "زوج"; if (/^M/.test(suffix)) return "أم"; if (/^F/.test(suffix)) return "أب"; if (/^S/.test(suffix)) return "ابن"; if (/^D/.test(suffix)) return "ابنة"; return "تابع"; }
function genderFromRelation(rel) { return ["زوجة", "أم", "ابنة"].includes(rel) ? "أنثى" : ["الموظف", "زوج", "أب", "ابن"].includes(rel) ? "ذكر" : ""; }
function norm(v) { return text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, ""); }
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }; ws.columns.forEach((c) => c.width = Math.min(40, Math.max(14, ...c.values.slice(1, 150).map((v) => text(v).length + 2)))); }
async function main() {
  const rows = read(v15, "القائمة النهائية النظيفة").map((r) => ({ "الرقم الوظيفي للعائلة": text(r["الرقم الوظيفي للعائلة"]), "اسم الموظف صاحب العائلة": "", "اسم المستفيد": r["اسم المستفيد"], الجنس: r["الجنس المعتمد"], "صلة القرابة": r["صلة القرابة المعتمدة"], "تاريخ الميلاد": r["تاريخ الميلاد"], "رقم البطاقة": r["رقم البطاقة النهائي"], "الرقم الوطني": r["الرقم الوطني"], "مصدر السجل": "V15" }));
  const failed = read(v15, "حالات فشلت في التحقق");
  const failedByFamilyName = new Map(failed.map((r) => [`${text(r["الرقم الوظيفي"])}|${norm(r["الاسم"])}`, r]));
  const knownCards = new Set(rows.map((r) => text(r["رقم البطاقة"]).toUpperCase()));
  for (const r of read(active)) {
    const card = text(r["رقم البطاقة"]).toUpperCase();
    if (!card || knownCards.has(card)) continue;
    const audited = failedByFamilyName.get(`${fin(card)}|${norm(r["الاسم"])}`);
    const rel = audited?.["الصلة"] || relationFromCard(card);
    rows.push({ "الرقم الوظيفي للعائلة": fin(card), "اسم الموظف صاحب العائلة": "", "اسم المستفيد": r["الاسم"], الجنس: audited?.["الجنس"] || genderFromRelation(rel), "صلة القرابة": rel, "تاريخ الميلاد": audited?.["تاريخ الميلاد"] || r["تاريخ الميلاد"], "رقم البطاقة": card, "الرقم الوطني": audited?.["الرقم الوطني"] || "", "مصدر السجل": "قائمة المنظومة النشطة — العائلة المفقودة" });
    knownCards.add(card);
  }
  const families = new Map(); for (const r of rows) { const list = families.get(r["الرقم الوظيفي للعائلة"]) || []; list.push(r); families.set(r["الرقم الوظيفي للعائلة"], list); }
  for (const [familyFin, members] of families) {
    if (!members.some((r) => r["مصدر السجل"].includes("العائلة المفقودة"))) continue;
    const baseCard = `JFZ2025${familyFin}`;
    const codeFor = (r) => ({ "الموظف": "", "زوجة": "W", "زوج": "H", "أم": "M", "أب": "F", "ابنة": "D", "ابن": "S" })[r["صلة القرابة"]];
    const birthKey = (r) => text(r["تاريخ الميلاد"] || "9999");
    const employee = members.find((r) => codeFor(r) === ""); if (employee) employee["رقم البطاقة"] = baseCard;
    for (const code of ["W", "H", "M", "F", "D", "S"]) {
      const group = members.filter((r) => codeFor(r) === code).sort((a, b) => birthKey(a).localeCompare(birthKey(b)) || text(a["رقم البطاقة"]).localeCompare(text(b["رقم البطاقة"])));
      group.forEach((r, i) => r["رقم البطاقة"] = `${baseCard}${code}${i + 1}`);
    }
  }
  const relationOrder = { "الموظف": 0, "زوجة": 1, "زوج": 1, "أم": 2, "أب": 2, "ابنة": 3, "ابن": 3, "تابع": 9 };
  const ordered = [], summaries = [];
  for (const [familyFin, members] of [...families].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const employee = members.find((r) => r["صلة القرابة"] === "الموظف");
    const employeeName = employee?.["اسم المستفيد"] || "غير موجود";
    members.sort((a, b) => (relationOrder[a["صلة القرابة"]] ?? 9) - (relationOrder[b["صلة القرابة"]] ?? 9) || text(a["رقم البطاقة"]).localeCompare(text(b["رقم البطاقة"])));
    members.forEach((r, index) => ordered.push({ ...r, "اسم الموظف صاحب العائلة": employeeName, "ترتيب العرض داخل العائلة": index + 1 }));
    summaries.push({ "الرقم الوظيفي للعائلة": familyFin, "اسم الموظف": employeeName, "بطاقة الموظف": employee?.["رقم البطاقة"] || "", "إجمالي أفراد العائلة": members.length, "عدد التابعين": Math.max(0, members.length - (employee ? 1 : 0)), "حالة الموظف": employee ? "موجود" : "مفقود" });
  }
  const employees = ordered.filter((r) => r["صلة القرابة"] === "الموظف");
  const cards = ordered.map((r) => r["رقم البطاقة"]), duplicateCards = cards.length - new Set(cards).size;
  const checks = [{ الفحص: "إجمالي الموظفين", النتيجة: employees.length }, { الفحص: "إجمالي العائلات", النتيجة: summaries.length }, { الفحص: "إجمالي الموظفين وأفراد عائلاتهم", النتيجة: ordered.length }, { الفحص: "العائلات بلا موظف", النتيجة: summaries.filter((r) => r["حالة الموظف"] !== "موجود").length }, { الفحص: "بطاقات مكررة", النتيجة: duplicateCards }, { الفحص: "بطاقات فارغة", النتيجة: ordered.filter((r) => !r["رقم البطاقة"]).length }];
  const wb = new ExcelJS.Workbook();
  for (const [name, data] of [["كامل الموظفين وعائلاتهم", ordered], ["ملخص العائلات", summaries], ["الموظفون فقط", employees], ["نتيجة التحقق", checks]]) { const ws = wb.addWorksheet(name); ws.columns = Object.keys(data[0]).map((key) => ({ header: key, key })); ws.addRows(data); style(ws); }
  await wb.xlsx.writeFile(output);
  console.log(JSON.stringify({ employees: employees.length, families: summaries.length, allMembers: ordered.length, familiesWithoutEmployee: checks[3].النتيجة, duplicateCards, output }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
