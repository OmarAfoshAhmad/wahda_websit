const XLSX = require('xlsx');
const path = require('path');

const files = [
  'ترميز دفعة 16.xlsx',
  'دفعة 17.xlsx',
];

for (const f of files) {
  try {
    const wb = XLSX.readFile(path.join(__dirname, '..', f));
    const ws = wb.Sheets[wb.SheetNames[0]];
    console.log('\n=== File:', f, '===');
    console.log('Sheet:', wb.SheetNames[0]);
    console.log('Range:', ws['!ref']);
    
    // Check for merged cells
    const merges = ws['!merges'] || [];
    console.log('Merged cells count:', merges.length);
    if (merges.length > 0) {
      console.log('First 10 merges:');
      merges.slice(0, 10).forEach((m, i) => {
        console.log(`  Merge ${i}: Col ${m.s.c}-${m.e.c}, Row ${m.s.r}-${m.e.r}`);
      });
    }
    
    // Read raw data with header row
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: '' });
    console.log('\nFirst 25 rows (raw):');
    for (let i = 0; i < Math.min(25, data.length); i++) {
      console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
    }
    
    // Also check with sheet_to_json (object mode) to see how keys are parsed
    const objData = XLSX.utils.sheet_to_json(ws);
    if (objData.length > 0) {
      console.log('\nDetected column keys:', Object.keys(objData[0]));
      console.log('First 5 rows (object mode):');
      for (let i = 0; i < Math.min(5, objData.length); i++) {
        console.log(`Row ${i}:`, JSON.stringify(objData[i]));
      }
    }
  } catch (e) {
    console.log('Error with', f, ':', e.message);
  }
}
