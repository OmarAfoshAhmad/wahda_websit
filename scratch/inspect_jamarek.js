const XLSX = require("xlsx");
const path = require("path");

const filePath = "c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان/جمارك دمج - Copy.xlsx";
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];

// Print the first 10 rows using sheet_to_json with header:1 (raw arrays)
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
console.log("Total rows:", rows.length);
for (let i = 0; i < Math.min(15, rows.length); i++) {
  console.log(`Row ${i}:`, rows[i]);
}
