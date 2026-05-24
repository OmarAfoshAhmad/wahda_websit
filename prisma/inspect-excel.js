const ExcelJS = require("exceljs");
const path = require("path");

async function inspect(fileName) {
  const filePath = path.join(__dirname, "..", "حركات الشركات للأسنان", fileName);
  console.log(`\n=== Inspecting Excel file: ${fileName} ===`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];

  const uniqueFacilities = new Set();
  const uniqueNames = [];
  const uniqueCards = [];
  let rowCount = 0;
  let emptyCards = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // Print headers
      const headers = [];
      row.eachCell((c) => headers.push(c.value));
      console.log("Headers:", headers);
      return;
    }

    const nameVal = row.getCell(1).value;
    const cardVal = row.getCell(2).value;
    const amountVal = row.getCell(4).value;
    const facilityVal = row.getCell(7).value;

    const card = cardVal ? String(cardVal).trim() : "";
    const name = nameVal ? String(nameVal).trim() : "";
    const facilityName = facilityVal ? String(facilityVal).trim() : "";

    if (!card && !name && !amountVal) return;

    rowCount++;
    if (!card) emptyCards++;
    if (facilityName) uniqueFacilities.add(facilityName);
    if (uniqueNames.length < 5 && name) uniqueNames.push(name);
    if (uniqueCards.length < 5 && card) uniqueCards.push(card);
  });

  console.log(`Total Rows: ${rowCount}`);
  console.log(`Empty Card Rows: ${emptyCards}`);
  console.log("Unique Facilities in Excel:", Array.from(uniqueFacilities));
  console.log("Sample Names:", uniqueNames);
  console.log("Sample Cards:", uniqueCards);
}

async function run() {
  await inspect("JMR_Transactions.xlsx");
  await inspect("LCC_Transactions.xlsx");
}

run().catch(console.error);
