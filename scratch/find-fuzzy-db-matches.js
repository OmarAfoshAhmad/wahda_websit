const fs = require('fs');

const unmatched = [
  "التيجان", "الحكيم طبرق", "الرياده", "القيس", 
  "الليبية التخصصيه", "الليبيه التخصصيه", "الليبيه التخصيصيه", 
  "الهلال الاحمر - البركة", "دينتال", "فنيسيا", "مركز الابتسامه", 
  "مركز الحياة", "مركز القمة", "مركز درنه", "مصحة الاستشاري", 
  "مصحة الحكمة", "نبض الحياه"
];

function main() {
  const db = JSON.parse(fs.readFileSync('scratch/db-facilities.json', 'utf8'));
  
  unmatched.forEach(name => {
    console.log(`\nUnmatched: "${name}"`);
    const normalized = name.replace(/\s+/g, '').replace(/[ةه]/g, 'ه').toLowerCase();
    
    // Find database candidates containing parts of the name
    const candidates = db.filter(f => {
      const dbNorm = f.name.replace(/\s+/g, '').replace(/[ةه]/g, 'ه').toLowerCase();
      // Look for overlapping words or substrings
      return dbNorm.includes(normalized) || normalized.includes(dbNorm) || 
             name.split(' ').some(word => word.length > 3 && f.name.includes(word));
    });
    
    candidates.forEach(c => {
      console.log(`  - DB: "${c.name}" | ID: ${c.id}`);
    });
  });
}

main();
