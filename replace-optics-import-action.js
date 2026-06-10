const fs = require('fs');

const file = 'src/app/actions/import-optics-transactions.ts';
let content = fs.readFileSync(file, 'utf8');
content = content
  .replace(/DENTAL/g, 'OPTICS')
  .replace(/dental/g, 'optics')
  .replace(/الأسنان/g, 'البصريات')
  .replace(/أسنان/g, 'بصريات')
  .replace(/Dental/g, 'Optics');
fs.writeFileSync(file, content);
console.log('done replacing in import optics transactions');
