import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Button, Input } from "@/components/ui";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { TruthRegistryImport } from "@/components/admin/truth-registry-import";
import { TruthRegistryTable } from "@/components/admin/truth-registry-table";
import { Import, Download } from "lucide-react";

type RegistryRow = {
  id: string;
  card_number: string;
  card_number_upper: string;
  beneficiary_name: string | null;
  birth_date: Date | null;
  city: string;
  batch_number: string | null;
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  updated_at: Date;
  batches_count: number;
  batches_list: string | null;
};

type CountRow = { count: bigint | number | string };

type CityRow = { city: string };

type BatchRow = { batch_number: string | null; count: bigint | number | string };

const NO_BATCH_FILTER_VALUE = "__NO_BATCH__";

export const dynamic = "force-dynamic";

export default async function TruthRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    city?: string;
    batch?: string;
    multi?: string;
    page?: string;
    not_in_system?: string;
    in_system_not_in_registry?: string;
    legacy_has_batch?: string;
    legacy_no_batch?: string;
    sort?: string;
    family_numbering_mismatch?: string;
    multi_person_cards?: string;
    demographic_mismatch?: string;
    filter_type?: string;
  }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const {
    q,
    city,
    batch,
    multi,
    page,
    not_in_system,
    in_system_not_in_registry,
    legacy_has_batch,
    legacy_no_batch,
    sort,
    family_numbering_mismatch,
    multi_person_cards,
    demographic_mismatch,
    filter_type,
  } = await searchParams;

  const query = (q ?? "").trim().slice(0, 100);
  const cityFilter = (city ?? "").trim().slice(0, 80);
  const batchFilter = (batch ?? "").trim().slice(0, 80);
  const isNoBatchFilter = batchFilter === NO_BATCH_FILTER_VALUE;
  const filterType = (filter_type ?? "").trim();
  const onlyMultiBatch = filterType === "multi" || multi === "1";
  const onlyMissingInSystem = filterType === "not_in_system" || not_in_system === "1";
  const onlyInSystemNotInRegistry = filterType === "in_system_not_in_registry" || in_system_not_in_registry === "1";
  const onlyLegacyHasBatch = filterType === "legacy_has_batch" || legacy_has_batch === "1";
  const onlyLegacyNoBatch = filterType === "legacy_no_batch" || legacy_no_batch === "1";
  const onlyFamilyNumberingMismatch = filterType === "family_numbering_mismatch" || family_numbering_mismatch === "1";
  const onlyMultiPersonCards = filterType === "multi_person_cards" || multi_person_cards === "1";
  const onlyDemographicMismatch = filterType === "demographic_mismatch" || demographic_mismatch === "1";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const pageSize = 100;

  const sortFilter = (sort ?? "").trim();
  let orderSql1 = Prisma.sql`ORDER BY city ASC, batch_number ASC NULLS LAST, card_number_upper ASC`;
  if (sortFilter === "birth_asc") {
    orderSql1 = Prisma.sql`ORDER BY birth_date ASC NULLS LAST, city ASC, batch_number ASC NULLS LAST, card_number_upper ASC`;
  } else if (sortFilter === "birth_desc") {
    orderSql1 = Prisma.sql`ORDER BY birth_date DESC NULLS LAST, city ASC, batch_number ASC NULLS LAST, card_number_upper ASC`;
  }

  let orderSql2 = Prisma.sql`ORDER BY f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  if (sortFilter === "birth_asc") {
    orderSql2 = Prisma.sql`ORDER BY f.birth_date ASC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  } else if (sortFilter === "birth_desc") {
    orderSql2 = Prisma.sql`ORDER BY f.birth_date DESC NULLS LAST, f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST`;
  }

  const rowsSql = (onlyInSystemNotInRegistry || onlyLegacyNoBatch || onlyFamilyNumberingMismatch)
    ? prisma.$queryRaw<RegistryRow[]>`
        WITH filtered AS (
          SELECT
            id,
            card_number,
            UPPER(BTRIM(card_number)) AS card_number_upper,
            name AS beneficiary_name,
            birth_date,
            COALESCE(city, '—') AS city,
            batch_number,
            'المنظومة' AS source_file,
            CAST(NULL AS varchar) AS source_sheet,
            CAST(NULL AS integer) AS source_row,
            created_at AS updated_at
          FROM "Beneficiary"
          WHERE deleted_at IS NULL
            ${query ? Prisma.sql`AND (card_number ILIKE ${'%' + query + '%'} OR name ILIKE ${'%' + query + '%'})` : Prisma.empty}
            ${onlyInSystemNotInRegistry ? Prisma.sql`AND (NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" __t_insys
                  WHERE __t_insys.canonical_card =
                        REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                )
                AND (
                  "Beneficiary".birth_date IS NULL
                  OR NOT EXISTS (
                    SELECT 1
                    FROM "CardIssuanceRegistryAll" t2
                    WHERE t2.birth_date IS NOT NULL
                      AND t2.birth_date::date = "Beneficiary".birth_date::date
                      AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                          UPPER(REGEXP_REPLACE(BTRIM("Beneficiary".name), '\\s+', ' ', 'g'))
                  )
                )
              )` : Prisma.empty}
            ${onlyLegacyNoBatch ? Prisma.sql`AND (is_legacy_card = true
                AND (batch_number IS NULL OR BTRIM(batch_number) = '')
              )` : Prisma.empty}
            ${onlyLegacyHasBatch ? Prisma.sql`AND ((
                is_legacy_card = true
                AND batch_number IS NOT NULL AND BTRIM(batch_number) <> ''
              ))` : Prisma.empty}
            ${onlyFamilyNumberingMismatch ? Prisma.sql`AND (EXISTS (
                SELECT 1
                FROM "CardIssuanceRegistryAll" t
                WHERE UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                      UPPER(REGEXP_REPLACE(BTRIM("Beneficiary".name), '\\s+', ' ', 'g'))
                  AND (
                    ("Beneficiary".birth_date IS NOT NULL AND t.birth_date IS NOT NULL AND t.birth_date::date = "Beneficiary".birth_date::date)
                    OR
                    ("Beneficiary".birth_date IS NULL)
                  )
                  AND COALESCE(
                    SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
                    t.canonical_card
                  ) = COALESCE(
                    SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
                    REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                  )
                  AND t.canonical_card <>
                      REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
              ))` : Prisma.empty}
        )
        SELECT
          id,
          card_number,
          card_number_upper,
          beneficiary_name,
          birth_date,
          city,
          batch_number,
          source_file,
          source_sheet,
          source_row,
          updated_at,
          0::int AS batches_count,
          CAST(NULL AS varchar) AS batches_list,
          CAST(NULL AS varchar) AS similar_truth_card,
          CAST(NULL AS varchar) AS similar_truth_name,
          CAST(NULL AS varchar) AS similar_truth_batch,
          CAST(NULL AS timestamp) AS similar_truth_birth,
          CAST(NULL AS varchar) AS similar_reason
        FROM filtered
        ${orderSql1}
        LIMIT ${pageSize}
        OFFSET ${(pageNumber - 1) * pageSize}
      `
        : (query
        ? prisma.$queryRaw<RegistryRow[]>`
            WITH filtered AS (
              SELECT
                f.id,
                f.card_number,
                f.card_number_upper,
                f.beneficiary_name,
                f.birth_date,
                f.city,
                f.batch_number,
                f.source_file,
                f.source_sheet,
                f.source_row,
                f.updated_at,
                b.card_number AS similar_truth_card,
                b.name AS similar_truth_name,
                b.batch_number AS similar_truth_batch,
                b.birth_date AS similar_truth_birth,
                CASE
                  WHEN b.id IS NOT NULL AND (
                    UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                    OR (b.birth_date IS NOT NULL AND f.birth_date IS NOT NULL AND b.birth_date::date <> f.birth_date::date)
                    OR (b.birth_date IS NULL AND f.birth_date IS NOT NULL)
                    OR (b.birth_date IS NOT NULL AND f.birth_date IS NULL)
                  ) THEN 'تضارب ديموغرافي (المنظومة)'
                  ELSE CAST(NULL AS varchar)
                END AS similar_reason
              FROM "CardIssuanceRegistryAll" f
              LEFT JOIN "Beneficiary" b ON b.deleted_at IS NULL
                AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                    f.canonical_card
              WHERE 1=1 ${cityFilter ? Prisma.sql`AND f.city = ${cityFilter}` : Prisma.empty}
                ${isNoBatchFilter ? Prisma.sql`AND (f.batch_number IS NULL OR BTRIM(f.batch_number) = '')` : (batchFilter ? Prisma.sql`AND f.batch_number = ${batchFilter}` : Prisma.empty)}
                AND (
                  f.card_number ILIKE ${`%${query}%`}
                  OR COALESCE(f.beneficiary_name, '') ILIKE ${`%${query}%`}
                  OR COALESCE(f.source_file, '') ILIKE ${`%${query}%`}
                )
                ${onlyMissingInSystem ? Prisma.sql`AND (NOT EXISTS (
                    SELECT 1
                    FROM "Beneficiary" __b_missing
                    WHERE __b_missing.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          f.canonical_card
                  )
                    AND (
                      f.birth_date IS NULL
                      OR NOT EXISTS (
                        SELECT 1
                        FROM "Beneficiary" b2
                        WHERE b2.deleted_at IS NULL
                          AND b2.birth_date IS NOT NULL
                          AND b2.birth_date::date = f.birth_date::date
                          AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) =
                              UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                      )
                    )
                  )` : Prisma.empty}
                ${onlyDemographicMismatch ? Prisma.sql`AND (EXISTS (
                    SELECT 1
                    FROM "Beneficiary" b
                    WHERE b.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          f.canonical_card
                      AND (
                        UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                        OR (b.birth_date IS NOT NULL AND f.birth_date IS NOT NULL AND b.birth_date::date <> f.birth_date::date)
                        OR (b.birth_date IS NULL AND f.birth_date IS NOT NULL)
                        OR (b.birth_date IS NOT NULL AND f.birth_date IS NULL)
                      )
                  ))` : Prisma.empty}
                ${onlyLegacyHasBatch ? Prisma.sql`AND ((
                    (f.batch_number IS NOT NULL AND BTRIM(f.batch_number) <> '')
                    AND f.canonical_card IN (
                      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                      FROM "Beneficiary"
                      WHERE deleted_at IS NULL AND is_legacy_card = true
                    )
                  ))` : Prisma.empty}
                ${onlyLegacyNoBatch ? Prisma.sql`AND ((f.batch_number IS NULL OR BTRIM(f.batch_number) = '')
                    AND f.canonical_card IN (
                      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                      FROM "Beneficiary"
                      WHERE deleted_at IS NULL AND is_legacy_card = true
                    )
                  ))` : Prisma.empty}
                ${onlyMultiPersonCards ? Prisma.sql`AND ((
                    f.birth_date IS NOT NULL
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || f.birth_date::date::text IN (
                      SELECT
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                      FROM "CardIssuanceRegistryAll" t2
                      WHERE t2.birth_date IS NOT NULL
                      GROUP BY
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                        t2.birth_date::date
                      HAVING COUNT(DISTINCT t2.canonical_card) > 1
                    )
                  ))` : Prisma.empty}
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
              f.id,
              f.card_number,
              f.card_number_upper,
              f.beneficiary_name,
              f.birth_date,
              f.city,
              f.batch_number,
              f.source_file,
              f.source_sheet,
              f.source_row,
              f.updated_at,
              s.batches_count,
              s.batches_list,
              f.similar_truth_card,
              f.similar_truth_name,
              f.similar_truth_batch,
              f.similar_truth_birth,
              f.similar_reason
            FROM filtered f
            JOIN stats s ON s.card_number_upper = f.card_number_upper
            WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
            ${orderSql2}
            LIMIT ${pageSize}
            `
        : prisma.$queryRaw<RegistryRow[]>`
            WITH filtered AS (
              SELECT
                f.id,
                f.card_number,
                f.card_number_upper,
                f.beneficiary_name,
                f.birth_date,
                f.city,
                f.batch_number,
                f.source_file,
                f.source_sheet,
                f.source_row,
                f.updated_at,
                b.card_number AS similar_truth_card,
                b.name AS similar_truth_name,
                b.batch_number AS similar_truth_batch,
                b.birth_date AS similar_truth_birth,
                CASE
                  WHEN b.id IS NOT NULL AND (
                    UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                    UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                    OR (b.birth_date IS NOT NULL AND f.birth_date IS NOT NULL AND b.birth_date::date <> f.birth_date::date)
                    OR (b.birth_date IS NULL AND f.birth_date IS NOT NULL)
                    OR (b.birth_date IS NOT NULL AND f.birth_date IS NULL)
                  ) THEN 'تضارب ديموغرافي (المنظومة)'
                  ELSE CAST(NULL AS varchar)
                END AS similar_reason
              FROM "CardIssuanceRegistryAll" f
              LEFT JOIN "Beneficiary" b ON b.deleted_at IS NULL
                AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                    f.canonical_card
              WHERE 1=1 ${cityFilter ? Prisma.sql`AND f.city = ${cityFilter}` : Prisma.empty}
                ${isNoBatchFilter ? Prisma.sql`AND (f.batch_number IS NULL OR BTRIM(f.batch_number) = '')` : (batchFilter ? Prisma.sql`AND f.batch_number = ${batchFilter}` : Prisma.empty)}
                ${onlyMissingInSystem ? Prisma.sql`AND (NOT EXISTS (
                    SELECT 1
                    FROM "Beneficiary" __b_missing
                    WHERE __b_missing.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          f.canonical_card
                  )
                    AND (
                      f.birth_date IS NULL
                      OR NOT EXISTS (
                        SELECT 1
                        FROM "Beneficiary" b2
                        WHERE b2.deleted_at IS NULL
                          AND b2.birth_date IS NOT NULL
                          AND b2.birth_date::date = f.birth_date::date
                          AND UPPER(REGEXP_REPLACE(BTRIM(b2.name), '\\s+', ' ', 'g')) =
                              UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                      )
                    )
                  )` : Prisma.empty}
                ${onlyDemographicMismatch ? Prisma.sql`AND (EXISTS (
                    SELECT 1
                    FROM "Beneficiary" b
                    WHERE b.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          f.canonical_card
                      AND (
                        UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g'))
                        OR (b.birth_date IS NOT NULL AND f.birth_date IS NOT NULL AND b.birth_date::date <> f.birth_date::date)
                        OR (b.birth_date IS NULL AND f.birth_date IS NOT NULL)
                        OR (b.birth_date IS NOT NULL AND f.birth_date IS NULL)
                      )
                  ))` : Prisma.empty}
                ${onlyLegacyHasBatch ? Prisma.sql`AND ((
                    (f.batch_number IS NOT NULL AND BTRIM(f.batch_number) <> '')
                    AND f.canonical_card IN (
                      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                      FROM "Beneficiary"
                      WHERE deleted_at IS NULL AND is_legacy_card = true
                    )
                  ))` : Prisma.empty}
                ${onlyLegacyNoBatch ? Prisma.sql`AND ((f.batch_number IS NULL OR BTRIM(f.batch_number) = '')
                    AND f.canonical_card IN (
                      SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                      FROM "Beneficiary"
                      WHERE deleted_at IS NULL AND is_legacy_card = true
                    )
                  )` : Prisma.empty}
                ${onlyMultiPersonCards ? Prisma.sql`AND ((
                    f.birth_date IS NOT NULL
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(f.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || f.birth_date::date::text IN (
                      SELECT
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                      FROM "CardIssuanceRegistryAll" t2
                      WHERE t2.birth_date IS NOT NULL
                      GROUP BY
                        UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                        t2.birth_date::date
                      HAVING COUNT(DISTINCT t2.canonical_card) > 1
                    )
                  ))` : Prisma.empty}
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
              f.id,
              f.card_number,
              f.card_number_upper,
              f.beneficiary_name,
              f.birth_date,
              f.city,
              f.batch_number,
              f.source_file,
              f.source_sheet,
              f.source_row,
              f.updated_at,
              s.batches_count,
              s.batches_list,
              f.similar_truth_card,
              f.similar_truth_name,
              f.similar_truth_batch,
              f.similar_truth_birth,
              f.similar_reason
            FROM filtered f
            JOIN stats s ON s.card_number_upper = f.card_number_upper
            WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
            ${orderSql2}
            LIMIT ${pageSize}
            OFFSET ${(pageNumber - 1) * pageSize}
          `);

  const countSql = (onlyInSystemNotInRegistry || onlyLegacyNoBatch || onlyFamilyNumberingMismatch)
    ? prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "Beneficiary"
        WHERE deleted_at IS NULL
          ${query ? Prisma.sql`AND (card_number ILIKE ${'%' + query + '%'} OR name ILIKE ${'%' + query + '%'})` : Prisma.empty}
          ${onlyInSystemNotInRegistry ? Prisma.sql`AND (NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" __t_insys
                  WHERE __t_insys.canonical_card =
                        REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                )
              AND (
                "Beneficiary".birth_date IS NULL
                OR NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" t2
                  WHERE t2.birth_date IS NOT NULL
                    AND t2.birth_date::date = "Beneficiary".birth_date::date
                    AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                        UPPER(REGEXP_REPLACE(BTRIM("Beneficiary".name), '\\s+', ' ', 'g'))
                )
              )
            )` : Prisma.empty}
          ${onlyLegacyNoBatch ? Prisma.sql`AND (is_legacy_card = true
              AND (batch_number IS NULL OR BTRIM(batch_number) = '')
            )` : Prisma.empty}
          ${onlyLegacyHasBatch ? Prisma.sql`AND ((
              is_legacy_card = true
              AND batch_number IS NOT NULL AND BTRIM(batch_number) <> ''
            ))` : Prisma.empty}
          ${onlyFamilyNumberingMismatch ? Prisma.sql`AND (EXISTS (
              SELECT 1
              FROM "CardIssuanceRegistryAll" t
              WHERE UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t.beneficiary_name, '')), '\\s+', ' ', 'g')) =
                    UPPER(REGEXP_REPLACE(BTRIM("Beneficiary".name), '\\s+', ' ', 'g'))
                AND (
                  ("Beneficiary".birth_date IS NOT NULL AND t.birth_date IS NOT NULL AND t.birth_date::date = "Beneficiary".birth_date::date)
                  OR
                  ("Beneficiary".birth_date IS NULL)
                )
                AND COALESCE(
                  SUBSTRING(t.canonical_card FROM '^(WAB2025[0-9]+)'),
                  t.canonical_card
                ) = COALESCE(
                  SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
                  REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                )
                AND t.canonical_card <>
                    REGEXP_REPLACE(UPPER(BTRIM("Beneficiary".card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
            ))` : Prisma.empty}
      `
    : (query
        ? prisma.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count
            FROM "CardIssuanceRegistryAll"
            WHERE 1=1 ${cityFilter ? Prisma.sql`AND city = ${cityFilter}` : Prisma.empty}
              ${isNoBatchFilter ? Prisma.sql`AND (batch_number IS NULL OR BTRIM(batch_number) = '')` : (batchFilter ? Prisma.sql`AND batch_number = ${batchFilter}` : Prisma.empty)}
              AND (
                card_number ILIKE ${`%${query}%`}
                OR COALESCE(beneficiary_name, '') ILIKE ${`%${query}%`}
                OR COALESCE(source_file, '') ILIKE ${`%${query}%`}
              )
              ${onlyMissingInSystem ? Prisma.sql`AND (NOT EXISTS (
                    SELECT 1
                    FROM "Beneficiary" __b_missing
                    WHERE __b_missing.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          canonical_card
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
                )` : Prisma.empty}
              ${onlyDemographicMismatch ? Prisma.sql`AND (EXISTS (
                  SELECT 1
                  FROM "Beneficiary" b
                  WHERE b.deleted_at IS NULL
                    AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                        canonical_card
                    AND (
                      UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
                      OR (b.birth_date IS NOT NULL AND birth_date IS NOT NULL AND b.birth_date::date <> birth_date::date)
                      OR (b.birth_date IS NULL AND birth_date IS NOT NULL)
                      OR (b.birth_date IS NOT NULL AND birth_date IS NULL)
                    )
                ))` : Prisma.empty}
              ${onlyLegacyHasBatch ? Prisma.sql`AND ((
                  (batch_number IS NOT NULL AND BTRIM(batch_number) <> '')
                  AND canonical_card IN (
                    SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                    FROM "Beneficiary"
                    WHERE deleted_at IS NULL AND is_legacy_card = true
                  )
                ))` : Prisma.empty}
              ${onlyLegacyNoBatch ? Prisma.sql`AND ((batch_number IS NULL OR BTRIM(batch_number) = '')
                  AND canonical_card IN (
                    SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                    FROM "Beneficiary"
                    WHERE deleted_at IS NULL AND is_legacy_card = true
                  )
                ))` : Prisma.empty}
              ${onlyMultiBatch ? Prisma.sql`AND (card_number_upper IN (
                  SELECT card_number_upper
                  FROM "CardIssuanceRegistryAll"
                  GROUP BY card_number_upper
                  HAVING COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__')) > 1
                ))` : Prisma.empty}
              ${onlyMultiPersonCards ? Prisma.sql`AND ((
                  birth_date IS NOT NULL
                  AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || birth_date::date::text IN (
                    SELECT
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                    FROM "CardIssuanceRegistryAll" t2
                    WHERE t2.birth_date IS NOT NULL
                    GROUP BY
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                      t2.birth_date::date
                    HAVING COUNT(DISTINCT t2.canonical_card) > 1
                  )
                ))` : Prisma.empty}
          `
        : prisma.$queryRaw<CountRow[]>`
            SELECT COUNT(*)::bigint AS count
            FROM "CardIssuanceRegistryAll"
            WHERE 1=1 ${cityFilter ? Prisma.sql`AND city = ${cityFilter}` : Prisma.empty}
              ${isNoBatchFilter ? Prisma.sql`AND (batch_number IS NULL OR BTRIM(batch_number) = '')` : (batchFilter ? Prisma.sql`AND batch_number = ${batchFilter}` : Prisma.empty)}
              ${onlyMissingInSystem ? Prisma.sql`AND (NOT EXISTS (
                    SELECT 1
                    FROM "Beneficiary" __b_missing
                    WHERE __b_missing.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                          canonical_card
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
                )` : Prisma.empty}
              ${onlyDemographicMismatch ? Prisma.sql`AND (EXISTS (
                  SELECT 1
                  FROM "Beneficiary" b
                  WHERE b.deleted_at IS NULL
                    AND REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') =
                        canonical_card
                    AND (
                      UPPER(REGEXP_REPLACE(BTRIM(b.name), '\\s+', ' ', 'g')) <>
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g'))
                      OR (b.birth_date IS NOT NULL AND birth_date IS NOT NULL AND b.birth_date::date <> birth_date::date)
                      OR (b.birth_date IS NULL AND birth_date IS NOT NULL)
                      OR (b.birth_date IS NOT NULL AND birth_date IS NULL)
                    )
                ))` : Prisma.empty}
              ${onlyLegacyHasBatch ? Prisma.sql`AND ((
                  (batch_number IS NOT NULL AND BTRIM(batch_number) <> '')
                  AND canonical_card IN (
                    SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                    FROM "Beneficiary"
                    WHERE deleted_at IS NULL AND is_legacy_card = true
                  )
                ))` : Prisma.empty}
              ${onlyLegacyNoBatch ? Prisma.sql`AND ((batch_number IS NULL OR BTRIM(batch_number) = '')
                  AND canonical_card IN (
                    SELECT REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
                    FROM "Beneficiary"
                    WHERE deleted_at IS NULL AND is_legacy_card = true
                  )
                )` : Prisma.empty}
              ${onlyMultiBatch ? Prisma.sql`AND (card_number_upper IN (
                  SELECT card_number_upper
                  FROM "CardIssuanceRegistryAll"
                  GROUP BY card_number_upper
                  HAVING COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__')) > 1
                ))` : Prisma.empty}
              ${onlyMultiPersonCards ? Prisma.sql`AND ((
                  birth_date IS NOT NULL
                  AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || birth_date::date::text IN (
                    SELECT
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')) || '::' || t2.birth_date::date::text
                    FROM "CardIssuanceRegistryAll" t2
                    WHERE t2.birth_date IS NOT NULL
                    GROUP BY
                      UPPER(REGEXP_REPLACE(BTRIM(COALESCE(t2.beneficiary_name, '')), '\\s+', ' ', 'g')),
                      t2.birth_date::date
                    HAVING COUNT(DISTINCT t2.canonical_card) > 1
                  )
                ))` : Prisma.empty}
          `);
  const [rows, countRows, cityRows, batchRows] = await prisma.$transaction([
    rowsSql,
    countSql,
    prisma.$queryRaw<CityRow[]>`
      SELECT DISTINCT city
      FROM "CardIssuanceRegistryAll"
      WHERE city IS NOT NULL AND BTRIM(city) <> ''
      ORDER BY city ASC
    `,
    prisma.$queryRaw<BatchRow[]>`
      SELECT 
        batch_number,
        COUNT(*)::bigint AS count
      FROM "CardIssuanceRegistryAll"
      WHERE 1=1 ${cityFilter ? Prisma.sql`AND city = ${cityFilter}` : Prisma.empty}
      GROUP BY batch_number
    `,
  ]);

  const total = countRows.length > 0 ? Number(countRows[0].count ?? 0) : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // فرز الدفعات رقمياً بدلاً من أبجدياً وتصفية الدفعات الصالحة
  const sortedBatchRows = [...batchRows]
    .filter((row) => Boolean(row.batch_number))
    .sort((a, b) => {
      const numA = parseInt(a.batch_number!, 10);
      const numB = parseInt(b.batch_number!, 10);
      const isNumA = !isNaN(numA);
      const isNumB = !isNaN(numB);
      if (isNumA && isNumB) return numA - numB;
      if (isNumA) return -1;
      if (isNumB) return 1;
      return a.batch_number!.localeCompare(b.batch_number!);
    });

  // حساب عدد الأشخاص بدون دفعة
  const noBatchRow = batchRows.find((row) => !row.batch_number || row.batch_number.trim() === "");
  const noBatchCount = noBatchRow ? Number(noBatchRow.count ?? 0) : 0;

  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (cityFilter) params.set("city", cityFilter);
    if (batchFilter) params.set("batch", batchFilter);
    if (onlyMultiBatch) params.set("multi", "1");
    if (onlyMissingInSystem) params.set("not_in_system", "1");
    if (onlyInSystemNotInRegistry) params.set("in_system_not_in_registry", "1");
    if (onlyLegacyHasBatch) params.set("legacy_has_batch", "1");
    if (onlyLegacyNoBatch) params.set("legacy_no_batch", "1");
    if (onlyFamilyNumberingMismatch) params.set("family_numbering_mismatch", "1");
    if (onlyMultiPersonCards) params.set("multi_person_cards", "1");
    if (sortFilter) params.set("sort", sortFilter);
    params.set("page", String(nextPage));
    return `/admin/truth-registry?${params.toString()}`;
  };

  const exportParams = new URLSearchParams();
  if (query) exportParams.set("q", query);
  if (cityFilter) exportParams.set("city", cityFilter);
  if (batchFilter) exportParams.set("batch", batchFilter);
  if (onlyMultiBatch) exportParams.set("multi", "1");
  if (onlyMissingInSystem) exportParams.set("not_in_system", "1");
  if (onlyInSystemNotInRegistry) exportParams.set("in_system_not_in_registry", "1");
  if (onlyLegacyHasBatch) exportParams.set("legacy_has_batch", "1");
  if (onlyLegacyNoBatch) exportParams.set("legacy_no_batch", "1");
  if (onlyFamilyNumberingMismatch) exportParams.set("family_numbering_mismatch", "1");
  if (onlyMultiPersonCards) exportParams.set("multi_person_cards", "1");
  if (sortFilter) exportParams.set("sort", sortFilter);
  const exportHref = `/api/admin/truth-registry/export?${exportParams.toString()}`;

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">جدول الحقيقة</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              مصدر الحقيقة لبيانات إصدار البطاقات CardIssuanceRegistry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href={exportHref} className="inline-flex">
              <Button type="button" variant="outline" className="h-10 text-xs gap-2 border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/20">
                <Download className="h-4 w-4" />
                تصدير إكسل
              </Button>
            </a>
            <Link href="/admin/duplicates" className="inline-flex">
              <Button type="button" variant="outline" className="h-10 text-xs">العودة لإدارة المشاكل</Button>
            </Link>
          </div>
        </div>

        <details className="group">
          <summary className="flex cursor-pointer items-center justify-between rounded-lg bg-slate-100 p-4 font-bold dark:bg-slate-800 list-none">
            <div className="flex items-center gap-2">
              <Import className="h-5 w-5 text-primary" />
              <span>استيراد بيانات جديدة لجدول الحقيقة</span>
            </div>
            <span className="text-xs text-slate-500 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="mt-4">
            <TruthRegistryImport />
          </div>
        </details>

        <Card className="p-4">
          <form className="flex flex-wrap items-center gap-2">
            <Input
              name="q"
              defaultValue={query}
              placeholder="بحث برقم البطاقة أو الاسم أو الملف"
              autoComplete="off"
              className="w-full sm:w-72"
            />

            <select
              name="city"
              defaultValue={cityFilter}
              className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">كل المدن</option>
              {cityRows.map((row) => (
                <option key={row.city} value={row.city}>{row.city}</option>
              ))}
            </select>

            <select
              name="batch"
              defaultValue={batchFilter}
              className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 font-medium"
            >
              <option value="">كل الدفعات</option>
              <option value={NO_BATCH_FILTER_VALUE}>
                بدون دفعة {noBatchCount > 0 ? `(${noBatchCount.toLocaleString("ar-LY")})` : ""}
              </option>
              {sortedBatchRows.map((row) => {
                const batchNum = row.batch_number ?? "";
                const batchCount = Number(row.count ?? 0);
                return (
                  <option key={batchNum} value={batchNum}>
                    الدفعة {batchNum} ({batchCount.toLocaleString("ar-LY")})
                  </option>
                );
              })}
            </select>

            <select
              name="sort"
              defaultValue={sortFilter}
              className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 font-medium"
            >
              <option value="">الترتيب الافتراضي</option>
              <option value="birth_asc">المواليد (الأقدم للأحدث)</option>
              <option value="birth_desc">المواليد (الأحدث للأقدم)</option>
            </select>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-4 border-t border-slate-200 dark:border-slate-800 pt-4">
              {/* المجموعة الأولى: فلاتر جدول الحقيقة */}
              <div className="space-y-3 border-l border-slate-200 dark:border-slate-800 pl-4 last:border-0 last:pl-0">
                <h3 className="text-xs font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5 mb-2">
                  <span>📋</span> فلاتر جدول الحقيقة
                </h3>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value=""
                      defaultChecked={
                        !onlyMultiBatch &&
                        !onlyMissingInSystem &&
                        !onlyInSystemNotInRegistry &&
                        !onlyLegacyHasBatch &&
                        !onlyLegacyNoBatch &&
                        !onlyFamilyNumberingMismatch &&
                        !onlyMultiPersonCards &&
                        !onlyDemographicMismatch
                      }
                    />
                    عرض كافة السجلات الافتراضية
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input type="radio" name="filter_type" value="multi" defaultChecked={onlyMultiBatch} />
                    موجود بأكثر من دفعة في جدول الحقيقة
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value="multi_person_cards"
                      defaultChecked={onlyMultiPersonCards}
                    />
                    تباين الترميز لنفس المستفيد (تعدد الأرقام)
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value="demographic_mismatch"
                      defaultChecked={onlyDemographicMismatch}
                    />
                    تضارب البيانات الديموغرافية (الاسم/الميلاد)
                  </label>
                </div>
              </div>

              {/* المجموعة الثانية: فلاتر مطابقة الجدولين */}
              <div className="space-y-3 border-l border-slate-200 dark:border-slate-800 pl-4 last:border-0 last:pl-0">
                <h3 className="text-xs font-black text-purple-600 dark:text-purple-400 flex items-center gap-1.5 mb-2">
                  <span>🔄</span> فلاتر مطابقة الجدولين
                </h3>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input type="radio" name="filter_type" value="not_in_system" defaultChecked={onlyMissingInSystem} />
                    موجود في الحقيقة وغير مدرج بالمنظومة
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value="in_system_not_in_registry"
                      defaultChecked={onlyInSystemNotInRegistry}
                    />
                    موجود بالمنظومة وغير مدرج بجدول الحقيقة
                  </label>
                </div>
              </div>

              {/* المجموعة الثالثة: فلاتر تنظيف وتصحيح المنظومة */}
              <div className="space-y-3">
                <h3 className="text-xs font-black text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-2">
                  <span>🧹</span> فلاتر تنظيف وتصحيح المنظومة
                </h3>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input type="radio" name="filter_type" value="legacy_no_batch" defaultChecked={onlyLegacyNoBatch} />
                    بطاقات قديمة بالمنظومة بدون دفعة (208 بطاقة)
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value="legacy_has_batch"
                      defaultChecked={onlyLegacyHasBatch}
                    />
                    بطاقات قديمة بالمنظومة ولها دفعة (111 بطاقة)
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer transition-colors text-xs font-semibold">
                    <input
                      type="radio"
                      name="filter_type"
                      value="family_numbering_mismatch"
                      defaultChecked={onlyFamilyNumberingMismatch}
                    />
                    تباين الترميز العائلي (أرقام بطاقات غير مطابقة)
                  </label>
                </div>
              </div>
            </div>

            <div className="w-full flex justify-end gap-2 mt-4 border-t border-slate-200 dark:border-slate-800 pt-4">
              <input type="hidden" name="page" value="1" />
              <Button type="submit" className="h-10 text-xs font-bold px-6">
                تطبيق التصفية المحددة
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
            <h2 className="text-sm font-black text-slate-900 dark:text-white">السجلات ({total.toLocaleString("ar-LY")})</h2>
          </div>
          <TruthRegistryTable 
            rows={rows} 
            totalCount={total}
            filters={{
              query,
              city: cityFilter,
              batch: batchFilter,
              multi: onlyMultiBatch,
              not_in_system: onlyMissingInSystem,
              in_system_not_in_registry: onlyInSystemNotInRegistry,
              legacy_has_batch: onlyLegacyHasBatch,
              legacy_no_batch: onlyLegacyNoBatch,
              family_numbering_mismatch: onlyFamilyNumberingMismatch,
              multi_person_cards: onlyMultiPersonCards,
              sort: sortFilter
            }}
          />

          {total > pageSize && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-3 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                صفحة {pageNumber} من {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Link href={buildHref(Math.max(1, pageNumber - 1))}>
                  <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={pageNumber <= 1}>السابق</Button>
                </Link>
                <Link href={buildHref(Math.min(totalPages, pageNumber + 1))}>
                  <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={pageNumber >= totalPages}>التالي</Button>
                </Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
