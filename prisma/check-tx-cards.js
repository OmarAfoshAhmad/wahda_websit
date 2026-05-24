const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

async function checkFile(fileName) {
  console.log(`\n=== Checking unique cards in ${fileName} ===`);
  const filePath = path.join(__dirname, "..", "حركات الشركات للأسنان", fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];

  const uniqueCards = new Set();
  const rowCount = ws.rowCount;

  for (let i = 2; i <= rowCount; i++) {
    const row = ws.getRow(i);
    const cardVal = row.getCell(2).value;
    if (cardVal) {
      uniqueCards.add(String(cardVal).trim().toUpperCase());
    }
  }

  console.log(`Total unique cards in file: ${uniqueCards.size}`);

  const cardList = Array.from(uniqueCards);
  const foundBeneficiaries = await prisma.beneficiary.findMany({
    where: {
      card_number: { in: cardList },
      deleted_at: null
    },
    select: { card_number: true }
  });

  const foundCards = new Set(foundBeneficiaries.map(b => b.card_number.trim().toUpperCase()));
  console.log(`Matching active beneficiaries found in DB: ${foundCards.size}`);

  const missingCards = cardList.filter(c => !foundCards.has(c));
  console.log(`Missing cards in DB: ${missingCards.length}`);
  if (missingCards.length > 0) {
    console.log(`Sample missing cards:`, missingCards.slice(0, 10));
  }
}

async function run() {
  await checkFile("JMR_Transactions.xlsx");
  await checkFile("LCC_Transactions.xlsx");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
