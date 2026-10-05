/**
 * فحص ما قبل النشر على الإنتاج. يُشغَّل على الخادم قبل `prisma migrate deploy`:
 *   npm run predeploy:check
 * يخرج بالرمز 1 إن وُجد ما يمنع النشر.
 */
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const problems = [];
const warnings = [];
const ok = (message) => console.log(`✔ ${message}`);

// 1) متغيرات البيئة
const production = process.env.NODE_ENV === "production";
if (process.env.OTP_PREVIEW === "true") problems.push("OTP_PREVIEW=true: سيظهر رمز الدخول على الشاشة. احذف المتغير من الإنتاج.");
else ok("OTP_PREVIEW غير مفعّل");
for (const key of ["DATABASE_URL", "JWT_SECRET"]) if (!process.env[key]) problems.push(`المتغير ${key} غير مضبوط`);
if (!process.env.BENEFICIARY_JWT_SECRET) warnings.push("BENEFICIARY_JWT_SECRET غير مضبوط: سيُستخدم JWT_SECRET لجلسات المستفيدين (يُنصح بمفتاح منفصل).");
if (!production) warnings.push("NODE_ENV ليس production في هذه الجلسة.");

// 2) مجلد المرفقات قابل للكتابة ودائم
const storage = path.join(process.cwd(), "storage", "pharmacy-prescriptions");
try {
  await mkdir(storage, { recursive: true });
  const probe = path.join(storage, `.write-test-${process.pid}`);
  await writeFile(probe, "ok");
  await unlink(probe);
  await access(storage, constants.W_OK);
  ok(`مجلد المرفقات قابل للكتابة: ${storage}`);
  warnings.push("تأكد أن مجلد storage/ محفوظ بين عمليات النشر ومشمول في النسخ الاحتياطي (صور البطاقات والوصفات).");
} catch (error) {
  problems.push(`مجلد المرفقات غير قابل للكتابة (${storage}): ${error.message}`);
}

// 3) قاعدة البيانات
const prisma = new PrismaClient();
try {
  const tables = await prisma.$queryRaw`SELECT to_regclass('"PharmacyPrescription"')::text AS name`;
  if (tables[0]?.name) {
    // ترحيل 20261004100000 يجعل (المستفيد، الفئة، رقم الوصفة) فريدًا بغض النظر عن الحالة.
    const duplicates = await prisma.$queryRaw`
      SELECT beneficiary_id, medicine_category::text AS category, prescription_number, count(*)::int AS n
      FROM "PharmacyPrescription"
      GROUP BY 1, 2, 3 HAVING count(*) > 1
      LIMIT 20`;
    if (duplicates.length > 0) {
      problems.push(`توجد ${duplicates.length} مجموعة وصفات بنفس الرقم؛ ترحيل 20261004100000 سيفشل. أعد ترقيمها أولًا:\n${duplicates.map((row) => `   - ${row.beneficiary_id} ${row.category} #${row.prescription_number} × ${row.n}`).join("\n")}`);
    } else ok("لا توجد أرقام وصفات مكررة");
  } else ok("جدول الوصفات غير موجود بعد (سيُنشأ بالترحيلات)");

  const pending = await prisma.$queryRaw`SELECT to_regclass('"_prisma_migrations"')::text AS name`;
  if (pending[0]?.name) {
    const failed = await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    if (failed.length > 0) problems.push(`ترحيلات عالقة لم تكتمل: ${failed.map((row) => row.migration_name).join(", ")}`);
    else ok("لا توجد ترحيلات عالقة");
  }
} catch (error) {
  problems.push(`تعذر الاتصال بقاعدة البيانات: ${error.message}`);
} finally {
  await prisma.$disconnect();
}

for (const warning of warnings) console.log(`⚠ ${warning}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✘ ${problem}`);
  console.error("\nلا تنشر قبل معالجة ما سبق.");
  process.exit(1);
}
console.log("\nجاهز: شغّل الآن  npx prisma migrate deploy");
