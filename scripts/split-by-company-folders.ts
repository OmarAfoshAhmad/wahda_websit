import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

async function main() {
  const inputPath = "c:\\Users\\Omar\\waad_temp_website\\حركات_مستفيدين_موحدة_ونظيفة.xlsx";
  const outputBaseDir = "c:\\Users\\Omar\\waad_temp_website\\حركات_الشركات_منظمة";
  
  const ptDir = path.join(outputBaseDir, "العلاج_الطبيعي");
  const opticsDir = path.join(outputBaseDir, "البصريات");

  // Create directories
  [ptDir, opticsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  // We process each sheet separately
  for (const ws of wb.worksheets) {
    const sheetName = ws.name;
    const isOptics = sheetName.includes("النظارات") || sheetName.includes("بصريات");
    const targetDir = isOptics ? opticsDir : ptDir;

    // Map: prefix -> workbook (containing just this one sheet)
    const companyWorkbooks = new Map<string, ExcelJS.Workbook>();
    const companySheets = new Map<string, ExcelJS.Worksheet>();

    let headerRowIdx = 2;
    let cardCol = -1;

    const headerRow = ws.getRow(headerRowIdx).values as any[];
    if (headerRow && headerRow.length > 0) {
      for (let i = 1; i < headerRow.length; i++) {
        const val = String(headerRow[i] || "").trim();
        if (val.includes("رقم التامين") || val.includes("رقم التأمين") || val.includes("البطاقة")) {
          cardCol = i;
          break;
        }
      }
    }

    if (cardCol === -1) {
      console.log(`⚠️ لم يتم العثور على عمود رقم التأمين في ورقة: ${sheetName}`);
      continue;
    }

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowIdx) return;
      
      const cardVal = String(row.getCell(cardCol).value || "").trim();
      if (!cardVal) return;

      const prefixMatch = cardVal.match(/^([A-Za-z]+)/);
      if (!prefixMatch) return;
      
      const prefix = prefixMatch[1].toUpperCase();

      if (!companyWorkbooks.has(prefix)) {
        const newWb = new ExcelJS.Workbook();
        const newWs = newWb.addWorksheet(sheetName);
        newWs.columns = ws.columns;
        newWs.addRow(ws.getRow(headerRowIdx).values);
        newWs.getRow(1).font = { bold: true };
        
        companyWorkbooks.set(prefix, newWb);
        companySheets.set(prefix, newWs);
      }

      const destWs = companySheets.get(prefix)!;
      destWs.addRow(row.values);
    });

    // Save workbooks for this service type
    for (const [prefix, compWb] of companyWorkbooks.entries()) {
      const fileName = path.join(targetDir, `حركات_${prefix}.xlsx`);
      await compWb.xlsx.writeFile(fileName);
      console.log(`✅ تم إنشاء: ${path.basename(targetDir)} / حركات_${prefix}.xlsx`);
    }
  }

  console.log(`\n🎉 اكتمل تقسيم الحركات وحفظها في مجلدي العلاج الطبيعي والبصريات.`);
}

main().catch(console.error);
