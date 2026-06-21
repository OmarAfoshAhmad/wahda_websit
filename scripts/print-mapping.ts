import ExcelJS from "exceljs";

async function main() {
  const mappingWb = new ExcelJS.Workbook();
  await mappingWb.xlsx.readFile("c:\\Users\\Omar\\waad_temp_website\\المرافق_المطابقة_النهائي.xlsx");
  const mapWs = mappingWb.worksheets[0];

  mapWs.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const original = String(row.getCell(1).value || "").trim();
    const matched = String(row.getCell(2).value || "").trim();
    console.log(`Original: "${original}" -> Matched: "${matched}"`);
  });
}

main().catch(console.error);
