const XLSX = require("xlsx");
const path = require("path");

function simulateParsing() {
  const filePath = path.join(__dirname, "../دفعة 20.xlsx");
  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

  let lastEmpNum = "";
  const mappedData = rawRows.map(row => {
    const keys = Object.keys(row);
    const values = Object.values(row).map(v => String(v || "").trim());

    const findKey = (keywords) => 
      keys.find(k => keywords.some(kw => String(k).includes(kw)));

    const nameKey = findKey(["الأسم", "الاسم", "الإسم", "اسم المستفيد", "اسم الموظف", "اسم العضو", "Full Name", "Name"]);
    const relKey = findKey(["صلة", "القرابة", "Relationship", "النوع", "الصلة", "Rel", "الصفة", "المستفيد", "العلاقة", "صفة"]);
    const bDateKey = findKey(["تاريخ الملاد", "الملاد", "ميلاد", "المواليد", "تاريخ الميلاد", "Birth", "BDate", "DOB", "تاريخ"]);
    const statusKey = findKey(["الحالة", "Status", "الوضع"]);
    const notesKey = findKey(["ملاحظات", "Notes", "البيان", "ملاحظة"]);
    const empNumKey = findKey(["الرقم الوظيفي", "رقم الموظف", "رقم العضو", "رقم التامين", "رقم التأمين", "Emp", "ID", "الرقم التسلسلي", "رقم"]);

    let name = nameKey ? row[nameKey] : "";
    let rel = relKey ? row[relKey] : "";
    let bDateRaw = bDateKey ? row[bDateKey] : "";
    let empNum = "";

    let extractedEmpNum = empNumKey ? String(row[empNumKey] || "").trim() : "";
    
    if (!extractedEmpNum && !empNumKey) {
       const potentialEmpNum = values.find(v => /^\d{3,}$/.test(v) && !v.includes('-') && !v.includes('/'));
       if (potentialEmpNum) extractedEmpNum = potentialEmpNum;
    }

    if (extractedEmpNum) {
      empNum = extractedEmpNum;
      lastEmpNum = empNum;
    } else if (lastEmpNum) {
      empNum = lastEmpNum;
    }

    const forbiddenWords = ["زوجة", "زوج", "ابن", "ابنة", "ابنه", "ابنته", "ام", "اب", "موظف", "موظفة", "متقاعد", "متقاعدة", "رب الأسرة", "وفاة", "موقوف", "بنت", "ولد", "والدة", "والد", "صاحب البطاقة"];
    
    if (!name || forbiddenWords.includes(String(name).trim())) {
      const candidates = values.filter(v => 
        v.length > 2 && !/^\d+$/.test(v) && !forbiddenWords.includes(v) &&
        /[\u0600-\u06FF]/.test(v) 
      );
      if (candidates.length > 0) {
        name = candidates.reduce((a, b) => b.length > a.length ? b : a, "");
      }
    }

    const relKeywords = ["زوجة", "زوج", "ابن", "ابنة", "ابنه", "ابنته", "ام", "أم", "والدة", "اب", "أب", "والد", "موظف", "موظفة", "رب الأسرة", "صاحب البطاقة", "بنت", "ولد"];
    if (!rel || rel.length < 2) {
      const foundRel = values.find(v => relKeywords.includes(v));
      if (foundRel) rel = foundRel;
    }

    return {
      name: String(name || "").trim(),
      employee_number: String(empNum || "").trim(),
      relationship: String(rel || "").trim(),
      keys_matched: {
        nameKey,
        relKey,
        bDateKey,
        empNumKey
      }
    };
  });

  const matches = mappedData.filter(item => item.name.includes("كمارة"));
  console.log("Parsed result for 'كمارة':", JSON.stringify(matches, null, 2));
}

simulateParsing();
