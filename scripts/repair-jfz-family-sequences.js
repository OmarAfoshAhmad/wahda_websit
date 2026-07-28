const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

const root = path.join(process.cwd(), "reports", "jfz-cleanup");
const truthFile = "D:/سطح المكتب/شركة وعد/JFZ/كشف للرعاية الصحية المنطقة  بالأخطاء الحرة جليانة.xlsx";
const cleanInput = path.join(root, "JFZ-01-clean-confirmed-V11-from-user-edits.xlsx");
const reviewInput = path.join(root, "JFZ-02-manual-review-V11-deduplicated.xlsx");
const cleanOutput = path.join(root, "JFZ-01-clean-confirmed-V12-family-sequences.xlsx");
const reviewOutput = path.join(root, "JFZ-02-manual-review-V12-family-sequences.xlsx");

const text = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const digits = (v) => text(v).replace(/\D/g, "");
const norm = (v) => text(v).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
function date(serial) { const d = XLSX.SSF.parse_date_code(Number(serial)); return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : text(serial); }
function read(file, sheet) { const w = XLSX.readFile(file); return XLSX.utils.sheet_to_json(w.Sheets[sheet || w.SheetNames[0]], { defval: "", raw: true }); }
function add(map, key, value) { const list = map.get(key) || []; list.push(value); map.set(key, list); }
function relation(raw, gender) {
  const r = text(raw).toLowerCase(), g = text(gender).toLowerCase();
  if (/employee|موظف/.test(r)) return { label: "الموظف", code: "" };
  if (/daughter/.test(r)) return { label: "ابنة", code: "D" };
  if (/son/.test(r)) return { label: "ابن", code: "S" };
  if (/wife/.test(r) || (/زوج/.test(r) && /female/.test(g))) return { label: "زوجة", code: "W" };
  if (/husband/.test(r) || (/زوج/.test(r) && /male/.test(g))) return { label: "زوج", code: "H" };
  if (/mother/.test(r)) return { label: "أم", code: "M" };
  if (/father/.test(r)) return { label: "أب", code: "F" };
  return { label: text(raw), code: null };
}
function style(ws) { ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }]; if (ws.columnCount) ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address }; ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; ws.columns.forEach((c) => c.width = Math.min(48, Math.max(14, ...c.values.slice(1, 100).map((v) => text(v).length + 2)))); }
async function write(file, sheets) { const w = new ExcelJS.Workbook(); for (const spec of sheets) { const ws = w.addWorksheet(spec.name); const headers = [...new Set(spec.rows.flatMap(Object.keys))]; ws.columns = headers.map((key) => ({ header: key, key })); ws.addRows(spec.rows); style(ws); } await w.xlsx.writeFile(file); }

