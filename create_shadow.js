const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe('CREATE DATABASE wahda_shadow;');
    console.log("Shadow database created.");
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
