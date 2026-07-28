const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const root = path.join(process.cwd(), "reports", "jfz-cleanup");
const mainFile = path.join(root, "JFZ-01-final-V14-manual-gender-relationships.xlsx");
const reviewedFile = path.join(root, "JFZ-02-relationship-issues-V14.xlsx");
const outputFile = path.join(root, "JFZ-FINAL-V15-clean-verified.xlsx");
const text = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const digits = (v) => text(v).replace(/\D/g, "");
const norm = (v) => text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "", raw: true }); }
function gender(row) { const g = norm(row["جنس الشخص نفسه (معتمد يدوياً)"] || row["جنس الشخص نفسه"] || row._gender); return /انث/.test(g) ? "أنثى" : /ذكر/.test(g) ? "ذكر" : ""; }
function relation(row, g) {
  const raw = norm(row["الصلة المعتمدة بعد التحقق"] || row["الصلة المعتمدة"] || row["الصلة الحالية"] || row._relation);
  if (/موظف/.test(raw)) return { label: "الموظف", code: "" };
  if (/زوج/.test(raw)) return g === "أنثى" ? { label: "زوجة", code: "W" } : { label: "زوج", code: "H" };
  if (/^ام$|والده|mother/.test(raw)) return { label: "أم", code: "M" };
  if (/^اب$|والد|father/.test(raw)) return { label: "أب", code: "F" };
  if (/ابن|ابنه|بنت|ولد/.test(raw)) return g === "أنثى" ? { label: "ابنة", code: "D" } : { label: "ابن", code: "S" };
  return { label: text(raw), code: null };
}
function birth(row) { return text(row["تاريخ الميلاد"] || row["تاريخ الميلاد المعتمد"] || row["المواليد الحالية"] || row._birth); }
function birthSort(v) { const y = text(v).match(/(19\d{2}|20\d{2})/)?.[1]; return y ? `${y}-${text(v)}` : "9999"; }
function add(map, key, value) { const list = map.get(key) || []; list.push(value); map.set(key, list); }
function complete(row) { return Object.values(row).filter((v) => text(v)).length; }
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; if (ws.columnCount) ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17365D" } }; ws.columns.forEach((c) => c.width = Math.min(42, Math.max(13, ...c.values.slice(1, 120).map((v) => text(v).length + 2)))); }
async function main() {
  const raw = [...read(mainFile).map((r) => ({ ...r, source: "قائمة V14" })), ...read(reviewedFile, "متبقي بسبب الصلة أو الهوية").map((r) => ({ ...r, source: "تدقيق المستخدم النهائي" }))];
  const prepared = raw.map((r, i) => {
    const g = gender(r), rel = relation(r, g);
    return { raw: r, index: i, fin: digits(r["الرقم المالي"] || r._fin), name: text(r["الاسم"]), gender: g, relation: rel.label, code: rel.code, national: digits(r["الرقم الوطني المعدل"] || r["الرقم الوطني"] || r._national), birth: birth(r), source: r.source };
  });
  const errors = [];
  prepared.forEach((r) => { const e = []; if (!r.fin) e.push("رقم وظيفي مفقود"); if (!r.name) e.push("اسم مفقود"); if (!r.gender) e.push("جنس مفقود"); if (r.code === null) e.push("صلة غير معروفة"); if (r.national.length < 10) e.push("رقم وطني غير صالح"); if (e.length) errors.push({ ...r, error: e.join(" | ") }); });
  const structurallyValid = prepared.filter((r) => !errors.some((e) => e.index === r.index));
  const byNational = new Map(); structurallyValid.forEach((r) => add(byNational, r.national, r));
  const deduped = [];
  for (const [national, rows] of byNational) {
    if (rows.length === 1) { deduped.push(rows[0]); continue; }
    const names = new Set(rows.map((r) => norm(r.name)));
    if (names.size === 1) deduped.push([...rows].sort((a, b) => complete(b.raw) - complete(a.raw))[0]);
    else rows.forEach((r) => errors.push({ ...r, error: `الرقم الوطني ${national} مرتبط بأسماء مختلفة` }));
  }
  const families = new Map(); deduped.forEach((r) => add(families, r.fin, r));
  const final = [];
  for (const [fin, members] of families) {
    const employees = members.filter((r) => r.code === "");
    if (employees.length !== 1) { members.forEach((r) => errors.push({ ...r, error: employees.length ? "أكثر من موظف أساسي في العائلة" : "لا يوجد موظف أساسي في العائلة" })); continue; }
    const base = `JFZ2025${fin}`; employees[0].card = base; employees[0].sequence = 0;
    for (const code of ["W", "H", "M", "F", "D", "S"]) {
      const group = members.filter((r) => r.code === code).sort((a, b) => birthSort(a.birth).localeCompare(birthSort(b.birth)) || norm(a.name).localeCompare(norm(b.name)));
      group.forEach((r, i) => { r.sequence = i + 1; r.card = `${base}${code}${i + 1}`; });
    }
    final.push(...members);
  }
  const cards = new Map(); final.forEach((r) => add(cards, r.card, r));
  const conflictRows = new Set([...cards].filter(([, rows]) => rows.length > 1).flatMap(([, rows]) => rows));
  const safe = final.filter((r) => { if (!conflictRows.has(r)) return true; errors.push({ ...r, error: "بطاقة مكررة بعد الترقيم" }); return false; });
  const relationOrder = { "الموظف": 0, "زوجة": 1, "زوج": 1, "أم": 2, "أب": 2, "ابنة": 3, "ابن": 3 };
  safe.sort((a, b) => Number(a.fin) - Number(b.fin) || (relationOrder[a.relation] ?? 9) - (relationOrder[b.relation] ?? 9) || birthSort(a.birth).localeCompare(birthSort(b.birth)));
  const output = safe.map((r) => ({ "الرقم الوظيفي للعائلة": r.fin, "اسم المستفيد": r.name, "الجنس المعتمد": r.gender, "صلة القرابة المعتمدة": r.relation, "تاريخ الميلاد": r.birth, "رقم البطاقة النهائي": r.card, "الرقم الوطني": r.national, "تسلسل الفرد داخل نوعه": r.sequence, "مصدر الاعتماد": r.source }));
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("القائمة النهائية النظيفة"); ws.columns = Object.keys(output[0] || {}).map((key) => ({ header: key, key })); ws.addRows(output); style(ws);
  const check = wb.addWorksheet("نتيجة التحقق"); const finalCards = output.map((r) => r["رقم البطاقة النهائي"]), finalNats = output.map((r) => r["الرقم الوطني"]); const summary = [
    { الفحص: "السجلات الداخلة", النتيجة: raw.length }, { الفحص: "السجلات النهائية", النتيجة: output.length }, { الفحص: "تكرار البطاقات", النتيجة: finalCards.length - new Set(finalCards).size }, { الفحص: "تكرار الأرقام الوطنية", النتيجة: finalNats.length - new Set(finalNats).size }, { الفحص: "بطاقات فارغة", النتيجة: output.filter((r) => !r["رقم البطاقة النهائي"]).length }, { الفحص: "جنس غير محسوم", النتيجة: output.filter((r) => !r["الجنس المعتمد"]).length }, { الفحص: "صلة غير محسومة", النتيجة: output.filter((r) => !r["صلة القرابة المعتمدة"]).length }, { الفحص: "حالات لم تجتز التحقق", النتيجة: errors.length }
  ]; check.columns = Object.keys(summary[0]).map((key) => ({ header: key, key })); check.addRows(summary); style(check);
  if (errors.length) { const ew = wb.addWorksheet("حالات فشلت في التحقق"); const erows = errors.map((r) => ({ "الرقم الوظيفي": r.fin, الاسم: r.name, الجنس: r.gender, الصلة: r.relation, "الرقم الوطني": r.national, السبب: r.error })); ew.columns = Object.keys(erows[0]).map((key) => ({ header: key, key })); ew.addRows(erows); style(ew); }
  await wb.xlsx.writeFile(outputFile);
  console.log(JSON.stringify({ input: raw.length, final: output.length, failed: errors.length, duplicateCards: finalCards.length - new Set(finalCards).size, duplicateNationals: finalNats.length - new Set(finalNats).size, outputFile }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
