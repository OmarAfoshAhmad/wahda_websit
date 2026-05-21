const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const targetDir = 'c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد';

const config = [
  {
    srcPath: 'MERG ARCADIA/سجل الموظفين اركاديا المدمج.xlsx',
    destName: 'Arcadia_List_Import.xlsx',
    startRow: 4,
    nameCol: 2, // B
    cardCol: 10, // J
    dobCol: 4, // D
    excludeKeyword: 'الغاء', // skip if status contains "الغاء" or "إلغاء"
    excludeCol: 11 // K
  },
  {
    srcPath: 'MERG HJR/HAJAR ALMAS 1 .xlsx',
    destName: 'Hajar_List_Import.xlsx',
    startRow: 8,
    nameCol: 2, // B
    cardCol: 5, // E
    dobCol: 10 // J
  },
  {
    srcPath: 'merg waad -tpa/قوائم اسماء موظفي شركة وعد-بنغازي وطرابلس.xlsx',
    destName: 'Waad_List_Import.xlsx',
    startRow: 6,
    nameCol: 3, // C
    cardCol: 7, // G
    dobCol: 6 // F
  },
  {
    srcPath: 'merg waad architect/الوعد المعماري قائمة اسماء 1.xlsx',
    destName: 'Waad_Architect_List_Import.xlsx',
    startRow: 6,
    nameCol: 2, // B
    cardCol: 9, // I
    dobCol: 8 // H
  },
  {
    srcPath: 'merg waha/كشف بموظفي طرابلس بنغازي (1).xlsx',
    destName: 'Waha_List_Import.xlsx',
    startRow: 8,
    nameCol: 3, // C
    cardCol: 6, // F
    nationalIdCol: 4 // D (for extracting DOB year)
  }
];

function formatDateValue(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    // check formats like 19/6/2020 or 19-6-2020
    const matchSlash = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (matchSlash) {
      const d = parseInt(matchSlash[1], 10);
      const m = parseInt(matchSlash[2], 10);
      const y = parseInt(matchSlash[3], 10);
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    // check ISO string slice
    if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
      return cleaned.slice(0, 10);
    }
  }
  return '';
}

async function processFile(c) {
  const srcFullPath = path.join('c:/Users/Omar/waad_temp_website', c.srcPath);
  if (!fs.existsSync(srcFullPath)) {
    console.log(`Source file not found: ${srcFullPath}`);
    return;
  }

  const wbSrc = new ExcelJS.Workbook();
  await wbSrc.xlsx.readFile(srcFullPath);
  const wsSrc = wbSrc.getWorksheet(1) || wbSrc.worksheets[0];

  const wbDest = new ExcelJS.Workbook();
  const wsDest = wbDest.addWorksheet('المستفيدين');

  // Add Headers
  wsDest.addRow(['اسم المستفيد', 'رقم البطاقة', 'تاريخ الميلاد']);

  let count = 0;
  let skippedCancelled = 0;
  let currentEmployeeCard = '';

  wsSrc.eachRow((row, rowNum) => {
    if (rowNum < c.startRow) return;

    // Check cancellation first if configured
    if (c.excludeCol && c.excludeKeyword) {
      const statusCell = row.getCell(c.excludeCol).value;
      const statusText = statusCell ? String(statusCell).trim() : '';
      if (statusText.includes(c.excludeKeyword) || statusText.includes('إلغاء')) {
        skippedCancelled++;
        return; // skip this row
      }
    }

    const nameCell = row.getCell(c.nameCol).value;
    const cardCell = row.getCell(c.cardCol).value;
    
    const name = nameCell ? String(nameCell).trim() : '';
    let card = cardCell ? String(cardCell).trim().toUpperCase() : '';

    if (!name && !card) return; // empty row

    // For Waad TPA, correct dependant card number typos based on the main employee card
    if (c.destName === 'Waad_List_Import.xlsx' && card) {
      const isMainEmployee = /^WAAD2025\d{4}$/.test(card);
      if (isMainEmployee) {
        currentEmployeeCard = card;
      } else {
        const match = card.match(/^(WAAD2025\d{4})([A-Z0-9]+)$/);
        if (match) {
          const baseCard = match[1];
          const suffix = match[2];
          if (currentEmployeeCard && baseCard !== currentEmployeeCard) {
            console.log(`   [Waad Auto-Correct] Row ${rowNum}: "${name}" card "${card}" -> "${currentEmployeeCard}${suffix}"`);
            card = `${currentEmployeeCard}${suffix}`;
          }
        }
      }
    }

    let dobStr = '';
    if (c.dobCol) {
      const dobCell = row.getCell(c.dobCol).value;
      dobStr = formatDateValue(dobCell);
    } else if (c.nationalIdCol) {
      const natCell = row.getCell(c.nationalIdCol).value;
      const natStr = natCell ? String(natCell).trim() : '';
      const match = natStr.match(/^[12](\d{4})/);
      if (match) {
        dobStr = `${match[1]}-01-01`;
      }
    }

    if (!dobStr) {
      dobStr = '1990-01-01'; // Safe default
    }

    wsDest.addRow([name, card, dobStr]);
    count++;
  });

  // Ensure target folder exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const destFullPath = path.join(targetDir, c.destName);
  await wbDest.xlsx.writeFile(destFullPath);
  console.log(`✅ File generated: ${c.destName} | Total rows: ${count} (Skipped cancelled: ${skippedCancelled})`);
}

async function main() {
  console.log('🚀 Start processing dental beneficiaries files...');
  for (const c of config) {
    await processFile(c);
  }
  console.log('🏁 All files processed and ready in "اسماء شركات الاسنان جاهزة للاستيراد" directory!');
}

main().catch(console.error);
