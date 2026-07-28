const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = path.join(process.cwd(), "reports", "jfz-cleanup");
const cleanFile = path.join(root, "JFZ-01-clean-confirmed-V13-after-gender-review.xlsx");
const remainingFile = path.join(root, "JFZ-02-remaining-V13-organized.xlsx");
const outputFile = path.join(root, "JFZ-01-final-V14-manual-gender-relationships.xlsx");
const issuesFile = path.join(root, "JFZ-02-relationship-issues-V14.xlsx");
const text = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const digits = (v) => text(v).replace(/\D/g, "");
const norm = (v) => text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "", raw: true }); }
function add(map, key, value) { const list = map.get(key) || []; list.push(value); map.set(key, list); }
function gender(row) { const g = norm(row["جنس الشخص نفسه"]); return /انث/.test(g) ? "أنثى" : /ذكر/.test(g) ? "ذكر" : "غير محسوم"; }
function originalCard(row) { return text(row["البطاقة النظيفة"] || row.A || row["البطاقة الحالية"]).toUpperCase(); }
function relation(row) {
  const r = norm(row["الصلة المعتمدة"] || row["الصلة الحالية"]), c = originalCard(row), g = gender(row);
  if (/موظف/.test(r)) return { label: "الموظف", code: "" };
  if (/زوج/.test(r) || /[WH]\d*$/i.test(c)) return g === "أنثى" ? { label: "زوجة", code: "W" } : { label: "زوج", code: "H" };
  if (/^ام$|والده|mother/.test(r) || /M\d*$/i.test(c)) return { label: "أم", code: "M" };
  if (/^اب$|والد|father/.test(r) || /F\d*$/i.test(c)) return { label: "أب", code: "F" };
  if (/ابن|ابنه|بنت|ولد/.test(r) || /[SD]\d*$/i.test(c)) return g === "أنثى" ? { label: "ابنة", code: "D" } : { label: "ابن", code: "S" };
  return { label: text(row["الصلة المعتمدة"] || row["الصلة الحالية"]), code: null };
}
function birthKey(row) { const s = text(row["تاريخ الميلاد المعتمد"] || row["المواليد الحالية"]); const y = s.match(/(19\d{2}|20\d{2})/)?.[1]; return y ? `${y}-${s}` : "9999"; }
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; if (ws.columnCount) ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; ws.columns.forEach((c) => c.width = Math.min(45, Math.max(14, ...c.values.slice(1, 100).map((v) => text(v).length + 2)))); }
async function write(file, sheets) { const w = new ExcelJS.Workbook(); for (const spec of sheets) { const ws = w.addWorksheet(spec.name); const headers = [...new Set(spec.rows.flatMap(Object.keys))]; ws.columns = headers.map((key) => ({ header: key, key })); ws.addRows(spec.rows); style(ws); } await w.xlsx.writeFile(file); }

