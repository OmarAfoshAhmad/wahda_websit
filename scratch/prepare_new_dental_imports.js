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

// 1. Process Jamarek
function processJamarek() {
  const inputFile = "جمارك دمج - Copy.xlsx";
  const outputFileName = "Jamarek_List_Import.xlsx";
  const inputPath = path.join(inputDir, inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputFile}`);
    return;
  }

  console.log(`Processing: ${inputFile} ...`);
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  
  const cleanRows = [];
  const seenCards = new Set();

  // Start from row index 2 as row 0 is banner and row 1 is header
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    
    // row[2] = اسم المستفيد, row[5] = رقم البطاقة, row[4] = تاريخ الميلاد
    const nameRaw = row[2];
    const cardRaw = row[5];
    const dobRaw = row[4];

    const name = cleanName(nameRaw);
    const card = cleanCard(cardRaw);
    const birthDate = parseExcelDate(dobRaw);

    if (!name || !card) {
      continue; // Skip invalid rows
    }

    if (seenCards.has(card)) {
      continue; // Skip duplicates
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
}

// 2. Process Cement
function processCement() {
  const inputFile = "دمج الاسمنت.xlsx";
  const outputFileName = "Cement_List_Import.xlsx";
  const inputPath = path.join(inputDir, inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputFile}`);
    return;
  }

  console.log(`Processing: ${inputFile} ...`);
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  
  const cleanRows = [];
  const seenCards = new Set();

  // Start from row index 1 as row 0 is headers
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    
    // row[3] = الاسم الكامل باللغة العربية, row[2] = رقم الرعاية, row[7] = تاريخ الميلاد
    const nameRaw = row[3];
    const cardRaw = row[2];
    const dobRaw = row[7];

    const name = cleanName(nameRaw);
    const card = cleanCard(cardRaw);
    const birthDate = parseExcelDate(dobRaw);

    if (!name || !card) {
      continue;
    }

    if (seenCards.has(card)) {
      continue;
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
}

processJamarek();
processCement();
console.log("Processing complete!");
