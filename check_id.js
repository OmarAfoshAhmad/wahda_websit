const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.transaction.findUnique({where:{id:'cmo3e390c0003hgbk3ktdznd1'}}).then(console.log).finally(()=>process.exit(0));
