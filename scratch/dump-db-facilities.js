const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    orderBy: { name: 'asc' }
  });
  
  const data = facilities.map(f => ({
    id: f.id,
    name: f.name,
    username: f.username,
    is_admin: f.is_admin
  }));
  
  fs.writeFileSync('scratch/db-facilities.json', JSON.stringify(data, null, 2));
  console.log(`Saved ${data.length} database facilities to scratch/db-facilities.json`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
