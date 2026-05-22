const XLSX = require("xlsx");
const path = require("path");

const files = [
  "اسماء شركات الاسنان/جمارك دمج - Copy.xlsx",
  "اسماء شركات الاسنان/دمج الاسمنت.xlsx"
];

files.forEach(f => {
  const filePath = path.join("c:/Users/Omar/waad_temp_website", f);
  console.log("\n=================================");
  console.log("Analyzing file:", f);
  try {
    const workbook = XLSX.readFile(filePath);
    console.log("Sheets:", workbook.SheetNames);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { raw: true });
    console.log("Number of rows:", data.length);
    if (data.length > 0) {
      console.log("Keys (Columns):", Object.keys(data[0]));
      console.log("First row:", data[0]);
      if (data.length > 1) console.log("Second row:", data[1]);
    }
  } catch (err) {
    console.error("Error reading file:", err.message);
  }
});
