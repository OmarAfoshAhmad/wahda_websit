const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('جاري تحديث المديرين لإجبارهم على تغيير كلمة المرور...');
  
  const result = await prisma.facility.updateMany({
    where: {
      is_admin: false,
      role: { not: 'ADMIN' },
      must_change_password: false
    },
    data: {
      must_change_password: true
    }
  });

  console.log(`تم بنجاح! تم تحديث عدد ${result.count} حساب (مدير/موظف) لإجبارهم على تغيير كلمة المرور عند الدخول القادم.`);
}

main()
  .catch((e) => {
    console.error('حدث خطأ أثناء التحديث:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
