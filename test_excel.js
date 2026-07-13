const XLSX = require('xlsx');

function testFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const wsname = wb.SheetNames[0];
  const ws = wb.Sheets[wsname];

  const merges = ws['!merges'] || [];
  merges.forEach(merge => {
    const startCell = ws[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })];
    if (!startCell) return;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { ...startCell };
      }
    }
  });

  const rawRows = XLSX.utils.sheet_to_json(ws);
  console.log("Raw rows count:", rawRows.length);
  
  const allKeys = Array.from(new Set(rawRows.flatMap(row => Object.keys(row))));
  
  const findKeyInList = (keysList, keywords) => 
    keysList.find(k => {
      const strK = String(k).trim();
      return keywords.some(kw => {
        if (kw === "رقم") return strK === "رقم";
        return strK.includes(kw);
      });
    });

  const nameKey = findKeyInList(allKeys, ["الأسم", "الاسم", "الإسم", "اسم المستفيد", "اسم الموظف", "اسم العضو", "Full Name", "Name"]);
  const relKey = findKeyInList(allKeys, ["صلة", "القرابة", "Relationship", "النوع", "الصلة", "Rel", "الصفة", "العلاقة", "صفة"]);
  const bDateKey = findKeyInList(allKeys, ["تاريخ الملاد", "الملاد", "ميلاد", "المواليد", "تاريخ الميلاد", "Birth", "BDate", "DOB", "تاريخ"]);
  const statusKey = findKeyInList(allKeys, ["الحالة", "Status", "الوضع", "Statue", "الوضعية"]);
  const notesKey = findKeyInList(allKeys, ["ملاحظات", "Notes", "البيان", "ملاحظة"]);
  const empNumKey = findKeyInList(allKeys, ["الرقم الوظيفي", "رقم الوظيفي", "وظيفي", "رقم الموظف", "رقم العضو", "رقم التامين", "رقم التأمين", "Emp", "ID", "رقم"]);

  let lastEmpNum = ""; 
  const mappedData = rawRows.map(row => {
    const values = Object.values(row).map(v => String(v || "").trim());

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

    const relKeywords = ["زوجة", "زوج", "ابن", "ابنة", "ابنه", "ابنته", "ابه", "ام", "أم", "والدة", "اب", "أب", "والد", "موظف", "موظفة", "رب الأسرة", "صاحب البطاقة", "بنت", "ولد", "عضو جمارك", "عضو الجمارك", "(عضو جمارك)", "(عضو الجمارك)", "عضو"];
    if (!rel || rel.length < 2) {
      const foundRel = values.find(v => relKeywords.includes(v));
      if (foundRel) rel = foundRel;
    }
    
    let bDate = bDateRaw;

    return {
      originalRow: row,
      name: String(name || "").trim(),
      employee_number: String(empNum || "").trim(),
      relationship: String(rel || "").trim(),
      birth_date: bDate,
      field3: notesKey ? String(row[notesKey] || "").trim() : "",
    };
  });

  const filteredData = mappedData.filter(item => {
    if (!item.name || item.name.length <= 2) return false;
    if (item.name.includes("#N/A") || item.name.includes("#VALUE!") || item.name.includes("#REF!")) return false;
    if (!/[a-zA-Z\u0600-\u06FF]/.test(item.name)) return false;
    
    const hasSpace = item.name.trim().includes(" ");
    if (!hasSpace && !item.birth_date && !item.relationship) return false;
    if (item.name === item.field3 && !item.birth_date && !item.relationship) return false;

    return true;
  });

  console.log("Filtered count:", filteredData.length);
  if (filteredData.length > 40) {
    console.log("Showing some excess rows (index 40+):");
    console.dir(filteredData.slice(40, 45), { depth: null });
  }
}

testFile('c:\\Users\\Omar\\waad_temp_website\\20.xlsx');
