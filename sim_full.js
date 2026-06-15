const xlsx = require('xlsx');

const filePath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للبصريات - جديد\\JMR_Transactions_Optics.xlsx';

function main() {
  const workbook = xlsx.readFile(filePath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
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

    const baseCard = getBase(card);
    const baseCandidates = dbBeneficiaries.filter((b) => getBase(b.card_number.toUpperCase()) === baseCard);
    
    if (baseCandidates.length > 0 && nameTokens.size > 0) {
      let bestMatch = null;
      let bestScore = 0;
      for (const candidate of baseCandidates) {
        const cNameTokens = new Set(normalizeText(candidate.name).split(" ").filter((t) => t.length > 2));
        const intersection = [...nameTokens].filter((t) => cNameTokens.has(t));
        const union = new Set([...nameTokens, ...cNameTokens]).size;
        let score = intersection.length / (union || 1);
        if (intersection.length >= 3) score = Math.max(score, 0.8);
        else if (intersection.length >= 2) score = Math.max(score, 0.6);
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
      if (bestMatch && ((baseCandidates.length === 1 && bestScore >= 0.4) || bestScore >= 0.8)) {
        return bestMatch;
      }
    }
    
    if (nameTokens.size >= 3) {
      for (const candidate of dbBeneficiaries) {
        if (!candidate.name) continue;
        const cNameTokens = new Set(normalizeText(candidate.name).split(" ").filter((t) => t.length > 2));
        const intersection = [...nameTokens].filter((t) => cNameTokens.has(t));
        const score = intersection.length / (new Set([...nameTokens, ...cNameTokens]).size || 1);
        if (score >= 0.8 || intersection.length >= 3) {
          return candidate;
        }
      }
    }
    return null;
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
      
      if (ben.id === '__temp__JMR2002525516S2') {
         console.log(`[Row ${r.rowNum}] Zubair S2 matched. Consumed before: ${consumed}`);
      } else if (ben.card_number === 'JMR2002525516S2' || ben.name.includes('الزبير')) {
         console.log(`[Row ${r.rowNum}] Zubair matched as: ${ben.id}. Consumed before: ${consumed}`);
      }
      
      consumption[ben.id] = consumed + amount;
    }
  });

  console.log(`Final consumption for Zubair ID:`, consumption['__temp__JMR2002525516S2']);
  
  // Find who actually accumulated 2906.25!
  for (const id in consumption) {
    if (consumption[id] > 1000) {
      const b = dbBeneficiaries.find(x => x.id === id);
      console.log(`High consumption: ${b.name} (${b.card_number}) = ${consumption[id]}`);
    }
  }
}

main();
