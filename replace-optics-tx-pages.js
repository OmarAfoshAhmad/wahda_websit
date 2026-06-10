const fs = require('fs');

const files = [
  'src/app/admin/optics-transactions/page.tsx',
  'src/app/admin/optics-transactions/import/page.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content
    .replace(/DENTAL/g, 'OPTICS')
    .replace(/dental/g, 'optics')
    .replace(/الأسنان/g, 'البصريات')
    .replace(/أسنان/g, 'بصريات')
    .replace(/Dental/g, 'Optics');
  fs.writeFileSync(file, content);
});
console.log('done replacing in optics-transactions pages');
