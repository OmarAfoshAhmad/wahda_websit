const ExcelJS = require('exceljs');
const path = require('path');

async function checkExcel() {
  const filePath = path.join(process.cwd(), 'دفعة 17.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  console.log('Searching for employee number 9914...');
  
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    // Row.values is 1-indexed, values[1] is the first column
    const empNum = String(values[1] || '').trim();
    if (empNum === '9914') {
      console.log(`Row ${rowNumber}:`, values);
    }
  });
}

checkExcel().catch(console.error);
