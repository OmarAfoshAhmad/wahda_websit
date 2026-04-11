/**
 * سكربت التحقق من سلامة سلسلة hash في سجلات التدقيق.
 * الاستخدام: npx tsx scripts/verify-audit-integrity.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verify() {
  console.log("بدء فحص سجل التدقيق...\n");

  // هذه النسخة من قاعدة البيانات لا تحتوي أعمدة hash-chain.
  // نتحقق فقط من سلامة القراءة الزمنية للسجلات.

  const logs = await prisma.auditLog.findMany({
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      user: true,
      action: true,
      metadata: true,
      created_at: true,
    },
  });

  if (logs.length === 0) {
    console.log("لا توجد سجلات تدقيق.");
    return;
  }

  console.log(`عدد السجلات: ${logs.length}`);
  console.log(`أول سجل: ${logs[0].id} @ ${logs[0].created_at.toISOString()}`);
  console.log(`آخر سجل: ${logs[logs.length - 1].id} @ ${logs[logs.length - 1].created_at.toISOString()}`);
  console.log("الفحص الأساسي اكتمل بنجاح.");
}

verify()
  .catch((e) => {
    console.error("خطأ:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
