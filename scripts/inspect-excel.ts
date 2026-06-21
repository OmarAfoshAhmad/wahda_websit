import ExcelJS from "exceljs";
import path from "path";

async function inspectFile(filename: string) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filename);
    const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
    if (!ws) {
      console.log(`No worksheet found in ${filename}`);
      return;
    }
    const headerRow = ws.getRow(1).values;
    console.log(`--- Headers for ${path.basename(filename)} ---`);
    console.log(headerRow);
    
    // Read a few rows to see data format
    console.log("Sample row 2:", ws.getRow(2).values);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
  }
}

async function main() {
  await inspectFile("c:\\Users\\Omar\\waad_temp_website\\حركات نظارات قبل الاطلاق.xlsx");
  await inspectFile("c:\\Users\\Omar\\waad_temp_website\\مطابقة_مراكز_البصريات.xlsx");
}

main().catch(console.error);
