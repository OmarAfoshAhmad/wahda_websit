import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { Card, Button, Input } from "@/components/ui";
import prisma from "@/lib/prisma";
import { TruthRegistryImport } from "@/components/admin/truth-registry-import";
import { Import } from "lucide-react";

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

type BatchRow = { batch_number: string | null };

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
  }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { q, city, batch, multi, page } = await searchParams;

  const query = (q ?? "").trim().slice(0, 100);
  const cityFilter = (city ?? "").trim().slice(0, 80);
  const batchFilter = (batch ?? "").trim().slice(0, 80);
  const isNoBatchFilter = batchFilter === NO_BATCH_FILTER_VALUE;
  const onlyMultiBatch = multi === "1";
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const pageSize = 100;

  const rowsSql = query
    ? prisma.$queryRaw<RegistryRow[]>`
        WITH filtered AS (
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
            updated_at
          FROM "CardIssuanceRegistryAll"
          WHERE (${cityFilter} = '' OR city = ${cityFilter})
            AND (
              (${batchFilter} = '')
              OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
              OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
            )
            AND (
              card_number ILIKE ${`%${query}%`}
              OR COALESCE(beneficiary_name, '') ILIKE ${`%${query}%`}
              OR COALESCE(source_file, '') ILIKE ${`%${query}%`}
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
          s.batches_list
        FROM filtered f
        JOIN stats s ON s.card_number_upper = f.card_number_upper
        WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
        ORDER BY f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST
        LIMIT ${pageSize}
        OFFSET ${(pageNumber - 1) * pageSize}
      `
    : prisma.$queryRaw<RegistryRow[]>`
        WITH filtered AS (
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
            updated_at
          FROM "CardIssuanceRegistryAll"
          WHERE (${cityFilter} = '' OR city = ${cityFilter})
            AND (
              (${batchFilter} = '')
              OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
              OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
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
          s.batches_list
        FROM filtered f
        JOIN stats s ON s.card_number_upper = f.card_number_upper
        WHERE (${onlyMultiBatch} = false OR s.batches_count > 1)
        ORDER BY f.city ASC, f.batch_number ASC NULLS LAST, f.card_number_upper ASC, f.source_file ASC NULLS LAST, f.source_row ASC NULLS LAST
        LIMIT ${pageSize}
        OFFSET ${(pageNumber - 1) * pageSize}
      `;

  const countSql = query
    ? prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "CardIssuanceRegistryAll"
        WHERE (${cityFilter} = '' OR city = ${cityFilter})
          AND (
            (${batchFilter} = '')
            OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
            OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
          )
          AND (
            card_number ILIKE ${`%${query}%`}
            OR COALESCE(beneficiary_name, '') ILIKE ${`%${query}%`}
            OR COALESCE(source_file, '') ILIKE ${`%${query}%`}
          )
          AND (
            ${onlyMultiBatch} = false
            OR card_number_upper IN (
              SELECT card_number_upper
              FROM "CardIssuanceRegistryAll"
              GROUP BY card_number_upper
              HAVING COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__')) > 1
            )
          )
      `
    : prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "CardIssuanceRegistryAll"
        WHERE (${cityFilter} = '' OR city = ${cityFilter})
          AND (
            (${batchFilter} = '')
            OR (${isNoBatchFilter} = true AND (batch_number IS NULL OR BTRIM(batch_number) = ''))
            OR (${isNoBatchFilter} = false AND batch_number = ${batchFilter})
          )
          AND (
            ${onlyMultiBatch} = false
            OR card_number_upper IN (
              SELECT card_number_upper
              FROM "CardIssuanceRegistryAll"
              GROUP BY card_number_upper
              HAVING COUNT(DISTINCT COALESCE(NULLIF(BTRIM(batch_number), ''), '__NO_BATCH__')) > 1
            )
          )
      `;

  const [rows, countRows, cityRows, batchRows] = await Promise.all([
    rowsSql,
    countSql,
    prisma.$queryRaw<CityRow[]>`
      SELECT DISTINCT city
      FROM "CardIssuanceRegistryAll"
      WHERE city IS NOT NULL AND BTRIM(city) <> ''
      ORDER BY city ASC
    `,
    prisma.$queryRaw<BatchRow[]>`
      SELECT DISTINCT batch_number
      FROM "CardIssuanceRegistryAll"
      WHERE (${cityFilter} = '' OR city = ${cityFilter})
      ORDER BY batch_number ASC NULLS FIRST
    `,
  ]);

  const total = countRows.length > 0 ? Number(countRows[0].count ?? 0) : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (cityFilter) params.set("city", cityFilter);
    if (batchFilter) params.set("batch", batchFilter);
    if (onlyMultiBatch) params.set("multi", "1");
    params.set("page", String(nextPage));
    return `/admin/truth-registry?${params.toString()}`;
  };

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
              className="h-10 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">كل الدفعات</option>
              <option value={NO_BATCH_FILTER_VALUE}>بدون دفعة</option>
              {batchRows
                .filter((row) => Boolean(row.batch_number))
                .map((row) => (
                  <option key={row.batch_number ?? ""} value={row.batch_number ?? ""}>{row.batch_number}</option>
                ))}
            </select>

            <label className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900">
              <input type="checkbox" name="multi" value="1" defaultChecked={onlyMultiBatch} />
              موجود بأكثر من دفعة
            </label>

            <input type="hidden" name="page" value="1" />
            <Button type="submit" variant="outline" className="h-10">تطبيق</Button>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
            <h2 className="text-sm font-black text-slate-900 dark:text-white">السجلات ({total.toLocaleString("ar-LY")})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-280 text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40">
                <tr className="text-right">
                  <th className="px-3 py-2 font-bold">رقم البطاقة</th>
                  <th className="px-3 py-2 font-bold">الاسم</th>
                  <th className="px-3 py-2 font-bold">الميلاد</th>
                  <th className="px-3 py-2 font-bold">المدينة</th>
                  <th className="px-3 py-2 font-bold">الدفعة</th>
                  <th className="px-3 py-2 font-bold">عدد الدفعات للبطاقة</th>
                  <th className="px-3 py-2 font-bold">كل الدفعات</th>
                  <th className="px-3 py-2 font-bold">الملف</th>
                  <th className="px-3 py-2 font-bold">الشيت</th>
                  <th className="px-3 py-2 font-bold">الصف</th>
                  <th className="px-3 py-2 font-bold">آخر تحديث</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                      لا توجد نتائج مطابقة.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-bold">{row.card_number}</td>
                      <td className="px-3 py-2">{row.beneficiary_name ?? "-"}</td>
                      <td className="px-3 py-2">
                        {row.birth_date ? row.birth_date.toLocaleDateString("en-CA") : "-"}
                      </td>
                      <td className="px-3 py-2">{row.city}</td>
                      <td className="px-3 py-2">{row.batch_number ?? "-"}</td>
                      <td className="px-3 py-2 font-bold">{row.batches_count}</td>
                      <td className="px-3 py-2 text-xs">{row.batches_list ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">{row.source_file ?? "-"}</td>
                      <td className="px-3 py-2">{row.source_sheet ?? "-"}</td>
                      <td className="px-3 py-2">{row.source_row ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">{row.updated_at.toLocaleString("en-GB")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
