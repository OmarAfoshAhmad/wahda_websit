const xlsx = require('xlsx');
const path = require('path');

const filePath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للبصريات - جديد\\JMR_Transactions_Optics.xlsx';

function main() {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: null });
  
  const matches = [];
  rawData.forEach((row, index) => {
    // Stringify row to easily search values
    const rowStr = JSON.stringify(row).toLowerCase();
    // Search for the base card
    if (rowStr.includes('jmr2002525516')) {
      matches.push({ rowNumber: index + 2, ...row });
    }
  });

  console.log(`Found ${matches.length} matches:`);
  console.log(JSON.stringify(matches, null, 2));
}

main();
