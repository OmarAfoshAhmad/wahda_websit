const XLSX = require('xlsx');
const fs = require('fs');

try {
  const workbook = XLSX.readFile('دفعة 17.xlsx');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet);
  
  const output = {
    sheetName,
    rowCount: rows.length,
    columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    sampleRows: rows.slice(0, 5)
  };
  
  fs.writeFileSync('scratch/excel_inspect_output.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log('Inspection completed successfully!');
} catch (e) {
  console.error('Error during inspection:', e);
}
