/* eslint-disable no-console */
/**
 * import-gelyana-beneficiaries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * يستورد مستفيدي شركة المنطقة الحرة (جليانة / JFZ) من ملف Excel.
 *
 * هيكل الملف:
 *   col A  → الاسم الكامل
 *   col B  → جهة العمل (لغير الفارغة = منتسب رئيسي)
 *   col C  → رقم البطاقة الرئيسية (للتابع فقط — مرجع والده)
 *   col D  → القرابة  (HUSBAND | WIFE | SON | DAUGHTER | …)
 *   col E  → رقم بطاقة هذا الشخص  ← الحقل الأساسي
 *
 * الاستخدام:
 *   node scripts/import-gelyana-beneficiaries.js            ← Dry Run (عرض فقط)
 *   node scripts/import-gelyana-beneficiaries.js --apply    ← تطبيق فعلي على DB
 */

const path = require("path");
const fs   = require("fs");
const openpyxl = require("exceljs"); // still try exceljs first but will fallback

// ─── إعدادات ──────────────────────────────────────────────────────────────────
const EXCEL_PATH  = path.resolve("اسماء شركات الاسنان/جليانة_علاقات_دقيقة.xlsx");
const JFZ_CODE    = "JFZ";
const DENTAL_CEILING = 3000.00;   // سقف الأسنان بالدينار الليبي
const DENTAL_COV     = 100.00;    // نسبة التغطية (بدون تحمل مريض)
// ─────────────────────────────────────────────────────────────────────────────

const { PrismaClient } = require("@prisma/client");
const ExcelJS           = require("exceljs");
const prisma            = new PrismaClient();

function parseArgs(argv) {
  return { apply: argv.includes("--apply") };
}

function normalizeCard(val) {
  return String(val || "").trim().toUpperCase();
}

function normalizeName(val) {
  return String(val || "").trim().replace(/\s+/g, " ");
}

/**
 * قراءة كل صفوف الورقة (تجاهل الصف الأول header)
 * يُرجع مصفوفة { name, primaryCard, relation, cardNumber }
 */
