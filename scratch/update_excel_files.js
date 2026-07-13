const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const folderPath = 'c:\\Users\\Omar\\waad_temp_website\\حركات الشركات للعلاج الطبيعي';
const mappingFilePath = 'c:\\Users\\Omar\\waad_temp_website\\مطابقة_المرافق.xlsx';

async function updateFiles() {
  console.log('Reading mapping file...');
  const mappingWb = new ExcelJS.Workbook();
  await mappingWb.xlsx.readFile(mappingFilePath);
  const mappingWs = mappingWb.worksheets[0];
  
  const mapping = {};
  mappingWs.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const original = String(row.getCell(1).value || "").trim();
      const standard = String(row.getCell(2).value || "").trim();
      if (original && standard) {
        mapping[original] = standard;
      }
    }
  });

  console.log('Mapping loaded:', mapping);

  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.xlsx') && !f.includes('STATISTICS'));

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    console.log(`Processing ${file}...`);
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
        const headerRow2 = ws.getRow(2);
        headerRow2.eachCell((cell, colNumber) => {
          const val = String(cell.value || "").trim();
          if (val.includes("مرفق") || val.includes("جهة") || val.includes("جيهة") || val.includes("مركز")) {
            facilityCol = colNumber;
          }
        });
      }

      let modified = false;
      if (facilityCol !== -1) {
        ws.eachRow((row, rowNumber) => {
          if (rowNumber > 1) {
            const cell = row.getCell(facilityCol);
            const val = String(cell.value || "").trim();
            if (val && mapping[val] && mapping[val] !== val) {
              cell.value = mapping[val];
              modified = true;
            }
          }
        });
      }

      if (modified) {
        await wb.xlsx.writeFile(filePath);
        console.log(`  -> Updated ${file}`);
      } else {
        console.log(`  -> No changes needed for ${file}`);
      }
    } catch (e) {
      console.error(`  -> Error processing ${file}: ${e.message}`);
    }
  }
  
  console.log('All files updated successfully.');
}

updateFiles().catch(console.error);
