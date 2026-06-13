const XLSX = require('xlsx');
const wb = XLSX.readFile('c:/Users/Omar/waad_temp_website/خصومات بصريات.xlsx');

for (const sheetName of wb.SheetNames) {
  console.log('--- Sheet:', sheetName, '---');
  const ws = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  for(let i=0; i<5; i++) {
    if (rawData[i]) console.log(JSON.stringify(rawData[i]));
  }
}
