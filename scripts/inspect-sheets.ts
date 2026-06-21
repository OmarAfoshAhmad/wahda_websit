import ExcelJS from "exceljs";

async function countSheets(filename: string) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filename);
    console.log(`File: ${filename}`);
    console.log(`Number of worksheets: ${workbook.worksheets.length}`);
    workbook.worksheets.forEach(ws => {
      console.log(`- Sheet name: ${ws.name}, id: ${ws.id}, row count: ${ws.rowCount}`);
    });
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
  }
}

async function main() {
  await countSheets("c:\\Users\\Omar\\waad_temp_website\\حركات نظارات قبل الاطلاق.xlsx");
}

main().catch(console.error);
