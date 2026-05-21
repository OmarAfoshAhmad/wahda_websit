const fs = require('fs');

const targets = [
  "تيجان", "التيجان", "الحكيم", "طبرق", "الريادة", "الرياده", 
  "قيس", "القيس", "الليبية", "الليبيه", "الهلال", "دينتال", 
  "فنيسيا", "فينيسيا", "الابتسامه", "الابتسامة", "الحياة", "الحياه", 
  "القمة", "القمة", "درنه", "درنة", "الاستشاري", "الحكمة", "نبض"
];

function main() {
  const db = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));
  
  targets.forEach(t => {
    console.log(`\n--- Search term: "${t}" ---`);
    const matches = db.filter(f => f.name.includes(t));
    matches.forEach(m => {
      console.log(`  - "${m.name}" | ID: "${m.id}" | Username: "${m.username}"`);
    });
  });
}

main();
