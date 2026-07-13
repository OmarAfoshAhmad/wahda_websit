const XLSX = require('xlsx');

function testFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const wsname = wb.SheetNames[0];
  const ws = wb.Sheets[wsname];
  const rawRows = XLSX.utils.sheet_to_json(ws);
  console.log("Total raw rows in the file:", rawRows.length);
  
  if (rawRows.length > 40) {
    console.log("Row 41:", rawRows[40]);
    console.log("Last Row:", rawRows[rawRows.length - 1]);
  }
}

testFile('c:\\Users\\Omar\\waad_temp_website\\20.xlsx');
