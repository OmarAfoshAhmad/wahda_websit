const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log("جاري إعادة تعيين كلمات المرور...");
    const hash = await bcrypt.hash('123456', 10);

    const resFacilities = await prisma.facility.updateMany({
        data: {
            password_hash: hash,
            must_change_password: true
        }
    });

    const admin = await prisma.facility.findFirst({
        where: { username: 'admin' }
    });

    if (admin) {
        console.log("تم الحفاظ على حساب الـ admin أو التعديل عليه.");
    }

    console.log(`✅ تم بنجاح: تم إعادة تعيين كلمات المرور لـ ${resFacilities.count} حساب (مديرين ومرافق) لتصبح: 123456`);
}

run()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