async function main() {
  const clean = read(cleanFile), remaining = read(remainingFile, "المتبقي المنظم");
  const all = [...clean.map((r) => ({ ...r, _origin: "V13 نظيف" })), ...remaining.map((r) => ({ ...r, _origin: "V13 متبقي حسمه المستخدم" }))];
  const issues = [], candidates = [];
  for (const row of all) {
    const fin = digits(row["الرقم المالي"]), g = gender(row), rel = relation(row), n = digits(row["الرقم الوطني"]);
    const reasons = [];
    if (!fin) reasons.push("رقم وظيفي مفقود");
    if (!text(row["الاسم"])) reasons.push("اسم مفقود");
    if (g === "غير محسوم") reasons.push("جنس غير محسوم");
    if (!n || n.length < 10) reasons.push("رقم وطني مفقود أو غير صالح");
    if (rel.code === null) reasons.push("صلة قرابة غير معروفة");
    const prepared = { ...row, _fin: fin, _gender: g, _relation: rel.label, _code: rel.code, _national: n, _birth: birthKey(row), _oldCard: originalCard(row) };
    if (reasons.length) issues.push({ ...row, "أسباب الاستبعاد V14": reasons.join(" | ") }); else candidates.push(prepared);
  }
  const byNational = new Map(); candidates.forEach((r) => add(byNational, r._national, r));
  const duplicatedIdentity = new Set([...byNational].filter(([, rows]) => rows.length > 1).flatMap(([, rows]) => rows));
  const unique = candidates.filter((r) => { if (!duplicatedIdentity.has(r)) return true; issues.push({ ...r, "أسباب الاستبعاد V14": "الرقم الوطني مكرر بعد دمج القائمتين" }); return false; });
  const families = new Map(); unique.forEach((r) => add(families, r._fin, r));
  const finalized = [];
  for (const [fin, members] of families) {
    const employees = members.filter((r) => r._code === "");
    if (employees.length !== 1) { members.forEach((r) => issues.push({ ...r, "أسباب الاستبعاد V14": employees.length ? "أكثر من موظف أساسي تحت الرقم الوظيفي" : "لا يوجد موظف أساسي تحت الرقم الوظيفي" })); continue; }
    const base = `JFZ2025${fin}`;
    employees[0]._newCard = base;
    for (const code of ["W", "H", "M", "F", "D", "S"]) {
      const group = members.filter((r) => r._code === code).sort((a, b) => a._birth.localeCompare(b._birth) || norm(a["الاسم"]).localeCompare(norm(b["الاسم"])));
      group.forEach((r, i) => r._newCard = `${base}${code}${i + 1}`);
    }
    finalized.push(...members);
  }
  const cardMap = new Map(); finalized.forEach((r) => add(cardMap, r._newCard, r));
  const cardConflicts = new Set([...cardMap].filter(([, rows]) => rows.length > 1).flatMap(([, rows]) => rows));
  const safe = finalized.filter((r) => { if (!cardConflicts.has(r)) return true; issues.push({ ...r, "أسباب الاستبعاد V14": "تعارض بطاقة بعد إعادة التسلسل" }); return false; });
  const output = safe.map((r) => ({ "الرقم المالي": r._fin, "الاسم": r["الاسم"], "جنس الشخص نفسه (معتمد يدوياً)": r._gender, "الصلة المعتمدة بعد التحقق": r._relation, "تاريخ الميلاد": r["تاريخ الميلاد المعتمد"] || r["المواليد الحالية"], "رقم البطاقة النهائي": r._newCard, "الرقم الوطني المعدل": r._national, "رقم البطاقة السابق": r._oldCard, "مصدر الصف": r._origin, "ملاحظة V14": r._newCard === r._oldCard ? "لا تغيير في البطاقة" : "أعيدت البطاقة وفق صلة القرابة والجنس وتسلسل الميلاد" }));
  const cleanCards = output.map((r) => r["رقم البطاقة النهائي"]), cleanNats = output.map((r) => r["الرقم الوطني المعدل"]);
  await write(outputFile, [{ name: "القائمة الموحدة النهائية", rows: output }]);
  const reasonCounts = new Map(); issues.forEach((r) => reasonCounts.set(r["أسباب الاستبعاد V14"], (reasonCounts.get(r["أسباب الاستبعاد V14"]) || 0) + 1));
  await write(issuesFile, [{ name: "متبقي بسبب الصلة أو الهوية", rows: issues }, { name: "ملخص", rows: [...reasonCounts].map(([reason, count]) => ({ السبب: reason, العدد: count })) }]);
  console.log(JSON.stringify({ inputRows: all.length, manualGenderUnresolved: all.filter((r) => gender(r) === "غير محسوم").length, finalRows: output.length, remainingIssues: issues.length, duplicateCards: cleanCards.length - new Set(cleanCards).size, duplicateNationals: cleanNats.length - new Set(cleanNats).size, outputFile, issuesFile }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
