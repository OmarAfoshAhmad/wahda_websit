const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('src');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('type="date"')) {
    // Regex to match <Input type="date" or <input type="date"
    // that don't have lang attribute
    let changed = false;
    
    // Simplest approach: Replace type="date" with type="date" lang="en-GB"
    // But we need to make sure we don't duplicate it.
    if (!content.includes('lang="en-GB"')) {
      content = content.replace(/type="date"/g, 'type="date" lang="en-GB"');
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
});
