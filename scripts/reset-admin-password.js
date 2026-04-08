const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const password = 'Admin123';
    const hash = await bcrypt.hash(password, 10);

    await prisma.facility.update({
        where: { username: 'admin' },
        data: {
            password_hash: hash,
            must_change_password: false
        }
    });

    console.log('Admin password reset to: ' + password);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
