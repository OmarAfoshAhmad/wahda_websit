const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');

(async () => {
  const prisma = new PrismaClient();
  const dbFacilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { name: true }
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('c:/Users/Omar/waad_temp_website/خصومات بصريات.xlsx');
  const ws = wb.worksheets[0];

  const uniqueExcelFacilities = new Set();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 2) return;
    const val = row.getCell(6).value;
    if (val) {
      uniqueExcelFacilities.add(String(val).trim());
    }
  });

  const outWb = new ExcelJS.Workbook();
  const outWs = outWb.addWorksheet('Mapping');
  outWs.columns = [
    { header: 'المركز في ملف الحركات', key: 'excel_name', width: 40 },
    { header: 'المركز في المنظومة (مقترح)', key: 'db_name', width: 40 }
  ];

  const dbNames = dbFacilities.map(f => f.name);

  for (const name of uniqueExcelFacilities) {
    let bestMatch = '';
    for (const dbName of dbNames) {
      if (dbName.includes(name) || name.includes(dbName)) {
        bestMatch = dbName;
        break;
      }
    }
    outWs.addRow({ excel_name: name, db_name: bestMatch });
  }

  outWs.addRow({});
  outWs.addRow({ excel_name: '--- قائمة جميع مراكز المنظومة ---' });
  for (const dbName of dbNames) {
    outWs.addRow({ db_name: dbName });
  }

  await outWb.xlsx.writeFile('c:/Users/Omar/waad_temp_website/مطابقة_مراكز_البصريات.xlsx');
  console.log('File created: مطابقة_مراكز_البصريات.xlsx');
  
  await prisma.$disconnect();
})();
