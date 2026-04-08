const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const admins = await prisma.facility.findMany({
        where: { OR: [{ is_admin: true }, { is_manager: true }] },
        select: { username: true, deleted_at: true }
    });
    console.log(JSON.stringify(admins, null, 2));
}
main().finally(() => prisma.$disconnect());
