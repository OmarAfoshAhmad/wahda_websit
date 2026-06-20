const fs = require('fs');

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
  if (content.includes('<Input') && content.includes('type="date"')) {
    let changed = false;
    
    // Add import if not present
    if (!content.includes('DateInput') && content.match(/import\s+{([^}]+)}\s+from\s+['"]@\/components\/ui['"]/)) {
      content = content.replace(/import\s+{([^}]+)}\s+from\s+['"]@\/components\/ui['"]/, (match, p1) => {
        return `import {${p1}, DateInput} from "@/components/ui"`;
      });
      changed = true;
    }
    
    // Replace <Input ... type="date" ... /> with <DateInput ... />
    // Also remove type="date" and lang="en-GB" and id (since DateInput doesn't support id)
    if (content.match(/<Input[^>]+type="date"[^>]*\/>/g)) {
      content = content.replace(/<Input([^>]+)type="date"([^>]*)\/>/g, (match, p1, p2) => {
        let newProps = (p1 + p2)
          .replace(/id="[^"]*"\s*/g, '')
          .replace(/lang="[^"]*"\s*/g, '');
        // DateInput takes defaultValue, onChange, etc.
        return `<DateInput${newProps}/>`;
      });
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Updated ${file}`);
    }
  }
});
