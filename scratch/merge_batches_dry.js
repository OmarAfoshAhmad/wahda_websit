const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const targetDir = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة";

function dryRunMerge() {
  if (!fs.existsSync(targetDir)) {
    console.error("Target directory does not exist:", targetDir);
    return;
  }

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".xlsx"));
  console.log(`Found ${files.length} Excel files.`);

  let totalRowsRead = 0;
  const uniqueByCard = new Map();
  const duplicates = [];
  const missingCard = [];

  files.forEach(file => {
    const filePath = path.join(targetDir, file);
    try {
      const workbook = XLSX.readFile(filePath);
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const data = XLSX.utils.sheet_to_json(sheet);
      
      console.log(`File: ${file} | Rows: ${data.length}`);
      totalRowsRead += data.length;

      data.forEach((row, index) => {
        // Normalize keys to find the card number column "الرقم ت"
        const cardKey = Object.keys(row).find(k => k.trim() === "الرقم ت" || k.trim().toLowerCase() === "card_number");
        const cardValue = cardKey ? String(row[cardKey]).trim().toUpperCase() : "";

        const nameKey = Object.keys(row).find(k => k.trim() === "الاسم" || k.trim().toLowerCase() === "name");
        const nameValue = nameKey ? String(row[nameKey]).trim() : "";

        if (!cardValue) {
          missingCard.push({ file, rowIndex: index + 2, row });
          return;
        }

        if (uniqueByCard.has(cardValue)) {
          duplicates.push({
            card: cardValue,
            name: nameValue,
            firstFile: uniqueByCard.get(cardValue).file,
            secondFile: file,
            row
          });
        } else {
          uniqueByCard.set(cardValue, { file, row });
        }
      });

    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
    }
  });

  console.log(`\n========================================`);
  console.log(`Dry Run Statistics:`);
  console.log(`Total rows read across all files: ${totalRowsRead}`);
  console.log(`Unique cards (ready for import): ${uniqueByCard.size}`);
  console.log(`Duplicate card records skipped: ${duplicates.length}`);
  console.log(`Records missing card number: ${missingCard.length}`);
  console.log(`========================================`);

  if (missingCard.length > 0) {
    console.log(`\nSample records missing card number (first 5):`);
    console.log(missingCard.slice(0, 5).map(m => ({ file: m.file, row: m.row })));
  }

  if (duplicates.length > 0) {
    console.log(`\nSample duplicate records (first 5):`);
    console.log(duplicates.slice(0, 5).map(d => ({
      card: d.card,
      name: d.name,
      files: `${d.firstFile} <-> ${d.secondFile}`
    })));
  }
}

dryRunMerge();
