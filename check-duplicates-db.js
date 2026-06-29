const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Checking for Duplicate Card Numbers ---');
  const duplicateCards = await prisma.$queryRaw`
    SELECT UPPER(BTRIM(card_number)) AS normalized_card, COUNT(*) AS count
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY UPPER(BTRIM(card_number))
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;
  console.log('Duplicate card numbers count:', duplicateCards.length);
  if (duplicateCards.length > 0) {
    console.log('Sample duplicate card numbers:', duplicateCards.slice(0, 10));
  }

  console.log('\n--- Checking for Duplicate Names + Birth Dates ---');
  const duplicatePeople = await prisma.$queryRaw`
    SELECT name, birth_date, COUNT(*) AS count
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY name, birth_date
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;
  console.log('Duplicate names + birth dates count:', duplicatePeople.length);
  if (duplicatePeople.length > 0) {
    console.log('Sample duplicate people:', duplicatePeople.slice(0, 10));
  }

  console.log('\n--- Checking for Duplicate Names only ---');
  const duplicateNames = await prisma.$queryRaw`
    SELECT name, COUNT(*) AS count
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
    GROUP BY name
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;
  console.log('Duplicate names only count:', duplicateNames.length);
  if (duplicateNames.length > 0) {
    console.log('Sample duplicate names:', duplicateNames.slice(0, 10));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
