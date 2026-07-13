const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const facilities = await prisma.facility.findMany({ select: { name: true, username: true } });
  
  const searchFor = [
    'فيزو كير', 'ابن سينا', 'الشفاء', 'أكسجين', 'اطلس', 
    'بنغازي التخصصي', 'منارة المستقبل', 'عيادة البدر', 
    'شركة الامل', 'مصحة المسرة', 'عيادة ماريا', 
    'مركز بداية', 'باب الشفاء', 'الحكيم'
  ];

  for (const s of searchFor) {
    const matches = facilities.filter(f => f.name.includes(s.replace('أ', 'ا')) || f.name.includes(s) || f.name.replace(/\s+/g, '').includes(s.replace(/\s+/g, '')));
    console.log(`Searching for "${s}":`);
    if (matches.length) {
      matches.forEach(m => console.log(`  - ${m.name} -> ${m.username}`));
    } else {
      console.log('  NOT FOUND');
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
