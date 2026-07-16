/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * وسم البطاقات القديمة من CSV/XLSX بأمان.
 * الوضع الافتراضي معاينة فقط. التنفيذ يتطلب --apply صراحة.
 *
 * أمثلة:
 *   node scripts/mark-legacy-cards.js card_analysis_result.csv
 *   node scripts/mark-legacy-cards.js card_analysis_result.xlsx --apply
 */
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function normalizeCard(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s-]+/g, "")
    .toUpperCase()
    .trim();
}

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const confirmProduction = argv.includes("--confirm-production");
  const fileArg = argv.find((arg) => !arg.startsWith("--")) ?? "card_analysis_result.csv";
  return { apply, confirmProduction, filePath: path.resolve(process.cwd(), fileArg) };
}

async function main() {
  const { apply, confirmProduction, filePath } = parseArgs(process.argv.slice(2));
  if (apply && process.env.NODE_ENV === "production" && (!confirmProduction || process.env.ALLOW_PRODUCTION_LEGACY_MARK !== "true")) {
    throw new Error("التنفيذ في الإنتاج يتطلب --confirm-production و ALLOW_PRODUCTION_LEGACY_MARK=true بعد أخذ نسخة احتياطية.");
  }
  if (!fs.existsSync(filePath)) throw new Error(`الملف غير موجود: ${filePath}`);

  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const header = normalizeCard(rows[0]?.[0]);
  const acceptedHeaders = new Set(["رقمالبطاقة", "رقمبطاقةالعائلة", "CARDNUMBER"]);
  if (!acceptedHeaders.has(header)) {
    throw new Error("عنوان العمود الأول غير معروف؛ يجب أن يكون رقم البطاقة أو رقم بطاقة العائلة أو Card Number");
  }
  const cards = [...new Set(rows.slice(1).map((row) => normalizeCard(row[0])).filter(Boolean))];
  if (cards.length === 0) throw new Error("لم يُعثر على أرقام بطاقات في العمود الأول بعد صف العناوين");

  const matches = await prisma.$queryRaw`
    SELECT id, name, card_number, is_legacy_card
    FROM "Beneficiary"
    WHERE deleted_at IS NULL
      AND REPLACE(REPLACE(UPPER(card_number), ' ', ''), '-', '') = ANY(${cards}::text[])
    ORDER BY card_number
  `;
  const matchedCards = new Set(matches.map((row) => normalizeCard(row.card_number)));
  const unmatched = cards.filter((card) => !matchedCards.has(card));
  const toUpdate = matches.filter((row) => !row.is_legacy_card);

  console.log(`الوضع: ${apply ? "تنفيذ" : "معاينة فقط"}`);
  console.log(`الملف: ${filePath}`);
  console.log(`بطاقات فريدة في الملف: ${cards.length}`);
  console.log(`سجلات نشطة مطابقة: ${matches.length}`);
  console.log(`سجلات تحتاج وسم: ${toUpdate.length}`);
  console.log(`بطاقات غير موجودة: ${unmatched.length}`);
  if (unmatched.length > 0) console.log("أول البطاقات غير الموجودة:", unmatched.slice(0, 20));

  if (!apply) {
    console.log("لم تتغير قاعدة البيانات. أضف --apply بعد مراجعة الأرقام أعلاه.");
    return;
  }
  if (toUpdate.length === 0) {
    console.log("لا توجد سجلات تحتاج تحديثاً.");
    return;
  }

  const ids = toUpdate.map((row) => row.id);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.beneficiary.updateMany({
      where: { id: { in: ids }, deleted_at: null, is_legacy_card: false },
      data: { is_legacy_card: true },
    });
    if (updated.count !== ids.length) {
      throw new Error(`تغيرت البيانات أثناء التنفيذ: المتوقع ${ids.length} والمحدث ${updated.count}`);
    }
    await tx.auditLog.create({
      data: {
        user: "script:mark-legacy-cards",
        action: "BULK_SET_LEGACY_CARD_FLAG",
        metadata: {
          source_file: path.basename(filePath),
          source_sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
          input_unique_cards: cards.length,
          matched_records: matches.length,
          updated_count: updated.count,
          unmatched_cards: unmatched,
          beneficiary_ids: ids,
          dry_run: false,
        },
      },
    });
  });
  console.log(`تم وسم ${ids.length} بطاقة قديمة وتسجيل العملية في سجل المراجعة.`);
}

main()
  .catch((error) => {
    console.error("فشل السكربت:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