async function main() {
  const truth = [];
  read(truthFile, "موظف").forEach((r, order) => truth.push({ fin: digits(r.Sequence), name: text(r["Employee Name"]), national: digits(r["Idenfication NO"]), birth: date(r["Date of Birth"]), gender: "", rawRelation: r["الصلة"] || "Employee", order }));
  read(truthFile, "المنتفعين").forEach((r, order) => truth.push({ fin: digits(r["الرقم الوظيفي"]), name: text(r["الاســـــــــــم"]), national: digits(r["الرقم الوطني"]), birth: date(r["الموليد"]), gender: text(r.Gender), rawRelation: r["الصلة"], order: 100000 + order }));
  truth.forEach((r) => Object.assign(r, relation(r.rawRelation, r.gender)));
  const byNational = new Map(), groups = new Map();
  truth.forEach((r) => { if (r.national) add(byNational, r.national, r); if (r.code !== null && r.code !== "") add(groups, `${r.fin}|${r.code}`, r); else if (r.code === "") r.card = `JFZ2025${r.fin}`; });
  for (const [, members] of groups) {
    const child = ["S", "D"].includes(members[0].code);
    members.sort((a, b) => child ? a.birth.localeCompare(b.birth) || a.order - b.order : a.order - b.order);
    members.forEach((r, i) => r.card = `JFZ2025${r.fin}${r.code}${i + 1}`);
  }

  const rw = XLSX.readFile(reviewInput);
  const reviewRows = XLSX.utils.sheet_to_json(rw.Sheets["متبقي للمراجعة"], { defval: "", raw: true });
  const oldResolved = XLSX.utils.sheet_to_json(rw.Sheets["تكرارات محلولة"], { defval: "", raw: true });
  const remaining = [], familyFixed = [];
  for (const row of reviewRows) {
    const national = digits(row["الرقم الوطني"]), matches = byNational.get(national) || [];
    const unique = matches.length === 1 ? matches[0] : null;
    if (!unique || !unique.card) { remaining.push(row); continue; }
    const currentFin = digits(row["الرقم المالي"]), currentCard = text(row.A || row["البطاقة النظيفة"] || row["البطاقة الحالية"]);
    if (currentFin === unique.fin && currentCard.toUpperCase() === unique.card) { remaining.push(row); continue; }
    familyFixed.push({ ...row, "الرقم المالي السابق": currentFin, "البطاقة السابقة": currentCard, "الرقم المالي": unique.fin, "الاسم": text(row["الاسم"]) || unique.name, "جنس الشخص نفسه": /female/i.test(unique.gender) ? "أنثى" : /male/i.test(unique.gender) ? "ذكر" : row["جنس الشخص نفسه"], "الصلة الحالية": unique.label, "الرقم الوطني": unique.national, A: unique.card, "المواليد الحالية": unique.birth, "قرار V12": "إعادة ربط بالرقم الوظيفي الصحيح من المرجع بواسطة الرقم الوطني وإعادة تسلسل العائلة" });
  }

  const clean = read(cleanInput);
  const identity = new Map();
  clean.forEach((r) => identity.set(digits(r["الرقم الوطني"]) ? `N:${digits(r["الرقم الوطني"])}` : `F:${digits(r["الرقم المالي"])}|${norm(r["الاسم"])}`, r));
  for (const r of familyFixed) {
    const key = `N:${digits(r["الرقم الوطني"])}`;
    identity.set(key, { "الرقم المالي": r["الرقم المالي"], "الاسم": r["الاسم"], "جنس الشخص نفسه": r["جنس الشخص نفسه"], "درجة ثقة جنس الشخص": "صريح من المرجع", "الصلة المعتمدة": r["الصلة الحالية"], "تاريخ الميلاد المعتمد": r["المواليد الحالية"], "البطاقة النظيفة": r.A, "الرقم الوطني": r["الرقم الوطني"], "البطاقة الحالية": r["البطاقة السابقة"], "نوع التغيير": "تصحيح الرقم الوظيفي وتسلسل العائلة V12", "دليل القرار": r["قرار V12"], "ملف المصدر": path.basename(truthFile) });
  }
  const candidateClean = [...identity.values()];
  const cards = new Map(); candidateClean.forEach((r) => add(cards, text(r["البطاقة النظيفة"]).toUpperCase(), r));
  const conflicts = new Set([...cards].filter(([card, list]) => card && list.length > 1).flatMap(([, list]) => list));
  const safeClean = candidateClean.filter((r) => !conflicts.has(r));
  conflicts.forEach((r) => remaining.push({ ...r, "قرار V12": "بقي للمراجعة بسبب تعارض بطاقة بعد توحيد العائلة" }));

  await write(cleanOutput, [{ name: "نظيف بعد توحيد العائلات", rows: safeClean }]);
  await write(reviewOutput, [{ name: "متبقي للمراجعة", rows: remaining }, { name: "عائلات أعيد توحيدها", rows: familyFixed }, { name: "تكرارات V11 المحلولة", rows: oldResolved }]);
  console.log(JSON.stringify({ reviewInput: reviewRows.length, familiesCorrectedRows: familyFixed.length, remainingReview: remaining.length, cleanOutput: safeClean.length, cardConflictsMovedToReview: conflicts.size, cleanOutputFile: cleanOutput, reviewOutputFile: reviewOutput }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
