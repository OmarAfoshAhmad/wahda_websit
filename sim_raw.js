const xlsx = require('xlsx');
const path = require('path');

const filePath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للبصريات - جديد\\JMR_Transactions_Optics.xlsx';

function main() {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const rawData = xlsx.utils.sheet_to_json(worksheet, { defval: null });
  
  const mapped = rawData.map((row, i) => ({
    rowNum: i + 2,
    name: row['اسم المريض'] || row['اسم المشترك'] || '',
    card: String(row['رقم التأمين '] || row['رقم التأمين'] || row['رقم البطاقة'] || '').trim(),
    amount: Number(row['القيمة المالية'] || row['amount'] || row['القيمة'] || 0),
  }));

  const dbBeneficiaries = [];
  
  const normalizeText = (text) => text.replace(/[\u064B-\u065F]/g, "").replace(/[أإآا]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
  const getBase = (c) => c.replace(/[MFWSDH]\d+$/, "").replace(/[MFWSDH]$/, "").replace(/(20\d{2})0+/, "$1");

  const resolveBeneficiary = (cardStr, nameStr) => {
    const card = cardStr.toUpperCase();
    const name = normalizeText(nameStr || "");
    const nameTokens = new Set(name.split(" ").filter((t) => t.length > 2));
    
    const exactMatch = dbBeneficiaries.find((b) => b.card_number.toUpperCase() === card);
    if (exactMatch) return exactMatch;

    return null; // Don't do fuzzy matching for this test, let's just see raw cards
  };

  const consumption = {};

  mapped.forEach((r) => {
    let ben = resolveBeneficiary(r.card, r.name);
    if (!ben && r.card) {
      ben = { id: `__temp__${r.card}`, card_number: r.card, name: r.name };
      dbBeneficiaries.push(ben);
    }
    if (ben) {
      const consumed = consumption[ben.id] || 0;
      const amount = r.amount * 0.75;
      consumption[ben.id] = consumed + amount;
    }
  });

  console.log(`Zubair S2 Consumption:`, consumption['__temp__JMR2002525516S2']);
  console.log(`Ahmed S1 Consumption:`, consumption['__temp__JMR2002525516S1']);
}

main();
