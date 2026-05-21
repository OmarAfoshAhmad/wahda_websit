const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join(__dirname, '..', 'خصومات الاسنان - Copy.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
  
  const excelFacilities = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = row.getCell(7).value;
    if (name) excelFacilities.push(String(name).trim());
  });

  const uniqueExcelFacilities = [...new Set(excelFacilities)];
  console.log('Unique facilities in Excel:', uniqueExcelFacilities);

  const dbFacilities = await prisma.facility.findMany({
    select: { id: true, name: true }
  });

  const matches = {};
  for (const ef of uniqueExcelFacilities) {
    // Find closest match or exact match
    const cleanEf = ef.replace(/\s+/g, ' ');
    const matched = dbFacilities.find(df => {
      const cleanDf = df.name.replace(/\s+/g, ' ');
      return cleanDf.includes(cleanEf) || cleanEf.includes(cleanDf);
    });
    matches[ef] = matched ? { id: matched.id, name: matched.name } : null;
  }

  console.log('Facility Matches:');
  console.log(JSON.stringify(matches, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
