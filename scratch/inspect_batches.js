const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const targetDir = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة";

function inspectFiles() {
  if (!fs.existsSync(targetDir)) {
    console.error("Target directory does not exist:", targetDir);
    return;
  }

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".xlsx"));
  console.log(`Found ${files.length} Excel files.`);

  files.forEach(file => {
    const filePath = path.join(targetDir, file);
    try {
      const workbook = XLSX.readFile(filePath);
      console.log(`\n========================================`);
      console.log(`File: ${file}`);
      console.log(`Sheets: ${workbook.SheetNames.join(", ")}`);
      
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const data = XLSX.utils.sheet_to_json(sheet);
      
      console.log(`Rows count: ${data.length}`);
      if (data.length > 0) {
        console.log(`Columns/Keys in first row:`, Object.keys(data[0]));
        console.log(`Sample row:`, data[0]);
      } else {
        console.log(`Empty sheet or no data rows`);
      }
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  });
}

inspectFiles();
