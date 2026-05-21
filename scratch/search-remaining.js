const fs = require('fs');

const terms = ["dental", "Dental", "دينتال", "القمة", "القمة", "قمة", "درن", "البركة", "بركة", "الاستشاري", "الاستشارية"];

function main() {
  const db = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));
  
  terms.forEach(t => {
    console.log(`\n--- Search term: "${t}" ---`);
    const matches = db.filter(f => f.name.toLowerCase().includes(t.toLowerCase()));
    matches.forEach(m => {
      console.log(`  - "${m.name}" | ID: "${m.id}" | Username: "${m.username}"`);
    });
  });
}

main();
