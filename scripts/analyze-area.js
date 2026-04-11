const ExcelJS = require("exceljs");
const path = require("path");

async function main() {
  const filePath = path.join("C:\\Users\\Omar\\draft\\area", "طرابلس.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log("=== Sheets ===");
  for (const ws of wb.worksheets) {
    console.log(`  Sheet: "${ws.name}" — rows: ${ws.rowCount}, cols: ${ws.columnCount}`);
  }

  const ws = wb.worksheets[0];
  
  // Print header
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers.push({ col: colNum, value: String(cell.value ?? "").trim() });
  });
  console.log("\n=== Headers ===");
  for (const h of headers) {
    console.log(`  Col ${h.col}: "${h.value}"`);
  }

  // Find الفرجاني row
  console.log("\n=== Searching for الفرجاني ===");
  let found = 0;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vals = row.values;
    const allText = JSON.stringify(vals);
    if (allText.includes("الفرجان") || allText.includes("1986") || allText.includes("11986")) {
      found++;
      console.log(`\nRow ${rowNum}:`);
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        console.log(`  Col ${colNum}: ${cell.value}`);
      });
    }
  });
  console.log(`\nTotal matches: ${found}`);

  // Also check total rows and sample first 3 data rows
  console.log("\n=== First 3 data rows ===");
  let count = 0;
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    if (count >= 3) return;
    count++;
    console.log(`\nRow ${rowNum}:`);
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      console.log(`  Col ${colNum}: ${cell.value}`);
    });
  });
}

main().catch(console.error);
