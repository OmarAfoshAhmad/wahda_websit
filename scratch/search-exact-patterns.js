const fs = require('fs');

const db = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));

console.log(`--- Searching for "قم" or "قمه" or "القمة" ---`);
db.filter(f => f.name.includes("قم") || f.name.includes("قمه") || f.name.includes("القم")).forEach(m => {
  console.log(`  - "${m.name}" | ID: "${m.id}"`);
});

console.log(`\n--- Searching for "دنت" or "dent" or "سن" ---`);
db.filter(f => f.name.toLowerCase().includes("دنت") || f.name.toLowerCase().includes("dent") || f.name.toLowerCase().includes("سن")).forEach(m => {
  console.log(`  - "${m.name}" | ID: "${m.id}"`);
});

console.log(`\n--- Searching for "طبرق" ---`);
db.filter(f => f.name.includes("طبرق")).forEach(m => {
  console.log(`  - "${m.name}" | ID: "${m.id}"`);
});

console.log(`\n--- Searching for "حكم" ---`);
db.filter(f => f.name.includes("حكم") || f.name.includes("الحكمة")).forEach(m => {
  console.log(`  - "${m.name}" | ID: "${m.id}"`);
});
