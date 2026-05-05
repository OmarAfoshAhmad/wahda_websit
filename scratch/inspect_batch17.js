const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, '..', 'دفعة 17.xlsx');
console.log('Reading file:', filePath);

const wb = XLSX.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];

console.log('Sheet:', wb.SheetNames[0]);
console.log('Range:', ws['!ref']);

// Check for merged cells - THIS IS CRITICAL
const merges = ws['!merges'] || [];
console.log('\n=== MERGED CELLS ===');
console.log('Total merged cells:', merges.length);
merges.forEach((m, i) => {
  console.log(`  Merge ${i}: Col ${m.s.c} Row ${m.s.r} -> Col ${m.e.c} Row ${m.e.r}`);
});

// Read raw data
const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: '' });
console.log('\n=== RAW DATA (first 30 rows) ===');
for (let i = 0; i < Math.min(30, data.length); i++) {
  console.log(`Row ${i}: ${JSON.stringify(data[i])}`);
}

// Also read with cellDates
const data2 = XLSX.utils.sheet_to_json(ws, { cellDates: true });
if (data2.length > 0) {
  console.log('\n=== COLUMN KEYS ===');
  console.log(Object.keys(data2[0]));
  console.log('\n=== OBJECT MODE (first 10 rows) ===');
  for (let i = 0; i < Math.min(10, data2.length); i++) {
    console.log(`Row ${i}:`, JSON.stringify(data2[i]));
  }
}

// Write results to a text file too
const output = [];
output.push('Sheet: ' + wb.SheetNames[0]);
output.push('Range: ' + ws['!ref']);
output.push('Merged cells: ' + merges.length);
merges.forEach((m, i) => {
  output.push(`  Merge ${i}: Col ${m.s.c} Row ${m.s.r} -> Col ${m.e.c} Row ${m.e.r}`);
});
output.push('\nRAW DATA:');
for (let i = 0; i < Math.min(30, data.length); i++) {
  output.push(`Row ${i}: ${JSON.stringify(data[i])}`);
}
if (data2.length > 0) {
  output.push('\nCOLUMN KEYS: ' + JSON.stringify(Object.keys(data2[0])));
  output.push('\nOBJECT MODE:');
  for (let i = 0; i < Math.min(10, data2.length); i++) {
    output.push(`Row ${i}: ${JSON.stringify(data2[i])}`);
  }
}

fs.writeFileSync(path.join(__dirname, 'batch17_analysis.txt'), output.join('\n'), 'utf8');
console.log('\nResults also saved to scratch/batch17_analysis.txt');
