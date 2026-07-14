/**
 * سكربت تصحيح سلامة البيانات:
 *   1. تنظيف حركات IMPORT المتكررة (الإبقاء على الأحدث فقط لكل مستفيد)
 *   2. إعادة حساب remaining_balance لجميع المستفيدين بناءً على الحركات الفعلية
 *
 * الاستخدام: node scripts/fix-data-integrity.js [--dry-run]
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

async function main() {
  console.log(DRY_RUN ? "=== وضع المعاينة (بدون تغيير فعلي) ===" : "=== وضع التنفيذ الفعلي ===");
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // 1. تنظيف حركات IMPORT المتكررة لكل مستفيد
  // ═══════════════════════════════════════════════════════════════
  console.log("─── 1. تنظيف حركات IMPORT المتكررة ───");

  const duplicateImports = await prisma.$queryRaw`
    SELECT beneficiary_id, COUNT(*)::int as cnt
    FROM "Transaction"
    WHERE type = 'IMPORT' AND is_cancelled = false
    GROUP BY beneficiary_id
    HAVING COUNT(*) > 1
  `;

  console.log(`مستفيدون بأكثر من حركة IMPORT: ${duplicateImports.length}`);

  let totalCancelled = 0;
  for (const row of duplicateImports) {
    const imports = await prisma.transaction.findMany({
      where: {
        beneficiary_id: row.beneficiary_id,
        type: "IMPORT",
        is_cancelled: false,
      },
      orderBy: { created_at: "desc" },
      select: { id: true, amount: true, created_at: true },
    });

    // نبقي الأحدث فقط
    const keep = imports[0];
    const toDelete = imports.slice(1);

    const ben = await prisma.beneficiary.findUnique({
      where: { id: row.beneficiary_id },
      select: { card_number: true, name: true },
    });

    if (VERBOSE) {
      console.log(
        `  ${ben?.card_number} (${ben?.name}): ${imports.length} حركات IMPORT → إبقاء الأحدث (${keep.amount} د.ل)، إلغاء ${toDelete.length}`
      );
    }

    if (!DRY_RUN) {
      await prisma.transaction.updateMany({
        where: { id: { in: toDelete.map((t) => t.id) }, is_cancelled: false },
        data: { is_cancelled: true },
      });
    }

    totalCancelled += toDelete.length;
  }

  console.log(`إجمالي حركات IMPORT الملغاة: ${totalCancelled}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // 2. تصحيح انحراف الأرصدة
  // ═══════════════════════════════════════════════════════════════
  console.log("─── 2. تصحيح انحراف الأرصدة (remaining_balance) ───");

  const driftRows = await prisma.$queryRaw`
    SELECT
      b.id,
      b.card_number,
      b.name,
      b.total_balance,
      b.remaining_balance AS stored_remaining,
      b.status,
      b.completed_via,
      COALESCE(
        SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END),
        0
      ) AS total_deducted
    FROM "Beneficiary" b
    LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
    WHERE b.deleted_at IS NULL
    GROUP BY b.id
    HAVING
      b.remaining_balance <>
      GREATEST(0, b.total_balance -
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)
      )
  `;

  console.log(`مستفيدون بانحراف في الرصيد: ${driftRows.length}`);

  let fixedCount = 0;
  for (const row of driftRows) {
    const totalBal = Number(row.total_balance);
    const deducted = Number(row.total_deducted);
    const correctRemaining = Math.round(Math.max(0, totalBal - deducted) * 100) / 100;
    const storedRemaining = Number(row.stored_remaining);
    const drift = Math.round((storedRemaining - correctRemaining) * 100) / 100;
    const currentStatus = String(row.status);
    const currentCompletedVia = row.completed_via == null ? null : String(row.completed_via);
    const correctStatus = currentStatus === "SUSPENDED"
      ? "SUSPENDED"
      : (correctRemaining <= 0 ? "FINISHED" : "ACTIVE");
    let correctCompletedVia = currentCompletedVia;
    if (correctStatus === "FINISHED" && currentStatus !== "FINISHED") {
      correctCompletedVia = "IMPORT";
    } else if (correctStatus === "ACTIVE") {
      correctCompletedVia = null;
    }

    if (VERBOSE) {
      console.log(
        `  ${row.card_number} (${row.name}): total=${totalBal}, deducted=${deducted}, ` +
        `stored_remaining=${storedRemaining}, correct=${correctRemaining}, drift=${drift > 0 ? "+" : ""}${drift}, ` +
        `status: ${row.status} → ${correctStatus}`
      );
    }

    if (!DRY_RUN) {
      await prisma.beneficiary.update({
        where: { id: row.id },
        data: {
          remaining_balance: correctRemaining,
          status: correctStatus,
          completed_via: correctCompletedVia,
        },
      });
    }

    fixedCount++;
  }

  console.log(`إجمالي الأرصدة المُصحَّحة: ${fixedCount}`);
  console.log("");

  // ═══════════════════════════════════════════════════════════════
  // 3. تقرير التحقق
  // ═══════════════════════════════════════════════════════════════
  console.log("─── 3. التحقق بعد الإصلاح ───");

  const remainingDuplicates = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT beneficiary_id)::int as cnt
    FROM (
      SELECT beneficiary_id
      FROM "Transaction"
      WHERE type = 'IMPORT' AND is_cancelled = false
      GROUP BY beneficiary_id
      HAVING COUNT(*) > 1
    ) sub
  `;

  const remainingDrift = await prisma.$queryRaw`
    SELECT COUNT(*)::int as cnt FROM (
      SELECT b.id
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
      GROUP BY b.id
      HAVING
        b.remaining_balance <>
        GREATEST(0, b.total_balance -
          COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)
        )
    ) sub
  `;

  console.log(`حركات IMPORT مكررة متبقية: ${remainingDuplicates[0]?.cnt ?? 0}`);
  console.log(`أرصدة بانحراف متبقية: ${remainingDrift[0]?.cnt ?? 0}`);

  if (DRY_RUN) {
    console.log("\n⚠️  هذا كان وضع معاينة فقط. أعد التشغيل بدون --dry-run للتنفيذ الفعلي.");
  } else {
    console.log("\n✅ اكتمل الإصلاح بنجاح.");
  }
}

main()
  .catch((e) => {
    console.error("خطأ:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
