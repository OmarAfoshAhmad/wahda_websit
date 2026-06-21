import ExcelJS from "exceljs";

async function inspectFile(filename: string) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filename);
    workbook.worksheets.forEach(ws => {
      console.log(`\n--- Sheet: ${ws.name} ---`);
      console.log("Row 2:", ws.getRow(2).values);
      console.log("Row 3:", ws.getRow(3).values);
      console.log("Row 4:", ws.getRow(4).values);
      console.log("Row 5:", ws.getRow(5).values);
      console.log("Row 6:", ws.getRow(6).values);
    });
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
  }
}

async function main() {
  await inspectFile("c:\\Users\\Omar\\waad_temp_website\\حركات نظارات قبل الاطلاق.xlsx");
}

main().catch(console.error);
