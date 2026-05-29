const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT 
        pid, 
        state,
        extract(epoch from now() - query_start) as duration_seconds,
        query
      FROM pg_stat_activity 
      WHERE state != 'idle' 
        AND query NOT LIKE '%pg_stat_activity%'
        AND pid != pg_backend_pid();
    `);
    console.table(result);
  } catch (err) {
    console.error('Error fetching queries:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
