const ExcelJS = require('exceljs');
const path = require('path');

async function debugExcel() {
  const filePath = path.join(process.cwd(), 'دفعة 17.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  console.log('--- EXCEL HEADERS ---');
  const headers = worksheet.getRow(1).values;
  console.log(JSON.stringify(headers));

  console.log('--- SAMPLE DATA (Row 2) ---');
  const row2 = worksheet.getRow(2).values;
  console.log(JSON.stringify(row2));
  
  console.log('--- SAMPLE DATA (Row 3) ---');
  const row3 = worksheet.getRow(3).values;
  console.log(JSON.stringify(row3));
}

debugExcel().catch(err => console.error('Error reading file:', err));
