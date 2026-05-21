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
  console.log('Reading file:', filePath);
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Header
    const name = row.getCell(1).value;
    const cardRaw = row.getCell(2).value;
    const approval = row.getCell(3).value;
    const amount = Number(row.getCell(4).value || 0);
    const dateRaw = row.getCell(5).value;
    const notes = row.getCell(6).value;
    const facilityName = row.getCell(7).value;
    
    rows.push({
      rowNumber,
      name: name ? String(name).trim() : '',
      card: normalizeCardNumber(cardRaw),
      approval: approval ? String(approval).trim() : '',
      amount,
      dateRaw,
      notes: notes ? String(notes).trim() : '',
      facilityName: facilityName ? String(facilityName).trim() : ''
    });
  });
  
  console.log(`Loaded ${rows.length} rows from Excel.`);
  
  // Get unique cards
  const uniqueCards = [...new Set(rows.map(r => r.card))].filter(Boolean);
  console.log(`Unique card numbers: ${uniqueCards.length}`);
  
  // Query database for these beneficiaries
  const beneficiaries = await prisma.beneficiary.findMany({
    where: {
      card_number: { in: uniqueCards },
      deleted_at: null
    },
    select: {
      id: true,
      card_number: true,
      name: true,
      company_id: true,
      company: { select: { id: true, name: true, code: true } }
    }
  });
  
  const beneficiaryMap = new Map(
    beneficiaries.map(b => [b.card_number.toUpperCase(), b])
  );
  
  console.log(`Found ${beneficiaries.length} matching beneficiaries in database.`);
  
  // Check companies of matched beneficiaries
  const companyCounts = {};
  let matchedCount = 0;
  let unmatchedRows = [];
  
  for (const r of rows) {
    const match = beneficiaryMap.get(r.card);
    if (match) {
      matchedCount++;
      const companyName = match.company ? `${match.company.name} (${match.company.code})` : 'No Company';
      companyCounts[companyName] = (companyCounts[companyName] || 0) + 1;
    } else {
      unmatchedRows.push(r);
    }
  }
  
  console.log(`Matched rows: ${matchedCount} / ${rows.length}`);
  console.log('Company distribution of matched rows:', companyCounts);
  
  console.log('Unmatched rows count:', unmatchedRows.length);
  if (unmatchedRows.length > 0) {
    console.log('Sample unmatched rows (first 10):');
    console.log(unmatchedRows.slice(0, 10).map(r => ({
      row: r.rowNumber,
      name: r.name,
      card: r.card,
      amount: r.amount
    })));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
