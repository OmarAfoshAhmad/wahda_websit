const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const SOURCE_ROOT = process.env.JFZ_SOURCE_ROOT || "D:/سطح المكتب/شركة وعد/JFZ";
const CLEAN_SOURCE = path.join(SOURCE_ROOT, "كشف جليانة النظيف.xlsx");
const TRUTH_SOURCE = path.join(SOURCE_ROOT, "كشف للرعاية الصحية المنطقة  بالأخطاء الحرة جليانة.xlsx");
const OUTPUT_ROOT = path.join(process.cwd(), "reports", "jfz-cleanup");

function text(value) { return String(value ?? "").trim().replace(/\s+/g, " "); }
function normName(value) {
  return text(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ـًٌٍَُِّْ]/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}
function firstNameKey(value) { return normName(text(value).split(/\s+/)[0] || ""); }
function explicitGenderValue(value) {
  const g = text(value).toLowerCase();
  if (/female|انث/.test(g)) return "أنثى";
  if (/male|ذكر/.test(g)) return "ذكر";
  return "غير معروف";
}
function digits(value) { return text(value).replace(/\.0$/, "").replace(/\D/g, ""); }
function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  if (typeof value === "number" && value > 10000) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = text(value);
  const year = s.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return year ? `${year}-01-01` : "";
}
function inferGender(explicitGender, relationship) {
  const g = text(explicitGender).toLowerCase();
  const r = text(relationship).toLowerCase();
  const fromExplicit = /female|انث/.test(g) ? "أنثى" : /male|ذكر/.test(g) ? "ذكر" : "غير معروف";
  const fromRelationship = /daughter|wife|ابنه|ابنة|بنت|زوجه|زوجة/.test(r) ? "أنثى" : /son|husband|ابن|ولد/.test(r) ? "ذكر" : "غير معروف";
  const conflict = fromExplicit !== "غير معروف" && fromRelationship !== "غير معروف" && fromExplicit !== fromRelationship;
  return {
    gender: fromExplicit !== "غير معروف" ? fromExplicit : fromRelationship,
    evidence: fromExplicit !== "غير معروف" ? `حقل Gender الصريح: ${explicitGender}` : fromRelationship !== "غير معروف" ? `دلالة صلة القرابة: ${relationship}` : "لا يوجد دليل صريح",
    confidence: fromExplicit !== "غير معروف" ? "صريح" : fromRelationship !== "غير معروف" ? "دلالة صلة" : "غير محسوم",
    conflict,
  };
}
function relationInfo(relation, gender) {
  const r = text(relation).toLowerCase();
  const g = text(gender).toLowerCase();
  if (/employee|الموظف|موظف/.test(r)) return { relation: "الموظف", code: "" };
  if (/wife|زوجه|زوجة/.test(r) || (r === "زوج" && /female|انث/.test(g))) return { relation: "زوجة", code: "W" };
  if (/husband/.test(r) || (r === "زوج" && /male|ذكر/.test(g))) return { relation: "زوج", code: "H" };
  if (/daughter|ابنه|ابنة|بنت/.test(r) || (r === "ابن" && /female|انث/.test(g))) return { relation: "ابنة", code: "D" };
  if (/son/.test(r) || (r === "ابن" && /male|ذكر/.test(g))) return { relation: "ابن", code: "S" };
  if (/mother|^ام$|^أم$/.test(r)) return { relation: "أم", code: "M" };
  if (/father|^اب$|^أب$/.test(r)) return { relation: "أب", code: "F" };
  return { relation: text(relation), code: null };
}
function rows(file, sheet) {
  // Keep Excel serial dates as numbers. Converting them to JS Date here can
  // shift midnight to the previous day depending on the machine timezone.
  const wb = XLSX.readFile(file, { cellDates: false });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: "", raw: true });
}
function baseFromCard(card) {
  const m = text(card).toUpperCase().match(/^JFZ(?:2025)?(\d+?)(?:[A-Z]\d*)?$/);
  return m?.[1]?.replace(/^0+/, "") || "";
}
function loadEnv() {
  const env = path.join(process.cwd(), ".env");
  if (!fs.existsSync(env)) return false;
  const line = fs.readFileSync(env, "utf8").split(/\r?\n/).find((x) => /^\s*DATABASE_URL\s*=/.test(x));
  if (!line) return false;
  process.env.DATABASE_URL = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
  return true;
}
function addIndex(map, key, value) { if (!key) return; const list = map.get(key) || []; list.push(value); map.set(key, list); }
function uniquePeople(items) {
  const seen = new Set();
  return items.filter((x) => { const key = `${x.fin}|${x.national}|${x.nameKey}|${x.relationRaw}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
function styleSheet(ws) {
  ws.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: ws.getRow(1).getCell(ws.columnCount).address };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
  ws.columns.forEach((column) => { column.width = Math.min(45, Math.max(13, ...column.values.slice(1, 150).map((v) => text(v).length + 2))); });
}
async function writeWorkbook(file, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JFZ conservative cleanup audit";
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name);
    ws.columns = spec.columns.map(([header, key, width]) => ({ header, key, width }));
    ws.addRows(spec.rows);
    styleSheet(ws);
  }
  await wb.xlsx.writeFile(file);
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const cleanRows = rows(CLEAN_SOURCE, "كشف جليانة النظيف");
  const truth = [];
  for (const row of rows(TRUTH_SOURCE, "موظف")) truth.push({ fin: digits(row.Sequence), name: text(row["Employee Name"]), relationRaw: text(row["الصلة"] || "Employee"), gender: "", birth: excelDate(row["Date of Birth"]), national: digits(row["Idenfication NO"]), sourceSheet: "موظف" });
  for (const row of rows(TRUTH_SOURCE, "المنتفعين")) truth.push({ fin: digits(row["الرقم الوظيفي"]), name: text(row["الاســـــــــــم"]), relationRaw: text(row["الصلة"]), gender: text(row.Gender), birth: excelDate(row["الموليد"]), national: digits(row["الرقم الوطني"]), sourceSheet: "المنتفعين" });
  truth.forEach((x, i) => {
    x.nameKey = normName(x.name);
    x.order = i;
    x.explicitGenderRaw = x.gender;
    Object.assign(x, inferGender(x.gender, x.relationRaw));
    Object.assign(x, relationInfo(x.relationRaw, x.gender));
  });
  const firstNameStats = new Map();
  for (const person of truth) {
    const gender = explicitGenderValue(person.explicitGenderRaw);
    const key = firstNameKey(person.name);
    if (!key || gender === "غير معروف") continue;
    const stat = firstNameStats.get(key) || { male: 0, female: 0, examples: [] };
    if (gender === "ذكر") stat.male += 1; else stat.female += 1;
    if (stat.examples.length < 3) stat.examples.push(person.name);
    firstNameStats.set(key, stat);
  }
  function genderFromFirstName(name) {
    const key = firstNameKey(name);
    const stat = firstNameStats.get(key);
    if (!stat) return { gender: "غير محسوم", confidence: "غير محسوم", evidence: "الاسم الأول غير موجود في قاموس Gender الصريح" };
    const total = stat.male + stat.female;
    if (total < 2 || (stat.male > 0 && stat.female > 0)) return { gender: "غير محسوم", confidence: "غير محسوم", evidence: `الاسم الأول غير حاسم: ذكر ${stat.male} / أنثى ${stat.female}` };
    const gender = stat.male ? "ذكر" : "أنثى";
    return { gender, confidence: "قاموس اسم أول متطابق", evidence: `الاسم الأول ظهر ${total} مرة في صفوف Gender الصريحة، كلها ${gender}` };
  }
  const employeeGenderByFin = new Map();
  for (const employee of truth.filter((x) => x.sourceSheet === "موظف")) {
    const spouses = truth.filter((x) => x.fin === employee.fin && /wife|husband|زوج|زوجه|زوجة/i.test(x.relationRaw) && x.gender !== "غير معروف" && x.confidence === "صريح");
    const spouseGenders = new Set(spouses.map((x) => x.gender));
    const nameInference = genderFromFirstName(employee.name);
    if (spouseGenders.size === 1) {
      const spouseGender = [...spouseGenders][0];
      const familyGender = spouseGender === "أنثى" ? "ذكر" : "أنثى";
      if (nameInference.gender !== "غير محسوم" && nameInference.gender !== familyGender) employeeGenderByFin.set(employee.fin, { gender: "غير محسوم", evidence: `تعارض: الاستدلال العائلي ${familyGender} لكن قاموس الاسم ${nameInference.gender}`, confidence: "تعارض أدلة", name: employee.name });
      else employeeGenderByFin.set(employee.fin, { gender: familyGender, evidence: `استدلال عكسي من جنس الزوج/الزوجة الصريح: ${spouses[0].name} (${spouseGender})؛ ${nameInference.evidence}`, confidence: nameInference.gender === familyGender ? "دليلان متوافقان" : "استدلال عائلي", name: employee.name });
    } else if (spouseGenders.size > 1) employeeGenderByFin.set(employee.fin, { gender: "غير محسوم", evidence: "أكثر من جنس متعارض للزوج/الزوجة", confidence: "تعارض أدلة", name: employee.name });
    else employeeGenderByFin.set(employee.fin, { ...nameInference, name: employee.name });
  }
  for (const member of truth) {
    const employee = employeeGenderByFin.get(member.fin);
    member.employeeGender = employee?.gender || "غير معروف";
    member.employeeGenderEvidence = employee ? `${employee.evidence} — ${employee.name}` : "لا يوجد موظف مرجعي للعائلة";
    const raw = text(member.relationRaw).toLowerCase();
    const isSpouse = /wife|husband|زوج|زوجه|زوجة/.test(raw);
    if (!isSpouse) continue;
    const expectedSpouseGender = member.employeeGender === "ذكر" ? "أنثى" : member.employeeGender === "أنثى" ? "ذكر" : "غير معروف";
    const labelGender = /wife|زوجه|زوجة/.test(raw) ? "أنثى" : /husband/.test(raw) ? "ذكر" : "غير معروف";
    member.sourceLabelConflict = labelGender !== "غير معروف" && member.gender !== "غير معروف" && labelGender !== member.gender;
    member.demographicConflict =
      (expectedSpouseGender !== "غير معروف" && member.gender !== "غير معروف" && expectedSpouseGender !== member.gender);
    const resolvedGender = expectedSpouseGender !== "غير معروف" ? expectedSpouseGender : member.gender;
    member.relation = resolvedGender === "أنثى" ? "زوجة" : resolvedGender === "ذكر" ? "زوج" : text(member.relationRaw);
    member.code = resolvedGender === "أنثى" ? "W" : resolvedGender === "ذكر" ? "H" : null;
  }

  const byNational = new Map(), byFamilyName = new Map();
  truth.forEach((x) => { addIndex(byNational, x.national, x); addIndex(byFamilyName, `${x.fin}|${x.nameKey}`, x); });
  // Employees have no suffix. Children are numbered independently by gender
  // from oldest to youngest (earliest birth date gets 1). Other relations keep
  // their stable source order. A child without a birth date is deliberately
  // left unresolved so it cannot silently receive a misleading sequence.
  for (const x of truth) {
    if (x.code === "") x.expectedCard = `JFZ2025${x.fin}`;
    else if (x.code === null) x.expectedCard = "";
  }
  const numberedGroups = new Map();
  for (const x of truth.filter((item) => item.code && item.code !== "")) addIndex(numberedGroups, `${x.fin}|${x.code}`, x);
  for (const [, group] of numberedGroups) {
    const isChildGroup = group[0].code === "S" || group[0].code === "D";
    const ordered = [...group].sort((a, b) => {
      if (isChildGroup) {
        if (!a.birth && b.birth) return 1;
        if (a.birth && !b.birth) return -1;
        const byBirth = text(a.birth).localeCompare(text(b.birth));
        if (byBirth) return byBirth;
      }
      return a.order - b.order;
    });
    let sequence = 0;
    for (const x of ordered) {
      if (isChildGroup && !x.birth) { x.expectedCard = ""; continue; }
      sequence += 1;
      x.expectedCard = `JFZ2025${x.fin}${x.code}${sequence}`;
    }
  }

  const confirmed = [], review = [];
  for (const row of cleanRows) {
    const currentCard = text(row["الرقم ت"]).toUpperCase();
    const fin = digits(row["الرقم المالي"]) || baseFromCard(currentCard);
    const national = digits(row["الرقم الوطني"]);
    const name = text(row["الاسم"]), nameKey = normName(name);
    const natMatches = uniquePeople(byNational.get(national) || []);
    const familyMatches = uniquePeople(byFamilyName.get(`${fin}|${nameKey}`) || []);
    let matches = natMatches.length === 1 ? natMatches : familyMatches;
    let reason = "";
    if (natMatches.length > 1) reason = "الرقم الوطني مرتبط بأكثر من هوية أو عائلة في المصدر";
    else if (natMatches.length === 1 && natMatches[0].fin !== fin) reason = `الرقم الوطني يعود في المصدر إلى العائلة ${natMatches[0].fin} وليس ${fin}`;
    else if (matches.length !== 1) reason = matches.length ? "أكثر من سجل مصدر محتمل" : "لا يوجد تطابق موثوق في ملف المصدر المرجعي";
    else if (matches[0].demographicConflict) reason = "تعارض بين جنس الموظف وجنس التابع أو وصف Husband/Wife في المصدر";
    else if (!matches[0].expectedCard || matches[0].code === null) reason = "صلة القرابة أو الجنس غير كافيين لإنشاء بطاقة آمنة";
    const evidence = matches.length === 1 ? matches[0] : null;
    const employeeGender = evidence?.employeeGender || employeeGenderByFin.get(fin)?.gender || "غير محسوم";
    const employeeGenderEvidence = evidence?.employeeGenderEvidence || (employeeGenderByFin.has(fin) ? `${employeeGenderByFin.get(fin).evidence} — ${employeeGenderByFin.get(fin).name}` : "لا يوجد موظف مرجعي للعائلة");
    const isEmployeeRow = evidence?.sourceSheet === "موظف" || evidence?.code === "";
    const personGender = isEmployeeRow && employeeGender !== "غير محسوم" ? employeeGender : evidence?.gender || "غير معروف";
    const personGenderConfidence = isEmployeeRow && employeeGender !== "غير محسوم" ? employeeGenderByFin.get(fin)?.confidence || "غير محسوم" : evidence?.confidence || "غير محسوم";
    const personGenderEvidence = isEmployeeRow && employeeGender !== "غير محسوم" ? employeeGenderEvidence : evidence?.evidence || "لا يوجد تطابق موثوق";
    const common = { الرقم_المالي: fin, الاسم: name, جنس_الشخص_نفسه: personGender, درجة_ثقة_جنس_الشخص: personGenderConfidence, دليل_جنس_الشخص: personGenderEvidence, الصلة_الحالية: text(row["الصلة"]), الرقم_الوطني: national, البطاقة_الحالية: currentCard, المواليد_الحالية: text(row["المواليد"]), جنس_الموظف_صاحب_العائلة_وليس_جنس_هذا_الصف: employeeGender, درجة_ثقة_جنس_صاحب_العائلة: employeeGenderByFin.get(fin)?.confidence || "غير محسوم", دليل_جنس_صاحب_العائلة: employeeGenderEvidence, تنبيه_وصف_المصدر: evidence?.sourceLabelConflict ? `الوصف ${evidence.relationRaw} يتعارض مع حقل Gender؛ تم اعتماد Gender الصريح` : "", ملف_المصدر: text(row["مصدر الملف"]) };
    if (reason) review.push({ ...common, سبب_المراجعة: reason, التطابقات_بالرقم_الوطني: natMatches.length, التطابقات_بالعائلة_والاسم: familyMatches.length, الحل_المقترح: "مراجعة الهوية والرقم المالي من المستند الرسمي قبل أي تعديل" });
    else confirmed.push({ ...common, الصلة_المعتمدة: evidence.relation, الجنس_المعتمد: evidence.gender, تاريخ_الميلاد_المعتمد: evidence.birth, البطاقة_النظيفة: evidence.expectedCard, نوع_التغيير: currentCard === evidence.expectedCard ? "لا تغيير" : "تصحيح بطاقة", دليل_القرار: `${path.basename(TRUTH_SOURCE)} / ${evidence.sourceSheet}` });
  }

  const cardOwners = new Map();
  confirmed.forEach((x) => addIndex(cardOwners, x.البطاقة_النظيفة, x));
  const safeConfirmed = [];
  for (const [card, list] of cardOwners) {
    const identities = new Set(list.map((x) => `${x.الرقم_الوطني}|${normName(x.الاسم)}`));
    if (identities.size === 1) {
      const preferred = list.find((x) => x.البطاقة_الحالية === card) || list[0];
      safeConfirmed.push(preferred);
      list.filter((x) => x !== preferred).forEach((x) => review.push({ ...x, سبب_المراجعة: "سجل مصدر مكرر لنفس الشخص وتم اعتماد سجل واحد فقط", الحل_المقترح: `عدم استيراد هذا الصف؛ السجل المعتمد هو ${card}` }));
    } else list.forEach((x) => review.push({ ...x, سبب_المراجعة: "البطاقة النظيفة المقترحة مكررة لهويات مختلفة", الحل_المقترح: "حل تعارض الهوية قبل الاستيراد" }));
  }

  const allCols = (sample) => Object.keys(sample || {}).map((key) => [key.replaceAll("_", " "), key, 22]);
  const cleanExport = safeConfirmed.map((x) => ({
    الرقم_المالي: x.الرقم_المالي,
    الاسم: x.الاسم,
    جنس_الشخص_نفسه: x.جنس_الشخص_نفسه,
    درجة_ثقة_جنس_الشخص: x.درجة_ثقة_جنس_الشخص,
    الصلة_المعتمدة: x.الصلة_المعتمدة,
    تاريخ_الميلاد_المعتمد: x.تاريخ_الميلاد_المعتمد,
    البطاقة_النظيفة: x.البطاقة_النظيفة,
    الرقم_الوطني: x.الرقم_الوطني,
    جنس_الموظف_صاحب_العائلة_وليس_جنس_هذا_الصف: x.جنس_الموظف_صاحب_العائلة_وليس_جنس_هذا_الصف,
    درجة_ثقة_جنس_صاحب_العائلة: x.درجة_ثقة_جنس_صاحب_العائلة,
    البطاقة_الحالية: x.البطاقة_الحالية,
    نوع_التغيير: x.نوع_التغيير,
    دليل_جنس_الشخص: x.دليل_جنس_الشخص,
    دليل_جنس_صاحب_العائلة: x.دليل_جنس_صاحب_العائلة,
    تنبيه_وصف_المصدر: x.تنبيه_وصف_المصدر,
    دليل_القرار: x.دليل_القرار,
    ملف_المصدر: x.ملف_المصدر,
  }));
  const versionSuffix = process.env.JFZ_OUTPUT_SUFFIX || "";
  await writeWorkbook(path.join(OUTPUT_ROOT, `JFZ-01-clean-confirmed${versionSuffix}.xlsx`), [{ name: "بيانات نظيفة مؤكدة", columns: allCols(cleanExport[0]), rows: cleanExport }]);
  await writeWorkbook(path.join(OUTPUT_ROOT, `JFZ-02-manual-review${versionSuffix}.xlsx`), [{ name: "تحتاج مراجعة", columns: allCols(review[0]), rows: review }]);

  const systemIssues = [];
  if (loadEnv()) {
    const prisma = new PrismaClient();
    try {
      const dbRows = await prisma.beneficiary.findMany({ where: { deleted_at: null, card_number: { startsWith: "JFZ" } }, select: { id: true, card_number: true, name: true, birth_date: true, total_balance: true, remaining_balance: true, _count: { select: { transactions: true } } } });
      const byCard = new Map(), byDbName = new Map();
      dbRows.forEach((x) => { addIndex(byCard, text(x.card_number).toUpperCase(), x); addIndex(byDbName, normName(x.name), x); });
      for (const clean of safeConfirmed) {
        const expected = clean.البطاقة_النظيفة, current = clean.البطاقة_الحالية;
        const expectedRows = byCard.get(expected) || [], currentRows = byCard.get(current) || [], nameRows = byDbName.get(normName(clean.الاسم)) || [];
        const exact = expectedRows.find((x) => normName(x.name) === normName(clean.الاسم));
        if (exact) {
          const dbBirth = exact.birth_date?.toISOString().slice(0, 10) || "";
          if (!dbBirth && clean.تاريخ_الميلاد_المعتمد) systemIssues.push({ الاسم: clean.الاسم, البطاقة_في_المنظومة: exact.card_number, البطاقة_الصحيحة: expected, نوع_المشكلة: "تاريخ الميلاد مفقود", القيمة_الصحيحة: clean.تاريخ_الميلاد_المعتمد, الحركات: exact._count.transactions, الحل: "تحديث تاريخ الميلاد فقط من المصدر الموثق", أمان_التنفيذ: "آمن بعد المعاينة" });
          continue;
        }
        const candidate = currentRows.find((x) => normName(x.name) === normName(clean.الاسم)) || null;
        if (candidate && expectedRows.length === 0) systemIssues.push({ الاسم: clean.الاسم, البطاقة_في_المنظومة: candidate.card_number, البطاقة_الصحيحة: expected, نوع_المشكلة: "بطاقة غير مطابقة للمصدر النظيف", القيمة_الصحيحة: expected, الحركات: candidate._count.transactions, الحل: "إعادة تسمية البطاقة مع حفظ السجل والحركات والرصيد دون إنشاء مستفيد جديد", أمان_التنفيذ: "آمن بشرط معاملة ذرية وسجل مراجعة" });
        else if (expectedRows.length && !exact) systemIssues.push({ الاسم: clean.الاسم, البطاقة_في_المنظومة: candidate?.card_number || "غير موجود", البطاقة_الصحيحة: expected, نوع_المشكلة: "البطاقة الصحيحة يشغلها اسم مختلف", القيمة_الصحيحة: expected, الحركات: candidate?._count.transactions || 0, الحل: "مراجعة يدوية ومنع التعديل الآلي", أمان_التنفيذ: "غير آمن آلياً" });
        else if (!candidate && nameRows.length) systemIssues.push({ الاسم: clean.الاسم, البطاقة_في_المنظومة: nameRows.map((x) => x.card_number).join(" | "), البطاقة_الصحيحة: expected, نوع_المشكلة: "الاسم موجود تحت عائلة أخرى", القيمة_الصحيحة: expected, الحركات: nameRows.reduce((sum, x) => sum + x._count.transactions, 0), الحل: "مراجعة الرقم الوطني والانتقال الوظيفي؛ يمنع الدمج اعتماداً على الاسم", أمان_التنفيذ: "غير آمن آلياً" });
        else if (!candidate) systemIssues.push({ الاسم: clean.الاسم, البطاقة_في_المنظومة: "غير موجود", البطاقة_الصحيحة: expected, نوع_المشكلة: "مستفيد مؤكد غير موجود في المنظومة", القيمة_الصحيحة: expected, الحركات: 0, الحل: "إدراج في دفعة استيراد مستقلة بعد التحقق من حالة الاستحقاق", أمان_التنفيذ: "يحتاج اعتماد" });
      }
    } finally { await prisma.$disconnect(); }
  } else systemIssues.push({ نوع_المشكلة: "تعذر فحص المنظومة", الحل: "DATABASE_URL غير متوفر" });

  await writeWorkbook(path.join(OUTPUT_ROOT, `JFZ-03-system-problems-and-solutions${versionSuffix}.xlsx`), [{ name: "مشاكل المنظومة وحلولها", columns: allCols(systemIssues[0]), rows: systemIssues }]);
  const employeeGenderCounts = [...employeeGenderByFin.values()].reduce((acc, item) => { acc[item.gender] = (acc[item.gender] || 0) + 1; return acc; }, {});
  const usableFirstNames = [...firstNameStats.values()].filter((x) => x.male + x.female >= 2 && !(x.male && x.female)).length;
  const summary = { sourceRows: cleanRows.length, truthRows: truth.length, usableFirstNames, employeeGenderCounts, cleanConfirmed: safeConfirmed.length, manualReview: review.length, proposedCardChanges: safeConfirmed.filter((x) => x.نوع_التغيير !== "لا تغيير").length, systemIssues: systemIssues.length, output: OUTPUT_ROOT };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