async function readExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.worksheets[0];

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // تخطي رأس الجدول
    if (rowNum === 2) return; // تخطي الصف الفارغ الثاني إن وجد (استناداً لبيانات الفحص)

    const name        = normalizeName(row.getCell(1).value);
    const workplace   = normalizeName(row.getCell(2).value);
    const primaryCard = normalizeCard(row.getCell(3).value);
    const relation    = normalizeName(row.getCell(4).value).toUpperCase();
    const cardNumber  = normalizeCard(row.getCell(5).value);

    if (!name && !cardNumber) return; // صف فارغ

    rows.push({
      rowNum,
      name,
      workplace,
      primaryCard,     // رقم بطاقة الأصل (للتابع)
      relation,        // القرابة (فارغ للمنتسب الرئيسي)
      cardNumber,      // رقم البطاقة الخاص بهذا الشخص
      isDependent: !workplace && !!primaryCard, // تابع = لا توجد جهة عمل + يوجد مرجع رئيسي
    });
  });

  return rows;
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));

  console.log("━".repeat(60));
  console.log("📋  استيراد مستفيدي شركة المنطقة الحرة – جليانة (JFZ)");
  console.log(`    الوضع: ${apply ? "🔴 تطبيق فعلي على قاعدة البيانات" : "🔵 محاكاة فقط (Dry Run)"}`);
  console.log("━".repeat(60));

  // 1. التحقق من ملف Excel
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌  لم يُعثر على ملف Excel في: ${EXCEL_PATH}`);
    process.exit(1);
  }

  // 2. جلب بيانات الشركة من DB
  const company = await prisma.insuranceCompany.findUnique({
    where: { code: JFZ_CODE },
  });

  if (!company) {
    console.error(`❌  لم يُعثر على شركة بكود "${JFZ_CODE}" في قاعدة البيانات!`);
    console.error(`    يرجى إضافة الشركة أولاً من لوحة إدارة الشركات.`);
    process.exit(1);
  }

  console.log(`✅  الشركة: ${company.name} (ID: ${company.id})`);
  console.log(`    سقف الأسنان الحالي: ${company.dental_ceiling ?? "غير محدد"} → سيصبح ${DENTAL_CEILING} د.ل`);

  // 3. تحديث سقف الأسنان للشركة إذا لم يكن محدداً
  if (!company.dental_ceiling || Number(company.dental_ceiling) !== DENTAL_CEILING) {
    if (apply) {
      await prisma.insuranceCompany.update({
        where: { id: company.id },
        data: {
          dental_ceiling:  DENTAL_CEILING,
          dental_coverage: DENTAL_COV,
        },
      });
      console.log(`    ✓ تم تحديث السقف المالي للأسنان: ${DENTAL_CEILING} د.ل | تغطية: ${DENTAL_COV}%`);
    } else {
      console.log(`    [Dry Run] سيتم تحديث سقف الأسنان إلى ${DENTAL_CEILING} د.ل`);
    }
  }

  // 4. قراءة الـ Excel
  console.log("\n📂  قراءة ملف Excel...");
  const rows = await readExcel();
  console.log(`    إجمالي الصفوف المقروءة: ${rows.length}`);

  const primaryRows   = rows.filter(r => !r.isDependent);
  const dependentRows = rows.filter(r => r.isDependent);
  console.log(`    منتسبون رئيسيون: ${primaryRows.length}`);
  console.log(`    تابعون:           ${dependentRows.length}`);

  // 5. جلب المستفيدين الموجودين مسبقاً لمقارعة التكرارات
  const existingBeneficiaries = await prisma.beneficiary.findMany({
    where: { card_number: { in: rows.map(r => r.cardNumber).filter(Boolean) } },
    select: { id: true, card_number: true, name: true, deleted_at: true },
  });

  const existingMap = new Map(existingBeneficiaries.map(b => [b.card_number.trim().toUpperCase(), b]));

  // 6. معالجة كل صف
  let created   = 0;
  let skipped   = 0;
  let reactivated = 0;
  const errors  = [];
  const preview = [];

  for (const row of rows) {
    if (!row.cardNumber) {
      console.warn(`    ⚠️  الصف ${row.rowNum}: بدون رقم بطاقة — تم التجاهل`);
      skipped++;
      continue;
    }
    if (!row.name) {
      console.warn(`    ⚠️  الصف ${row.rowNum} (${row.cardNumber}): بدون اسم — تم التجاهل`);
      skipped++;
      continue;
    }

    const existing = existingMap.get(row.cardNumber);

    if (existing && !existing.deleted_at) {
      // موجود ونشط — تخطي
      console.log(`    ⏭️  موجود مسبقاً: ${row.cardNumber} (${row.name})`);
      skipped++;
      continue;
    }

    if (existing && existing.deleted_at) {
      // محذوف — إعادة تفعيل
      console.log(`    ♻️  إعادة تفعيل: ${row.cardNumber} (${row.name})`);
      if (apply) {
        await prisma.beneficiary.update({
          where: { id: existing.id },
          data: {
            deleted_at:        null,
            name:              row.name,
            status:            "ACTIVE",
            total_balance:     DENTAL_CEILING,
            remaining_balance: DENTAL_CEILING,
          },
        });
      }
      reactivated++;
      preview.push({ action: "REACTIVATE", card: row.cardNumber, name: row.name, relation: row.relation || "رئيسي" });
      continue;
    }

    // جديد — إنشاء
    preview.push({ action: "CREATE", card: row.cardNumber, name: row.name, relation: row.relation || "رئيسي" });

    if (apply) {
      try {
        const newBen = await prisma.beneficiary.create({
          data: {
            card_number:       row.cardNumber,
            name:              row.name,
            company_id:        company.id,
            status:            "ACTIVE",
            total_balance:     DENTAL_CEILING,
            remaining_balance: DENTAL_CEILING,
          },
        });

        // إنشاء WalletConsumption بالقيمة الصفرية (لم يستهلك بعد)
        await prisma.walletConsumption.upsert({
          where: {
            beneficiary_id_company_id_wallet_type_fiscal_year: {
              beneficiary_id: newBen.id,
              company_id:     company.id,
              wallet_type:    "DENTAL",
              fiscal_year:    2026,
            },
          },
          update: {},
          create: {
            beneficiary_id:  newBen.id,
            company_id:      company.id,
            wallet_type:     "DENTAL",
            fiscal_year:     2026,
            consumed_amount: 0,
            version:         1,
          },
        });

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    ❌  فشل إنشاء: ${row.cardNumber} — ${msg}`);
        errors.push({ card: row.cardNumber, name: row.name, error: msg });
      }
    } else {
      created++;
    }
  }

  // 7. ملخص النتائج
  console.log("\n" + "━".repeat(60));
  console.log("📊  ملخص العملية:");
  console.log(`    ✅  سيتم إنشاؤه / تم إنشاؤه:     ${created}`);
  console.log(`    ♻️  إعادة تفعيل:                  ${reactivated}`);
  console.log(`    ⏭️  موجود مسبقاً (تم تجاهله):    ${skipped}`);
  if (errors.length > 0) {
    console.log(`    ❌  أخطاء:                        ${errors.length}`);
    errors.forEach(e => console.log(`        - ${e.card} (${e.name}): ${e.error}`));
  }

  if (!apply) {
    console.log("\n📋  معاينة العمليات المنتظرة:");
    console.table(preview.slice(0, 50)); // أول 50 صف للعرض
    if (preview.length > 50) {
      console.log(`    ... و${preview.length - 50} عملية إضافية`);
    }
    console.log("\n💡  لتطبيق الاستيراد الفعلي، شغّل الأمر:");
    console.log("    node scripts/import-gelyana-beneficiaries.js --apply");
  } else {
    console.log("\n🏁  تم الاستيراد الفعلي بنجاح!");
  }

  console.log("━".repeat(60));
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌  خطأ فادح:", err);
  prisma.$disconnect();
  process.exit(1);
});
