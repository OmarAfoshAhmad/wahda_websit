const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.transaction.findMany({where:{amount:42}}).then(console.log).finally(()=>process.exit(0));
