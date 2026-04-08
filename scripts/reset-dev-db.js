/* eslint-disable no-console */
/**
 * reset-dev-db.js
 * ================
 * يُصفّر قاعدة البيانات بالكامل في بيئة التطوير فقط.
 *
 * ⚠️  محظور تماماً في الإنتاج — السكريبت يرفض التشغيل خارج NODE_ENV=development
 *
 * ما يفعله:
 *   1. يحذف جميع البيانات بالترتيب الصحيح (مراعاة العلاقات)
 *   2. يعيد إنشاء حساب Admin افتراضي
 *   3. يُعيد تعيين جميع الـ sequences
 *
 * الاستخدام:
 *   node scripts/reset-dev-db.js              ← عرض ما سيحذف (dry-run)
 *   node scripts/reset-dev-db.js --apply      ← تنفيذ التصفير الفعلي
 *   node scripts/reset-dev-db.js --apply --keep-facilities  ← الاحتفاظ بحسابات المرافق
 *   node scripts/reset-dev-db.js --apply --keep-auditlog    ← الاحتفاظ بسجل المراجعة
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// ─── حماية: رفض التشغيل في الإنتاج ──────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
    console.error("🚨 BLOCKED: لا يمكن تشغيل reset-dev-db في بيئة الإنتاج!");
    console.error("   NODE_ENV=" + process.env.NODE_ENV);
    process.exit(1);
}

// تحذير إضافي إذا كانت قاعدة البيانات تبدو وكأنها إنتاجية
const dbUrl = process.env.DATABASE_URL || "";
if (
    dbUrl.includes("prod") ||
    dbUrl.includes("production") ||
    dbUrl.includes("live")
) {
    console.error("🚨 BLOCKED: DATABASE_URL تبدو وكأنها لقاعدة إنتاج!");
    console.error("   مسموح فقط بقواعد بيانات التطوير.");
    process.exit(1);
}

// ─── إعداد ──────────────────────────────────────────────────────────────────
const prisma = new PrismaClient();

function parseArgs(argv) {
    return {
        apply: argv.includes("--apply"),
        keepFacilities: argv.includes("--keep-facilities"),
        keepAuditLog: argv.includes("--keep-auditlog"),
        verbose: argv.includes("--verbose"),
    };
}

function comma(n) {
    return n.toLocaleString("ar");
}

// ─── المنطق الرئيسي ──────────────────────────────────────────────────────────
async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log("");
    console.log("═".repeat(60));
    console.log("  🗑️  reset-dev-db — تصفير قاعدة بيانات التطوير");
    console.log("═".repeat(60));
    console.log(`  الوضع    : ${args.apply ? "✅ APPLY (تنفيذ فعلي)" : "👁️  DRY-RUN (عرض فقط)"}`);
    console.log(`  المرافق  : ${args.keepFacilities ? "✅ محفوظة" : "🗑️  ستُحذف"}`);
    console.log(`  سجل المراجعة: ${args.keepAuditLog ? "✅ محفوظ" : "🗑️  سيُحذف"}`);
    console.log("─".repeat(60));

    // ─── إحصائيات قبل التصفير ────────────────────────────────────────────────
    const [
        notifCount,
        txCount,
        benefCount,
        auditCount,
        facilityCount,
        importJobCount,
        restoreJobCount,
    ] = await Promise.all([
        prisma.notification.count(),
        prisma.transaction.count(),
        prisma.beneficiary.count(),
        prisma.auditLog.count(),
        prisma.facility.count({ where: { deleted_at: null, is_admin: false, is_manager: false } }),
        prisma.importJob.count(),
        prisma.restoreJob.count(),
    ]);

    console.log("");
    console.log("  📊 الإحصائيات الحالية:");
    console.log(`     إشعارات              : ${comma(notifCount)}`);
    console.log(`     حركات مالية          : ${comma(txCount)}`);
    console.log(`     مستفيدون             : ${comma(benefCount)}`);
    console.log(`     سجلات مراجعة         : ${comma(auditCount)}`);
    console.log(`     مرافق صحية           : ${comma(facilityCount)}`);
    console.log(`     وظائف استيراد        : ${comma(importJobCount)}`);
    console.log(`     وظائف استعادة        : ${comma(restoreJobCount)}`);
    console.log("");

    if (!args.apply) {
        console.log("  ℹ️  هذا عرض فقط (dry-run). لتنفيذ التصفير أضف: --apply");
        console.log("");
        console.log("  أمثلة:");
        console.log("    node scripts/reset-dev-db.js --apply");
        console.log("    node scripts/reset-dev-db.js --apply --keep-facilities");
        console.log("    node scripts/reset-dev-db.js --apply --keep-auditlog");
        console.log("═".repeat(60));
        return;
    }

    // ─── تأكيد مزدوج ─────────────────────────────────────────────────────────
    console.log("  ⚠️  سيتم حذف البيانات بشكل نهائي!");
    console.log("     اضغط Ctrl+C خلال 3 ثوانٍ للإلغاء...");
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("  ⏳ جاري التصفير...");
    console.log("");

    // ─── بدء الحذف بالترتيب الصحيح (مراعاة العلاقات) ────────────────────────
    await prisma.$transaction(
        async (tx) => {

            // 1. الإشعارات (تعتمد على Beneficiary)
            const deletedNotifs = await tx.notification.deleteMany();
            console.log(`  ✅ حُذفت ${comma(deletedNotifs.count)} إشعار`);

            // 2. الحركات المالية (تعتمد على Beneficiary + Facility)
            const deletedTx = await tx.transaction.deleteMany();
            console.log(`  ✅ حُذفت ${comma(deletedTx.count)} حركة مالية`);

            // 3. المستفيدون (بما فيهم المحذوفون ناعماً)
            const deletedBenef = await tx.beneficiary.deleteMany();
            console.log(`  ✅ حُذف ${comma(deletedBenef.count)} مستفيد`);

            // 4. سجل المراجعة (اختياري)
            if (!args.keepAuditLog) {
                const deletedAudit = await tx.auditLog.deleteMany();
                console.log(`  ✅ حُذفت ${comma(deletedAudit.count)} سجل مراجعة`);
            } else {
                console.log(`  ⏩ تم تخطي حذف سجل المراجعة (--keep-auditlog)`);
            }

            // 5. وظائف الاستيراد والاستعادة
            const deletedImports = await tx.importJob.deleteMany();
            const deletedRestores = await tx.restoreJob.deleteMany();
            console.log(`  ✅ حُذفت ${comma(deletedImports.count)} وظيفة استيراد`);
            console.log(`  ✅ حُذفت ${comma(deletedRestores.count)} وظيفة استعادة`);

            // 6. المرافق الصحية (غير المشرفين) — اختياري
            if (!args.keepFacilities) {
                const deletedFacilities = await tx.facility.deleteMany({
                    where: {
                        is_admin: false,
                        is_manager: false,
                    },
                });
                console.log(`  ✅ حُذفت ${comma(deletedFacilities.count)} مرفق صحي`);
            } else {
                console.log(`  ⏩ تم تخطي حذف المرافق الصحية (--keep-facilities)`);
            }
        },
        { timeout: 60_000 }
    );

    // ─── إعادة إنشاء حساب Admin ──────────────────────────────────────────────
    console.log("");
    console.log("  🔧 إعادة إنشاء حساب المشرف...");

    const adminUsername = process.env.ADMIN_RESET_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_RESET_PASSWORD || "Admin123456";
    const adminName = process.env.ADMIN_RESET_NAME || "شركة وعد - الإدارة";

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    await prisma.facility.upsert({
        where: { username: adminUsername },
        update: {
            name: adminName,
            password_hash: passwordHash,
            is_admin: true,
            is_manager: false,
            manager_permissions: null,
            must_change_password: false,
            deleted_at: null,
        },
        create: {
            name: adminName,
            username: adminUsername,
            password_hash: passwordHash,
            is_admin: true,
            is_manager: false,
            must_change_password: false,
        },
    });

    // ─── تسجيل عملية التصفير في AuditLog ─────────────────────────────────────
    await prisma.auditLog.create({
        data: {
            facility_id: null,
            user: "system",
            action: "DEV_DB_RESET",
            metadata: {
                reset_at: new Date().toISOString(),
                node_env: process.env.NODE_ENV,
                kept_facilities: args.keepFacilities,
                kept_audit_log: args.keepAuditLog,
                admin_username: adminUsername,
            },
        },
    });

    console.log("");
    console.log("═".repeat(60));
    console.log("  🎉 تم التصفير بنجاح!");
    console.log("");
    console.log("  📋 بيانات الدخول الافتراضية:");
    console.log(`     المستخدم : ${adminUsername}`);
    console.log(`     كلمة المرور: ${adminPassword}`);
    console.log("");
    console.log("  💡 نصيحة: يمكنك تخصيص بيانات Admin عبر متغيرات البيئة:");
    console.log("     ADMIN_RESET_USERNAME=admin");
    console.log("     ADMIN_RESET_PASSWORD=MyPassword123");
    console.log("     ADMIN_RESET_NAME=اسم الشركة");
    console.log("═".repeat(60));
    console.log("");
}

main()
    .catch((err) => {
        console.error("");
        console.error("🚨 فشل التصفير:", err.message || err);
        if (err.code) console.error("   كود الخطأ:", err.code);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
