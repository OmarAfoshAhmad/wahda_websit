const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      results.push(file);
    }
  });
  return results;
}

const files = walk('src/app/admin/optics-services');
files.forEach(file => {
  if (!file.endsWith('.tsx') && !file.endsWith('.ts')) return;
  let content = fs.readFileSync(file, 'utf8');
  content = content
    .replace(/DENTAL/g, 'OPTICS')
    .replace(/dental/g, 'optics')
    .replace(/الأسنان/g, 'البصريات')
    .replace(/أسنان/g, 'بصريات')
    .replace(/Dental/g, 'Optics');
  fs.writeFileSync(file, content);
});
console.log('done replacing');
