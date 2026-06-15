const xlsx = require('xlsx');
const path = require('path');

const filePath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للبصريات - جديد\\JMR_Transactions_Optics.xlsx';

function main() {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: null });
  
  const mapped = rawData.map(row => ({
    name: row['اسم المريض'] || row['اسم المشترك'],
    card: row['رقم التأمين '] || row['رقم التأمين'] || row['رقم البطاقة'],
    amount: row['القيمة المالية'] || row['amount'] || row['القيمة'],
  }));

  console.log(JSON.stringify(mapped, null, 2));
}

main();
