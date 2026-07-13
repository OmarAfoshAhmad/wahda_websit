const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const folderPath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للعلاج الطبيعي';

async function extractFacilities() {
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.xlsx') && !f.includes('STATISTICS'));
  const uniqueFacilities = new Set();

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(filePath);
      const ws = wb.worksheets[0];
      
      let facilityCol = -1;
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        const val = String(cell.value || "").trim();
        if (val.includes("مرفق") || val.includes("جهة") || val.includes("جيهة") || val.includes("مركز")) {
          facilityCol = colNumber;
        }
      });

      if (facilityCol === -1) {
        // try row 2
        const headerRow2 = ws.getRow(2);
        headerRow2.eachCell((cell, colNumber) => {
          const val = String(cell.value || "").trim();
          if (val.includes("مرفق") || val.includes("جهة") || val.includes("جيهة") || val.includes("مركز")) {
            facilityCol = colNumber;
          }
        });
      }

      if (facilityCol !== -1) {
        ws.eachRow((row, rowNumber) => {
          if (rowNumber > 1) { // Skip headers
            const val = row.getCell(facilityCol).value;
            if (val && String(val).trim() !== "" && !String(val).includes("جهة")) {
              uniqueFacilities.add(String(val).trim());
            }
          }
        });
      }
    } catch (e) {
      console.error('Error reading', file, e.message);
    }
  }

  console.log(JSON.stringify(Array.from(uniqueFacilities), null, 2));
}

extractFacilities().catch(console.error);
