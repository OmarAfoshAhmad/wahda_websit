const fs = require('fs');
const db = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));

db.filter(f => f.username.toLowerCase().includes('tb') || f.username.toLowerCase().includes('tob') || f.name.includes('طبرق') || f.name.includes('طبر')).forEach(m => {
  console.log(`  - "${m.name}" | ID: "${m.id}" | Username: "${m.username}"`);
});
