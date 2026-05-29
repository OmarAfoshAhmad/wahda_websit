import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { WAHDA_BANK_COMPANY_ID } from "@/lib/constants";

const NO_BATCH_FILTER_VALUE = "__NO_BATCH__";

type ExportRow = {
  card_number: string;
  beneficiary_name: string | null;
  birth_date: Date | null;
  city: string;
  batch_number: string | null;
  batches_count: number;
  batches_list: string | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  updated_at: Date | null;
};

function formatDate(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function formatDateTime(value: Date | null): string {
  if (!value) return "";
  return value.toISOString().replace("T", " ").slice(0, 19);
}

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  if (!session.is_admin) return NextResponse.json({ error: "ممنوع — للمدير فقط" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const cityFilter = (searchParams.get("city") ?? "").trim().slice(0, 80);
  const batchFilter = (searchParams.get("batch") ?? "").trim().slice(0, 80);
  const isNoBatchFilter = batchFilter === NO_BATCH_FILTER_VALUE;
  const onlyMultiBatch = searchParams.get("multi") === "1";
  const onlyMissingInSystem = searchParams.get("not_in_system") === "1" || searchParams.get("in_truth_not_in_system") === "1";
  const onlySimilarNumeric = searchParams.get("similar_numeric") === "1";
  const onlySimilarNameBirth = searchParams.get("similar_name_birth") === "1";
  const onlySimilarFamilySuffix = searchParams.get("similar_family_suffix") === "1";
  const onlyFamilyNumberingMismatch = searchParams.get("family_numbering_mismatch") === "1";
  const onlyInSystemNotInRegistry = searchParams.get("in_system_not_in_registry") === "1";
  const onlySimilarCases = searchParams.get("similar_cases") === "1";
  const onlyDemographicMismatch = searchParams.get("demographic_mismatch") === "1";
  const onlyMultiPersonCards = searchParams.get("multi_person_cards") === "1";
  const onlyLegacyHasBatch = searchParams.get("legacy_has_batch") === "1";
  const onlyLegacyNoBatch = searchParams.get("legacy_no_batch") === "1";
  const useSystemPrimaryRows = onlyInSystemNotInRegistry || onlyLegacyNoBatch || onlyFamilyNumberingMismatch;

  const sort = (searchParams.get("sort") ?? "").trim();
  let orderSql1 = Prisma.sql`ORDER BY city ASC, batch_number ASC NULLS LAST, card_number ASC`;
  if (sort === "birth_asc") {
    orderSql1 = Prisma.sql`ORDER BY birth_date ASC NULLS LAST, city ASC, batch_number ASC NULLS LAST, card_number ASC`;
  } else if (sort === "birth_desc") {
    orderSql1 = Prisma.sql`ORDER BY birth_date DESC NULLS LAST, city ASC, batch_number ASC NULLS LAST, card_number ASC`;
  }

  let orderSql2 = Prisma.sql`ORDER BY f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  if (sort === "birth_asc") {
    orderSql2 = Prisma.sql`ORDER BY f.birth_date ASC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  } else if (sort === "birth_desc") {
    orderSql2 = Prisma.sql`ORDER BY f.birth_date DESC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  }

  const rows = useSystemPrimaryRows
    ? await prisma.$queryRaw<ExportRow[]>`
        WITH filtered AS (
          SELECT
            b.card_number,
            b.name AS beneficiary_name,
            b.birth_date,
            COALESCE(b.city, '—') AS city,
            b.batch_number,
            0::int AS batches_count,
            CAST(NULL AS varchar) AS batches_list,
            'المنظومة' AS source_file,
            CAST(NULL AS varchar) AS source_sheet,
            CAST(NULL AS integer) AS source_row,
            b.created_at AS updated_at
          FROM "Beneficiary" b
          WHERE b.deleted_at IS NULL
            AND (${cityFilter} = '' OR COALESCE(b.city, '—') = ${cityFilter})
            AND (
              (${batchFilter} = '')
              OR (${isNoBatchFilter} = true AND (b.batch_number IS NULL OR BTRIM(b.batch_number) = ''))
              OR (${isNoBatchFilter} = false AND b.batch_number = ${batchFilter})
            )
            AND (
              ${onlyInSystemNotInRegistry} = false
              OR (b."company_id" = ${WAHDA_BANK_COMPANY_ID} OR b."company_id" IS NULL)
            )
            AND (
              ${query} = ''
              OR b.card_number ILIKE ${`%${query}%`}
              OR b.name ILIKE ${`%${query}%`}
            )
            AND (
              ${onlyInSystemNotInRegistry} = false
              OR REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
                SELECT REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                FROM "CardIssuanceRegistryAll"
                WHERE card_number_upper IS NOT NULL
              )
            )
            AND (
              ${onlyLegacyNoBatch} = false
              OR (
                b.is_legacy_card = true
                AND (b.batch_number IS NULL OR BTRIM(b.batch_number) = '')
              )
            )
            AND (
              ${onlyLegacyHasBatch} = false
              OR (
                b.is_legacy_card = true
                AND b.batch_number IS NOT NULL AND BTRIM(b.batch_number) <> ''
              )
            )
            AND (
              ${onlyMultiPersonCards} = false
              OR (
                b.birth_date IS NOT NULL
                AND UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) || '::' || b.birth_date::date::text IN (
                  SELECT
                    UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) || '::' || b2.birth_date::date::text
                  FROM "Beneficiary" b2
                  WHERE b2.deleted_at IS NULL
                    AND b2.birth_date IS NOT NULL
                  GROUP BY
                    UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')),
                    b2.birth_date::date
                  HAVING COUNT(DISTINCT REGEXP_REPLACE(UPPER(BTRIM(b2.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')) > 1
                )
              )
            )
            AND (
              ${onlyFamilyNumberingMismatch} = false
              OR EXISTS (
                SELECT 1
                FROM "CardIssuanceRegistryAll" t
                WHERE b.birth_date IS NOT NULL
                  AND t.birth_date IS NOT NULL
                  AND t.birth_date::date = b.birth_date::date
                  AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                      UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g'))
                  AND COALESCE(
                    SUBSTRING(COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')) FROM '^(WAB2025[0-9]+)'),
                    COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'))
                  ) = COALESCE(
                    SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
                    REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  )
                  AND COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')) <>
                      REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              )
            )
            AND (
              ${onlySimilarCases} = false
              OR ${onlyInSystemNotInRegistry} = false
              OR (
                ${onlySimilarNumeric} = false
                AND ${onlySimilarNameBirth} = false
                AND ${onlySimilarFamilySuffix} = false
                AND (
                  EXISTS (
                    SELECT 1
                    FROM "CardIssuanceRegistryAll" t
                    WHERE t.canonical_card = REGEXP_REPLACE(
                      REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'),
                      '^(WAB2025[0-9]+)1$',
                      '\\1'
                    )
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM "CardIssuanceRegistryAll" t
                    WHERE b.birth_date IS NOT NULL
                      AND t.birth_date IS NOT NULL
                      AND UPPER(BTRIM(COALESCE(t.beneficiary_name, ''))) = UPPER(BTRIM(b.name))
                      AND t.birth_date::date = b.birth_date::date
                      AND t.canonical_card <> REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  )
                  OR EXISTS (
                    SELECT 1
                    FROM "CardIssuanceRegistryAll" t
                    WHERE t.canonical_card = (
                      CASE
                        WHEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') ~ '^WAB2025[0-9]+[FMW]1$'
                          THEN REGEXP_REPLACE(
                            REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'),
                            '^(WAB2025[0-9]+[FMW])1$',
                            '\\1'
                          )
                        WHEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') ~ '^WAB2025[0-9]+[FMW]$'
                          THEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') || '1'
                        ELSE NULL
                      END
                    )
                  )
                )
              )
              OR (
                ${onlySimilarNumeric} = true
                AND EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" t
                  WHERE t.canonical_card = REGEXP_REPLACE(
                    REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'),
                    '^(WAB2025[0-9]+)1$',
                    '\\1'
                  )
                )
              )
              OR (
                ${onlySimilarNameBirth} = true
                AND EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" t
                  WHERE b.birth_date IS NOT NULL
                    AND t.birth_date IS NOT NULL
                    AND UPPER(BTRIM(COALESCE(t.beneficiary_name, ''))) = UPPER(BTRIM(b.name))
                    AND t.birth_date::date = b.birth_date::date
                    AND t.canonical_card <> REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                )
              )
              OR (
                ${onlySimilarFamilySuffix} = true
                AND EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" t
                  WHERE t.canonical_card = (
                    CASE
                      WHEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') ~ '^WAB2025[0-9]+[FMW]1$'
                        THEN REGEXP_REPLACE(
                          REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'),
                          '^(WAB2025[0-9]+[FMW])1$',
                          '\\1'
                        )
                      WHEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') ~ '^WAB2025[0-9]+[FMW]$'
                        THEN REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') || '1'
                      ELSE NULL
                    END
                  )
                )
              )
            )
        )
        SELECT
          card_number,
          beneficiary_name,
          birth_date,
          city,
          batch_number,
          batches_count,
          batches_list,
          source_file,
          source_sheet,
          source_row,
          updated_at
        FROM filtered
        ${orderSql1}
      `
    : await prisma.$queryRaw<ExportRow[]>`
        WITH filtered AS (
          SELECT
            card_number,
            card_number_upper,
            beneficiary_name,
            birth_date,
            city,
            batch_number,
            source_file,
            source_sheet,
            source_row,
            updated_at
          FROM "CardIssuanceRegistryAll"
          WHERE (${cityFilter} = '' OR city = ${cityFilter})
            AND (
              (${batchFilter} = '')
              OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
              OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
            )
            AND (
              ${query} = ''
              OR card_number ILIKE ${`%${query}%`}
              OR COALESCE(beneficiary_name, '') ILIKE ${`%${query}%`}
              OR COALESCE(source_file, '') ILIKE ${`%${query}%`}
            )
            AND (
              ${onlyMissingInSystem} = false
              OR REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') NOT IN (
                SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                FROM "Beneficiary"
                WHERE deleted_at IS NULL
              )
              AND (
                birth_date IS NULL
                OR NOT EXISTS (
                  SELECT 1
                  FROM "Beneficiary" b2
                  WHERE b2.deleted_at IS NULL
                    AND b2.birth_date IS NOT NULL
                    AND b2.birth_date::date = birth_date::date
                    AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) =
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
                )
              )
            )
            AND (
              ${onlyDemographicMismatch} = false
              OR EXISTS (
                SELECT 1
                FROM "Beneficiary" b
                WHERE b.deleted_at IS NULL
                  AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                      REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  AND (
                    UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
                    OR (b.birth_date IS NOT NULL AND birth_date IS NOT NULL AND b.birth_date::date <> birth_date::date)
                    OR (b.birth_date IS NULL AND birth_date IS NOT NULL)
                    OR (b.birth_date IS NOT NULL AND birth_date IS NULL)
                  )
              )
            )
            AND (
              ${onlyLegacyHasBatch} = false
              OR (
                (batch_number IS NOT NULL AND BTRIM(batch_number) <> '')
                AND REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (
                  SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  FROM "Beneficiary"
                  WHERE deleted_at IS NULL AND is_legacy_card = true
                )
              )
            )
            AND (
              ${onlyLegacyNoBatch} = false
              OR (
                (batch_number IS NULL OR BTRIM(batch_number) = '')
                AND REGEXP_REPLACE(card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') IN (
                  SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  FROM "Beneficiary"
                  WHERE deleted_at IS NULL AND is_legacy_card = true
                )
              )
            )
            AND (
              ${onlyMultiPersonCards} = false
              OR (
                birth_date IS NOT NULL
                AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || birth_date::date::text IN (
                  SELECT
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                  FROM "CardIssuanceRegistryAll" t2
                  WHERE t2.birth_date IS NOT NULL
                  GROUP BY
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                    t2.birth_date::date
                  HAVING COUNT(DISTINCT COALESCE(t2.canonical_card, REGEXP_REPLACE(t2.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'))) > 1
                )
              )
            )
        ),
        stats AS (
          SELECT
            card_number_upper,
            COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__'))::int AS batches_count,
            ARRAY_TO_STRING(ARRAY_AGG(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), 'بدون دفعة') ORDER BY COALESCE(NULLIF(BTRIM(batch_number), ''), 'بدون دفعة')), '، ') AS batches_list
          FROM "CardIssuanceRegistryAll"
          GROUP BY card_number_upper
        )
        SELECT
          f.card_number,
          f.beneficiary_name,
          f.birth_date,
          f.city,
          f.batch_number,
          s.batches_count,
          s.batches_list,
          f.source_file,
          f.source_sheet,
          f.source_row,
          f.updated_at
        FROM filtered f
        JOIN stats s ON s.card_number_upper = f.card_number_upper
        WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
        ${orderSql2}
      `;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("نتائج الفلتر");
  sheet.columns = [
    { header: "رقم البطاقة", key: "card_number", width: 24 },
    { header: "الاسم", key: "beneficiary_name", width: 34 },
    { header: "الميلاد", key: "birth_date", width: 14 },
    { header: "المدينة", key: "city", width: 14 },
    { header: "الدفعة", key: "batch_number", width: 12 },
    { header: "عدد الدفعات", key: "batches_count", width: 14 },
    { header: "كل الدفعات", key: "batches_list", width: 24 },
    { header: "الملف", key: "source_file", width: 28 },
    { header: "الورقة", key: "source_sheet", width: 14 },
    { header: "الصف", key: "source_row", width: 10 },
    { header: "آخر تحديث", key: "updated_at", width: 22 },
  ];

  for (const row of rows) {
    sheet.addRow({
      card_number: row.card_number,
      beneficiary_name: row.beneficiary_name ?? "",
      birth_date: formatDate(row.birth_date),
      city: row.city ?? "",
      batch_number: row.batch_number ?? "",
      batches_count: Number(row.batches_count ?? 0),
      batches_list: row.batches_list ?? "",
      source_file: row.source_file ?? "",
      source_sheet: row.source_sheet ?? "",
      source_row: row.source_row ?? "",
      updated_at: formatDateTime(row.updated_at),
    });
  }

  const meta = workbook.addWorksheet("بيانات التصفية");
  meta.columns = [
    { header: "المعامل", key: "key", width: 34 },
    { header: "القيمة", key: "value", width: 50 },
  ];
  const filtersSummary: Array<{ key: string; value: string }> = [
    { key: "مصدر النتائج الأساسي", value: useSystemPrimaryRows ? "المنظومة" : "جدول الحقيقة" },
    { key: "بحث", value: query || "—" },
    { key: "المدينة", value: cityFilter || "—" },
    { key: "الدفعة", value: batchFilter || "—" },
    { key: "الترتيب", value: sort === "birth_asc" ? "المواليد تصاعدياً" : sort === "birth_desc" ? "المواليد تنازلياً" : "الافتراضي" },
    { key: "موجود بأكثر من دفعة", value: onlyMultiBatch ? "نعم" : "لا" },
    { key: "الموجودين في جدول الحقيقة وغير موجودين في المنظومة", value: onlyMissingInSystem ? "نعم" : "لا" },
    { key: "الموجودين في المنظومة وغير موجودين في جدول الحقيقة", value: onlyInSystemNotInRegistry ? "نعم" : "لا" },
    { key: "حالات التقارب فقط", value: onlySimilarCases ? "نعم" : "لا" },
    { key: "تقارب رقمي فقط (+1)", value: onlySimilarNumeric ? "نعم" : "لا" },
    { key: "تقارب الاسم + الميلاد فقط", value: onlySimilarNameBirth ? "نعم" : "لا" },
    { key: "تقارب عائلي فقط (F/F1 - M/M1 - W/W1)", value: onlySimilarFamilySuffix ? "نعم" : "لا" },
    { key: "اختلاف ترقيم عائلي (نفس الشخص)", value: onlyFamilyNumberingMismatch ? "نعم" : "لا" },
    { key: "تضارب البيانات الديموغرافية (الاسم/تاريخ الميلاد)", value: onlyDemographicMismatch ? "نعم" : "لا" },
    { key: "بطاقات متعددة الترميز لنفس الشخص", value: onlyMultiPersonCards ? "نعم" : "لا" },
    { key: "البطاقات القديمة التي لها دفعة", value: onlyLegacyHasBatch ? "نعم" : "لا" },
    { key: "البطاقات القديمة ليس لها دفعة", value: onlyLegacyNoBatch ? "نعم" : "لا" },
    { key: "عدد النتائج", value: rows.length.toLocaleString("ar-LY") },
  ];
  for (const item of filtersSummary) meta.addRow(item);

  const buffer = await workbook.xlsx.writeBuffer();
  const fileDate = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const fileName = `truth-registry-filter-results-${fileDate}.xlsx`;

  return new NextResponse(buffer as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
