const XLSX = require("xlsx");
const path = require("path");

const filePath = "c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان/دمج الاسمنت.xlsx";
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];

const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
console.log("Total rows:", rows.length);
for (let i = 0; i < Math.min(15, rows.length); i++) {
  console.log(`Row ${i}:`, rows[i]);
}
