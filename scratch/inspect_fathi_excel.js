const XLSX = require("xlsx");
const path = require("path");

function main() {
  const filePath = path.join("c:", "Users", "Omar", "waad_temp_website", "دفعة 20.xlsx");
  console.log("Reading file:", filePath);
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);
  
  console.log("Total rows:", data.length);
  
  const match = data.filter(r => {
    const name = String(r["الاسم"] || r["اسم المستفيد"] || r["المستفيد"] || "");
    return name.includes("فتحي صالح") || name.includes("العشيبي");
  });

  console.log("Matches found:", match.length);
  match.forEach((m, idx) => {
    console.log(`Match ${idx + 1}:`, JSON.stringify(m, null, 2));
  });
}

main();
