const Excel = require('exceljs');
const path = require('path');

const files = [
  'C:/Users/Omar/Desktop/التحقق من البطاقات الغير مصدرة/Benghazi/BEN 14.xlsx',
  'C:/Users/Omar/Desktop/التحقق من البطاقات الغير مصدرة/Benghazi/Ben 16.xlsx'
];

async function processFile(filePath) {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const results = [];
  const batchRegex = /\b(\d{1,3})\b/;
  
  const fileName = path.basename(filePath);
  const pathMatch = filePath.match(batchRegex);
  const fileMatch = fileName.match(batchRegex);
  
  workbook.eachSheet(sheet => {
    let headerRow = -1;
    let cardCol = -1;
    let batchCol = -1;
    let cardRows = 0;
    const sampleBatchValues = new Set();
    const sheetMatch = sheet.name.match(batchRegex);

    sheet.eachRow((row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values : [];
      let rowHasCard = false;
      let rowBatch = null;

      values.forEach((v, idx) => {
        if (!v) return;
        let s = (typeof v === 'object' && v.text) ? v.text : v.toString();
        if (/\d{10,}/.test(s)) {
          rowHasCard = true;
          if (headerRow === -1) {
             headerRow = rowNumber;
             cardCol = idx;
          }
        }
        if (s.includes('دفعة') || (idx > 0 && values[idx-1] && values[idx-1].toString().includes('دفعة'))) {
           // try to find batch
        }
      });

      if (rowHasCard) {
        cardRows++;
        // Identify batch column if possible (common keywords)
        const bIdx = values.findIndex(v => v && v.toString().includes('14') || (v && v.toString().includes('16')));
        if (bIdx !== -1 && sampleBatchValues.size < 10) {
            sampleBatchValues.add(values[bIdx].toString().trim());
        }
      }
    });

    results.push({
      sheet: sheet.name,
      hasHeader: headerRow !== -1,
      cardRows,
      extractedFallbackBatchFromPath: pathMatch ? pathMatch[1] : null,
      fromFilename: fileMatch ? fileMatch[1] : null,
      fromSheets: sheetMatch ? sheetMatch[1] : null,
      sampleRowBatchValues: Array.from(sampleBatchValues)
    });
  });
  return { file: fileName, sheets: results };
}

async function run() {
  for (const file of files) {
    try {
      const res = await processFile(file);
      console.log(JSON.stringify(res, null, 2));
    } catch (err) {
      console.error('Error processing ' + file + ':', err.message);
    }
  }
}

run();
