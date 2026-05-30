const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const outputFilePath = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة\\الدفعات المدمجة للأسنان.xlsx";

function checkOutput() {
  if (!fs.existsSync(outputFilePath)) {
    console.error("Merged file does not exist:", outputFilePath);
    return;
  }

  try {
    const workbook = XLSX.readFile(outputFilePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`Merged File Verification:`);
    console.log(`Sheet Name: ${sheetName}`);
    console.log(`Row count: ${data.length}`);
    if (data.length > 0) {
      console.log(`Columns in first row:`, Object.keys(data[0]));
      console.log(`Sample row 1:`, data[0]);
      console.log(`Sample row 2:`, data[1]);
    }
  } catch (err) {
    console.error("Error reading output file:", err.message);
  }
}

checkOutput();
