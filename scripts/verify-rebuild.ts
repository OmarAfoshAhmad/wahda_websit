import ExcelJS from "exceljs";

async function verify() {
  const txWb = new ExcelJS.Workbook();
  await txWb.xlsx.readFile("c:\\Users\\Omar\\waad_temp_website\\حركات_مستفيدين_موحدة_ونظيفة.xlsx");
  txWb.worksheets.forEach(ws => {
    console.log(`\n--- Sheet: ${ws.name} ---`);
    console.log("Row 2:", ws.getRow(2).values);
    console.log("Row 3:", ws.getRow(3).values);
  });
}

verify().catch(console.error);
