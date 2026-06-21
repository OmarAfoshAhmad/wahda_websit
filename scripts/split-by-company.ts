import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

async function main() {
  const inputPath = "c:\\Users\\Omar\\waad_temp_website\\حركات_مستفيدين_موحدة_ونظيفة.xlsx";
  const outputDir = "c:\\Users\\Omar\\waad_temp_website\\حركات_الشركات_منظمة";

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  // Map to hold workbooks for each company prefix
  // prefix -> workbook
  const companyWorkbooks = new Map<string, ExcelJS.Workbook>();
  // prefix -> map of worksheet name to worksheet
  const companySheets = new Map<string, Map<string, ExcelJS.Worksheet>>();

  wb.worksheets.forEach(ws => {
    const sheetName = ws.name;
    let headerRowIdx = 2;
    let cardCol = -1;

    // Find card column
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
      return;
    }

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowIdx) return;
      
      const cardVal = String(row.getCell(cardCol).value || "").trim();
      if (!cardVal) return;

      // Extract prefix (letters before the year 202x)
      const prefixMatch = cardVal.match(/^([A-Za-z]+)/);
      if (!prefixMatch) return;
      
      const prefix = prefixMatch[1].toUpperCase();

      // Initialize company workbook and worksheet if needed
      if (!companyWorkbooks.has(prefix)) {
        companyWorkbooks.set(prefix, new ExcelJS.Workbook());
        companySheets.set(prefix, new Map<string, ExcelJS.Worksheet>());
      }

      const compWb = companyWorkbooks.get(prefix)!;
      const sheetsMap = companySheets.get(prefix)!;

      if (!sheetsMap.has(sheetName)) {
        const newWs = compWb.addWorksheet(sheetName);
        // Copy columns setup
        newWs.columns = ws.columns;
        // Copy header row
        newWs.addRow(ws.getRow(headerRowIdx).values);
        // Style header
        const newHeader = newWs.getRow(1);
        newHeader.font = { bold: true };
        sheetsMap.set(sheetName, newWs);
      }

      const destWs = sheetsMap.get(sheetName)!;
      destWs.addRow(row.values);
    });
  });

  // Save all workbooks
  for (const [prefix, compWb] of companyWorkbooks.entries()) {
    const fileName = path.join(outputDir, `حركات_شركة_${prefix}.xlsx`);
    await compWb.xlsx.writeFile(fileName);
    console.log(`✅ تم إنشاء ملف الشركة: حركات_شركة_${prefix}.xlsx`);
  }

  console.log(`\n🎉 اكتمل تقسيم الحركات وحفظها في المجلد: ${outputDir}`);
}

main().catch(console.error);
