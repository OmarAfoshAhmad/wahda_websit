const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const targetDir = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة";

function checkDeepDuplicates() {
  if (!fs.existsSync(targetDir)) return;

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".xlsx"));
  
  const byCard = new Map();
  const byNationalId = new Map();
  const byName = new Map();

  let nameDupCount = 0;
  let natDupCount = 0;

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

        if (cardValue) byCard.set(cardValue, { file, row });

        if (natValue && natValue !== "" && natValue !== "0") {
          if (byNationalId.has(natValue)) {
            natDupCount++;
            // console.log(`Duplicate National Number: ${natValue} | Name: ${nameValue} (in ${file}) vs ${byNationalId.get(natValue).name} (in ${byNationalId.get(natValue).file})`);
          } else {
            byNationalId.set(natValue, { file, name: nameValue });
          }
        }

        if (nameValue) {
          const normName = nameValue.replace(/\s+/g, " ");
          if (byName.has(normName)) {
            nameDupCount++;
          } else {
            byName.set(normName, { file, card: cardValue });
          }
        }
      });
    } catch (e) {}
  });

  console.log(`Deep duplicate checks:`);
  console.log(`Duplicate National Numbers count: ${natDupCount}`);
  console.log(`Duplicate Names count: ${nameDupCount}`);
}

checkDeepDuplicates();
