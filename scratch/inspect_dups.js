const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const targetDir = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة";

function inspectDuplicateDetails() {
  if (!fs.existsSync(targetDir)) return;

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".xlsx"));
  
  const byNationalId = new Map();
  const byName = new Map();

  const natDups = [];
  const nameDups = [];

  files.forEach(file => {
    const filePath = path.join(targetDir, file);
    try {
      const workbook = XLSX.readFile(filePath);
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      
      data.forEach((row, index) => {
        const cardKey = Object.keys(row).find(k => k.trim() === "الرقم ت" || k.trim().toLowerCase() === "card_number");
        const cardValue = cardKey ? String(row[cardKey]).trim().toUpperCase() : "";

        const nameKey = Object.keys(row).find(k => k.trim() === "الاسم" || k.trim().toLowerCase() === "name");
        const nameValue = nameKey ? String(row[nameKey]).trim() : "";

        const natKey = Object.keys(row).find(k => k.trim() === "الرقم الوطني" || k.trim().toLowerCase() === "national_number");
        const natValue = natKey ? String(row[natKey]).trim() : "";

        if (natValue && natValue !== "" && natValue !== "0") {
          if (byNationalId.has(natValue)) {
            const prev = byNationalId.get(natValue);
            natDups.push({
              nationalNumber: natValue,
              name1: prev.name,
              card1: prev.card,
              file1: prev.file,
              name2: nameValue,
              card2: cardValue,
              file2: file
            });
          } else {
            byNationalId.set(natValue, { file, name: nameValue, card: cardValue });
          }
        }

        if (nameValue) {
          const normName = nameValue.replace(/\s+/g, " ");
          if (byName.has(normName)) {
            const prev = byName.get(normName);
            nameDups.push({
              name: normName,
              card1: prev.card,
              file1: prev.file,
              card2: cardValue,
              file2: file
            });
          } else {
            byName.set(normName, { file, card: cardValue });
          }
        }
      });
    } catch (e) {}
  });

  console.log(`\n========================================`);
  console.log(`Sample Duplicate National Numbers (first 10):`);
  console.log(natDups.slice(0, 10));

  console.log(`\n========================================`);
  console.log(`Sample Duplicate Names (first 10):`);
  console.log(nameDups.slice(0, 10));
}

inspectDuplicateDetails();
