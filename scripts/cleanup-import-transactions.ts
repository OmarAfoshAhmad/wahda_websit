// سكريبت تنظيف جميع حركات الاستيراد (IMPORT) بجعلها ملغاة
// شغّل هذا السكريبت قبل إعادة الاستيراد لضمان توزيع نظيف
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.transaction.updateMany({
    where: {
      type: 'IMPORT',
      is_cancelled: false,
    },
    data: {
      is_cancelled: true,
    },
  });
  console.log(`تم إلغاء ${result.count} حركة استيراد.`);
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});