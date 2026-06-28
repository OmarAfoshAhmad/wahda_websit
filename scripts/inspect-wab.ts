import ExcelJS from "exceljs";

async function main() {
  const filePath = "c:\\Users\\Omar\\waad_temp_website\\حركات_الشركات_منظمة\\البصريات\\حركات_WAB.xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  
  const ws = workbook.worksheets[0];
  let nameCol = 1, cardCol = 2, amountCol = 3;

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || "").trim();
    if (val.includes("اسم") || val.includes("المريض")) nameCol = colNumber;
    else if (val.includes("تأمين") || val.includes("تامين") || val.includes("بطاقة")) cardCol = colNumber;
    else if (val.includes("قيمة") || val.includes("مبلغ") || val.includes("دينار")) amountCol = colNumber;
  });

  let totalRows = 0;
  let skippedRows = 0;
  let processedRows = 0;

  console.log("Header columns:", { nameCol, cardCol, amountCol });

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    totalRows++;

    const nameVal = row.getCell(nameCol).value;
    const cardVal = row.getCell(cardCol).value;
    const amountVal = row.getCell(amountCol).value;

    const name = nameVal ? String(nameVal).trim() : "";
    const card = cardVal ? String(cardVal).trim() : "";

    let amount = 0;
    if (typeof amountVal === "number") {
      amount = amountVal;
    } else if (typeof amountVal === "string") {
      amount = parseFloat(amountVal.replace(/,/g, "").match(/[\d.]+/)?.[0] || "0");
    } else if (typeof amountVal === "object" && amountVal && "result" in amountVal) {
      amount = Number((amountVal as any).result || 0);
    }

    if (amount === 0 && !name) {
      console.log(`Skipped row #${rowNumber}: name='${name}', card='${card}', amount=${amount}`);
      skippedRows++;
      return;
    }

    processedRows++;
  });

  console.log(`Total Excel Rows (including header): ${ws.rowCount}`);
  console.log(`Total Data Rows: ${totalRows}`);
  console.log(`Skipped Data Rows: ${skippedRows}`);
  console.log(`Processed Data Rows: ${processedRows}`);
}

main().catch(console.error);
