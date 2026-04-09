import Link from "next/link";

interface PaginationButtonsProps {
  page: number;
  totalPages: number;
  hrefForPage: (p: number) => string;
}

function getPageRange(current: number, total: number): Array<number | "..."> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const nearby = new Set(
    [1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total)
  );

  const sorted = [...nearby].sort((a, b) => a - b);
  const result: Array<number | "..."> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) result.push("...");
    result.push(p);
    prev = p;
  }
  return result;
}

export function PaginationButtons({ page, totalPages, hrefForPage }: PaginationButtonsProps) {
  if (totalPages <= 1) return null;

  const ranges = getPageRange(page, totalPages);

  return (
    <div className="flex items-center gap-1">
      {/* زر السابق — في RTL السابق يشير لليمين */}
      {page > 1 ? (
        <Link
          href={hrefForPage(page - 1)}
          className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          &#8594;
        </Link>
      ) : (
        <span className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
          &#8594;
        </span>
      )}

      {/* أرقام الصفحات */}
      {ranges.map((item, i) =>
        item === "..." ? (
          <span
            key={`ellipsis-${i}`}
            className="inline-flex items-center px-2 py-1.5 text-sm text-slate-400 dark:text-slate-500"
          >
            …
          </span>
        ) : (
          <Link
            key={item}
            href={hrefForPage(item)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold transition-colors ${
              item === page
                ? "border-primary/30 bg-primary-light dark:bg-primary/20 text-primary dark:text-blue-400 dark:border-primary/40"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}
          >
            {item}
          </Link>
        )
      )}

      {/* زر التالي — في RTL التالي يشير لليسار */}
      {page < totalPages ? (
        <Link
          href={hrefForPage(page + 1)}
          className="inline-flex items-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          &#8592;
        </Link>
      ) : (
        <span className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-1.5 text-sm font-bold text-slate-300 dark:text-slate-600">
          &#8592;
        </span>
      )}
    </div>
  );
}
