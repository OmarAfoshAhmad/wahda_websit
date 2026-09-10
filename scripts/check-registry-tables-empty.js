"use strict";

/**
 * فحص ما قبل النشر لـ migration حذف جدولَي Truth Registry.
 * يفشل (exit 1) إن كان أي من الجدولين يحوي صفوفاً — فلا يُشغَّل migrate deploy قبل مراجعتها.
 * للقراءة فقط.
 *
 *   AUDIT_DATABASE_URL="postgresql://..." node scripts/check-registry-tables-empty.js
 */

function requireAuditUrl() {
  const value = process.env.AUDIT_DATABASE_URL;
  if (!value) {
    throw new Error("AUDIT_DATABASE_URL is required; DATABASE_URL is intentionally ignored.");
  }
  const parsed = new URL(value);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("AUDIT_DATABASE_URL must be a PostgreSQL URL.");
  }
  return value;
}

const TABLES = ["CardIssuanceRegistry", "CardIssuanceRegistryAll"];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: requireAuditUrl(), log: ["error"] });
  let blocking = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      for (const table of TABLES) {
        const [{ exists }] = await tx.$queryRawUnsafe(
          `SELECT to_regclass($1) IS NOT NULL AS exists`,
          `"${table}"`,
        );
        if (!exists) {
          console.log(`  ${table}: غير موجود (المهاجرة مطبَّقة مسبقاً أو الجدول لم يُنشأ)`);
          continue;
        }
        const [{ count }] = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`);
        const status = count === 0 ? "فارغ — آمن للحذف" : `يحوي ${count} صف — أوقف النشر وراجع`;
        console.log(`  ${table}: ${status}`);
        if (count > 0) blocking = true;
      }
    });
  } finally {
    await prisma.$disconnect();
  }

  if (blocking) {
    console.error("\n✗ لا تشغّل migrate deploy: جدول غير فارغ سيُحذف نهائياً.");
    process.exitCode = 1;
  } else {
    console.log("\n✓ آمن: migration حذف الجدولين لن يفقد أي بيانات.");
  }
}

main().catch((error) => {
  console.error("فشل الفحص:", error.message);
  process.exitCode = 1;
});
