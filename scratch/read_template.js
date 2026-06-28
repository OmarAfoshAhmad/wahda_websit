const XLSX = require('xlsx');

try {
  const wb = XLSX.readFile('c:\\Users\\Omar\\waad_temp_website\\card_numbering_template.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws);
  console.log("Keys of row 0:", Object.keys(rawRows[0]));
  console.log("Keys of row 65:", Object.keys(rawRows[65]));
} catch (e) {
  console.error("Error:", e);
}
