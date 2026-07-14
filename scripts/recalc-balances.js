/* eslint-disable no-console */
/**
 * recalc-balances.js
 *
 * يُعيد حساب remaining_balance وstatus لكل مستفيد بناءً على
 * جميع حركاته الفعلية في قاعدة البيانات.
 *
 * المنطق:
 *   remaining_balance = total_balance - Σ(حركات غير ملغاة وليست CANCELLATION)
 *
 * الحركات التي تُحسب:
 *   - MEDICINE  ← تُخصم من الرصيد
 *   - SUPPLIES  ← تُخصم من الرصيد
 *   - IMPORT    ← تُخصم من الرصيد
 *   - CANCELLATION ← لا تُخصم (هي تعويض عن حركة ملغاة)
 *   - أي حركة is_cancelled = true ← لا تُخصم (تم إلغاؤها)
 *
 * الاستخدام:
 *   node scripts/recalc-balances.js              ← dry-run (عرض فقط)
 *   node scripts/recalc-balances.js --apply       ← تطبيق التعديلات
 *   node scripts/recalc-balances.js --apply --verbose ← تفاصيل كل مستفيد
 *   node scripts/recalc-balances.js --card=WAB2025001  ← مستفيد واحد فقط
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    apply: false,
    verbose: false,
    cardFilter: null,
  };
  for (const arg of argv) {
    if (arg === "--apply") out.apply = true;
    else if (arg === "--verbose") out.verbose = true;
    else if (arg.startsWith("--card=")) out.cardFilter = arg.slice("--card=".length).trim();
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("=".repeat(60));
  console.log("[recalc-balances] وضع التشغيل:", args.apply ? "APPLY (تعديل فعلي)" : "DRY-RUN (عرض فقط)");
  if (args.cardFilter) console.log("[recalc-balances] فلترة على البطاقة:", args.cardFilter);
  console.log("=".repeat(60));

  // 1. جلب جميع المستفيدين غير المحذوفين
  const whereClause = {
    deleted_at: null,
    ...(args.cardFilter ? { card_number: args.cardFilter } : {}),
  };

  const beneficiaries = await prisma.beneficiary.findMany({
    where: whereClause,
    select: {
      id: true,
      card_number: true,
      name: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      completed_via: true,
    },
    orderBy: { card_number: "asc" },
  });

  console.log(`[recalc-balances] إجمالي المستفيدين: ${beneficiaries.length}`);

  // 2. جلب جميع الحركات الفعّالة (غير ملغاة وليست CANCELLATION)
  const transactions = await prisma.transaction.findMany({
    where: {
      beneficiary_id: { in: beneficiaries.map((b) => b.id) },
      is_cancelled: false,
      type: { not: "CANCELLATION" },
    },
    select: {
      beneficiary_id: true,
      amount: true,
      type: true,
    },
  });

  // 3. تجميع المبالغ المصروفة لكل مستفيد
  const spentByBeneficiary = new Map();
  for (const tx of transactions) {
    const current = spentByBeneficiary.get(tx.beneficiary_id) || 0;
    spentByBeneficiary.set(tx.beneficiary_id, current + Number(tx.amount));
  }

  // 4. حساب ما يجب أن يكون عليه الرصيد لكل مستفيد
  const changes = [];
  const stats = {
    total: beneficiaries.length,
    needsUpdate: 0,
    balanceMatch: 0,
    statusChange: 0,
    totalSpent: 0,
  };

  for (const ben of beneficiaries) {
    const totalBalance = Number(ben.total_balance);
    const currentRemaining = Number(ben.remaining_balance);
    const totalSpent = spentByBeneficiary.get(ben.id) || 0;

    // الرصيد المتبقي الصحيح
    const correctRemaining = Math.max(0, totalBalance - totalSpent);

    // تحديد الحالة الصحيحة
    let correctStatus;
    if (ben.status === "SUSPENDED") {
      // المعلّقون يبقون معلّقين بغض النظر عن الرصيد
      correctStatus = "SUSPENDED";
    } else if (correctRemaining <= 0) {
      correctStatus = "FINISHED";
    } else {
      correctStatus = "ACTIVE";
    }

    // completed_via
    let correctCompletedVia = ben.completed_via;
    if (correctStatus === "FINISHED" && ben.status !== "FINISHED") {
      correctCompletedVia = "IMPORT"; // تغيّرت للمرة الأولى عبر إعادة الحساب
    } else if (correctStatus !== "FINISHED") {
      correctCompletedVia = null; // لم يعد منتهياً
    }

    const balanceDiff = Math.abs(correctRemaining - currentRemaining);
    const statusChanged = correctStatus !== ben.status;
    const balanceChanged = balanceDiff > 0.001;

    stats.totalSpent += totalSpent;

    if (!balanceChanged && !statusChanged) {
      stats.balanceMatch++;
      if (args.verbose) {
        console.log(`  ✓ ${ben.card_number} (${ben.name}): رصيد صحيح = ${correctRemaining.toFixed(2)} د.ل`);
      }
      continue;
    }

    stats.needsUpdate++;
    if (statusChanged) stats.statusChange++;

    changes.push({
      id: ben.id,
      card_number: ben.card_number,
      name: ben.name,
      totalBalance,
      totalSpent,
      currentRemaining,
      correctRemaining,
      currentStatus: ben.status,
      correctStatus,
      currentCompletedVia: ben.completed_via,
      correctCompletedVia,
      balanceDiff,
    });

    if (args.verbose || !args.apply) {
      console.log(
        `  ✗ ${ben.card_number} (${ben.name}):` +
        `\n      رصيد حالي: ${currentRemaining.toFixed(2)} | رصيد صحيح: ${correctRemaining.toFixed(2)}` +
        `\n      مصروف: ${totalSpent.toFixed(2)} من أصل ${totalBalance.toFixed(2)}` +
        (statusChanged ? `\n      حالة: ${ben.status} → ${correctStatus}` : ""),
      );
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("[recalc-balances] ملخص:");
  console.log(`  إجمالي المستفيدين     : ${stats.total}`);
  console.log(`  أرصدة صحيحة          : ${stats.balanceMatch}`);
  console.log(`  يحتاج تحديث          : ${stats.needsUpdate}`);
  console.log(`  تغيّرت حالتهم         : ${stats.statusChange}`);
  console.log(`  إجمالي المصروف        : ${stats.totalSpent.toFixed(2)} د.ل`);
  console.log("=".repeat(60));

  if (!args.apply) {
    console.log("\n[recalc-balances] DRY-RUN. أضف --apply لتطبيق التعديلات.");
    return;
  }

  if (changes.length === 0) {
    console.log("\n[recalc-balances] جميع الأرصدة صحيحة. لا تعديلات مطلوبة.");
    return;
  }

  // 5. تطبيق التعديلات داخل transaction واحدة
  console.log(`\n[recalc-balances] جاري تحديث ${changes.length} مستفيد...`);

  await prisma.$transaction(
    changes.map((c) =>
      prisma.beneficiary.update({
        where: { id: c.id },
        data: {
          remaining_balance: c.correctRemaining,
          status: c.correctStatus,
          completed_via: c.correctCompletedVia,
        },
      }),
    ),
    { timeout: 60000 },
  );

  // 6. تسجيل في AuditLog
  await prisma.auditLog.create({
    data: {
      facility_id: null,
      user: "system",
      action: "RECALC_BALANCES",
      metadata: {
        total_beneficiaries: stats.total,
        updated: changes.length,
        status_changes: stats.statusChange,
        card_filter: args.cardFilter ?? null,
      },
    },
  });

  console.log(`[recalc-balances] تم تحديث ${changes.length} مستفيد بنجاح.`);

  // طباعة ملخص التغييرات
  if (changes.length <= 50 || args.verbose) {
    console.log("\nتفاصيل التغييرات:");
    for (const c of changes) {
      console.log(
        `  ${c.card_number}: ${c.currentRemaining.toFixed(2)} → ${c.correctRemaining.toFixed(2)} د.ل` +
        (c.currentStatus !== c.correctStatus ? ` | حالة: ${c.currentStatus} → ${c.correctStatus}` : ""),
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("[recalc-balances] خطأ:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
