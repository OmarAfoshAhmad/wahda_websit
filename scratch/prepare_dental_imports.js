const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputDir = 'c:\\Users\\Omar\\waad_temp_website\\اسماء شركات الاسنان';
const outputDir = 'c:\\Users\\Omar\\waad_temp_website\\اسماء شركات الاسنان جاهزة للاستيراد';

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Convert Excel Serial Date to YYYY-MM-DD
function parseExcelDate(val) {
  if (!val) return "";
  
  if (typeof val === 'number') {
    try {
      // Excel base date is Dec 30, 1899 due to 1900 leap year bug
      const date = new Date((val - 25569) * 86400 * 1000);
      if (isNaN(date.getTime())) return "";
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return "";
    }
  }
  
  const str = String(val).trim();
  if (str === "____" || str === "لا يوجد" || str.includes(">>>>")) return "";
  
  // Try to parse typical DD/MM/YYYY or DD-MM-YYYY format
  const match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  
  // Try to parse YYYY-MM-DD
  const matchIso = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (matchIso) {
    const year = matchIso[1];
    const month = matchIso[2].padStart(2, '0');
    const day = matchIso[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return str;
}

// Clean and normalize name
function cleanName(name) {
  if (!name) return "";
  return String(name).trim().replace(/\s+/g, " ").toUpperCase();
}

// Clean and normalize card number
function cleanCard(card) {
  if (!card) return "";
  return String(card).trim().replace(/[\s\u200E\u200F\u202A-\u202E]/g, "").toUpperCase();
}

function processCompanyExcel(inputFile, outputFileName, mappings) {
  const inputPath = path.join(inputDir, inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputFile}`);
    return;
  }

  console.log(`Processing: ${inputFile} ...`);
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  
  // Using sheet_to_json with raw:true to preserve serial numbers and dates
  const rawRows = XLSX.utils.sheet_to_json(sheet, { raw: true });
  const cleanRows = [];
  const seenCards = new Set();

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    
    // Extract name
    let nameRaw = null;
    for (const nameCol of mappings.nameCols) {
      if (row[nameCol] !== undefined) {
        nameRaw = row[nameCol];
        break;
      }
    }

    // Extract card number
    let cardRaw = null;
    for (const cardCol of mappings.cardCols) {
      if (row[cardCol] !== undefined) {
        cardRaw = row[cardCol];
        break;
      }
    }

    // Extract birth date
    let dobRaw = null;
    for (const dobCol of mappings.dobCols) {
      if (row[dobCol] !== undefined) {
        dobRaw = row[dobCol];
        break;
      }
    }

    // Fallbacks if columns are not found in parsed JSON keys directly (sometimes columns have leading/trailing spaces)
    if (nameRaw === null || cardRaw === null) {
      // Search all keys case-insensitively
      const keys = Object.keys(row);
      for (const k of keys) {
        const kClean = k.trim().toLowerCase();
        if (nameRaw === null && mappings.nameCols.some(c => c.toLowerCase() === kClean)) {
          nameRaw = row[k];
        }
        if (cardRaw === null && mappings.cardCols.some(c => c.toLowerCase() === kClean)) {
          cardRaw = row[k];
        }
        if (dobRaw === null && mappings.dobCols.some(c => c.toLowerCase() === kClean)) {
          dobRaw = row[k];
        }
      }
    }

    const name = cleanName(nameRaw);
    const card = cleanCard(cardRaw);
    const birthDate = parseExcelDate(dobRaw);

    if (!name || !card) {
      continue; // Skip invalid rows
    }

    if (seenCards.has(card)) {
      continue; // Skip duplicates in this file
    }

    seenCards.add(card);
    cleanRows.push({
      "اسم المستفيد": name,
      "رقم البطاقة": card,
      "تاريخ الميلاد": birthDate
    });
  }

  // Create clean Excel workbook
  const outWorkbook = XLSX.utils.book_new();
  const outSheet = XLSX.utils.json_to_sheet(cleanRows);
  XLSX.utils.book_append_sheet(outWorkbook, outSheet, "المستفيدين");
  
  const outputPath = path.join(outputDir, outputFileName);
  XLSX.writeFile(outWorkbook, outputPath);
  console.log(`✓ Saved ${cleanRows.length} clean records to ${outputFileName}`);
  return cleanRows;
}

// Special processor for Future because it's split across two files and has messy headers
function processFutureCompany() {
  console.log("Processing Future files...");
  const cleanRows = [];
  const seenCards = new Set();

  const file1 = path.join(inputDir, "فيوتشر للموظفين المستوفين البيانات.xlsx");
  const file2 = path.join(inputDir, "قائمة فيوتشر المدمجة.xlsx");

  function processFutureFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return;
    }
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

    for (let r = 0; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.length < 2) continue;

      // Find any string starting with FUTU2025 to find the card number
      let card = "";
      let name = "";
      let dob = "";

      for (let c = 0; c < row.length; c++) {
        const valStr = String(row[c] || "").trim().toUpperCase();
        if (valStr.startsWith("FUTU2025")) {
          card = cleanCard(valStr);
        }
      }

      if (!card) continue;

      // Try to find the name (typically columns 2 or index 1, 2)
      // We will look for any cell that has Arabic letters and length > 6
      for (let c = 0; c < row.length; c++) {
        const cellVal = String(row[c] || "").trim();
        const isNameCandidate = /[\u0600-\u06FF]/.test(cellVal) && cellVal.split(" ").length >= 2;
        if (isNameCandidate && !cellVal.toUpperCase().startsWith("FUTU2025")) {
          name = cleanName(cellVal);
          break;
        }
      }

      // Try to find DOB: typically a number representing a date, or index matching
      // Let's search row cells for values that could be date serials (e.g. between 10000 and 50000)
      for (let c = 0; c < row.length; c++) {
        const val = row[c];
        if (typeof val === 'number' && val > 10000 && val < 50000) {
          dob = val;
        } else if (typeof val === 'string' && (val.includes('/') || val.includes('-')) && val.match(/\d/)) {
          dob = val;
        }
      }

      if (name && card && !seenCards.has(card)) {
        seenCards.add(card);
        cleanRows.push({
          "اسم المستفيد": name,
          "رقم البطاقة": card,
          "تاريخ الميلاد": parseExcelDate(dob)
        });
      }
    }
  }

  processFutureFile(file1);
  processFutureFile(file2);

  const outWorkbook = XLSX.utils.book_new();
  const outSheet = XLSX.utils.json_to_sheet(cleanRows);
  XLSX.utils.book_append_sheet(outWorkbook, outSheet, "المستفيدين");
  
  const outputPath = path.join(outputDir, "Future_List_Import.xlsx");
  XLSX.writeFile(outWorkbook, outputPath);
  console.log(`✓ Saved ${cleanRows.length} clean records for Future to Future_List_Import.xlsx`);
}

// 1. OZONE_List.xlsx Mappings
processCompanyExcel("OZONE_List.xlsx", "OZONE_List_Import.xlsx", {
  nameCols: ["Employee Name", "اسم الموظف", "الاسم"],
  cardCols: ["Insurance Profile", "رقم البطاقة", "رقم_البطاقة"],
  dobCols: ["DOB", "تاريخ الميلاد"]
});

// 2. Tosyali_List (2).xlsx Mappings
processCompanyExcel("Tosyali_List (2).xlsx", "Tosyali_List_Import.xlsx", {
  nameCols: ["Name", "الاسم", "اسم المستفيد"],
  cardCols: ["Insurance Profile", "رقم البطاقة", "الرقم التأميني"],
  dobCols: ["DOB", "تاريخ الميلاد"]
});

// 3. Vision_List.xlsx Mappings
processCompanyExcel("Vision_List.xlsx", "Vision_List_Import.xlsx", {
  nameCols: ["Name", "الاسم", "اسم المستفيد"],
  cardCols: ["Insurance Profile", "رقم البطاقة", "الرقم التأميني"],
  dobCols: ["DOB", "تاريخ الميلاد"]
});

// 4. فيوتشر للموظفين المستوفين البيانات + قائمة فيوتشر المدمجة
processFutureCompany();

// 5. قائمة اسماء شركة رواق.xlsx Mappings
processCompanyExcel("قائمة اسماء شركة رواق.xlsx", "Rewaq_List_Import.xlsx", {
  nameCols: [" الاسم ", "الاسم", "اسم المستفيد"],
  cardCols: ["رقم البطاقة", "الرقم التأميني"],
  dobCols: ["تاريخ الميلاد ", "تاريخ الميلاد"]
});

console.log("All dental excel lists have been processed and cleaned!");
