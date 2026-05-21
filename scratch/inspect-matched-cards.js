const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const path = require('path');

const prisma = new PrismaClient();

function normalizeCardNumber(card) {
  if (!card) return '';
  return String(card).trim().toUpperCase();
}

async function main() {
  const filePath = path.join(__dirname, '..', 'خصومات الاسنان - Copy.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  const excelCards = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const card = row.getCell(2).value;
    if (card) excelCards.push(normalizeCardNumber(card));
  });

  const uniqueExcelCards = [...new Set(excelCards)];

  const matched = await prisma.beneficiary.findMany({
    where: {
      card_number: { in: uniqueExcelCards },
      deleted_at: null
    },
    select: {
      card_number: true,
      name: true,
      company: { select: { name: true, code: true } }
    }
  });

  console.log('Matched beneficiaries in DB (first 30):');
  console.log(matched.map(m => `${m.card_number} | ${m.name} | ${m.company ? m.company.name : 'None'}`).slice(0, 30));
}

main().catch(console.error).finally(() => prisma.$disconnect());
