import type { CSSProperties } from "react";

/**
 * مكوّنات الهيكل العظمي (Skeleton) للتحميل
 * تُستخدم في ملفات loading.tsx لعرض حالة تحميل بيصرية مناسبة
 */

function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`rounded bg-slate-200 dark:bg-slate-800 ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

/** هيكل شريط التنقل العلوي */
export function NavSkeleton() {
  return (
    <div className="sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 sm:px-5">
      <div className="mx-auto max-w-7xl flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bone className="h-9 w-9 rounded-md" />
            <div className="space-y-1.5">
              <Bone className="h-3 w-24" />
              <Bone className="h-3 w-32" />
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-hidden">
          {[90, 72, 80, 88, 96, 76].map((w, i) => (
            <Bone key={i} className={`h-7 rounded-md`} style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** هيكل بطاقة إحصائية */
export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Bone className="h-3.5 w-28" />
          <Bone className="h-7 w-16" />
        </div>
        <Bone className="h-11 w-11 rounded-md" />
      </div>
    </div>
  );
}

/** هيكل جدول بيانات */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {/* رأس الجدول */}
      <div className="flex gap-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-6 py-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Bone key={i} className="h-3 w-20" />
        ))}
      </div>
      {/* صفوف الجدول */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-slate-100 dark:border-slate-800/80 px-6 py-4 last:border-0"
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Bone
              key={j}
              className="h-4"
              style={{ width: `${[80, 120, 100, 90, 70][j % 5]}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** هيكل شريط فلتر */
export function FilterBarSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Bone className="h-3 w-16" />
            <Bone className="h-10 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** هيكل كامل صفحة من جدول (ناف + رأس + إحصائيات + فلتر + جدول) */
export function TablePageSkeleton({
  statCards = 0,
  filterFields = 4,
  tableRows = 8,
  tableCols = 5,
}: {
  statCards?: number;
  filterFields?: number;
  tableRows?: number;
  tableCols?: number;
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1120] animate-pulse">
      <NavSkeleton />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6 space-y-4">
        {/* رأس الصفحة */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Bone className="h-7 w-56" />
            <Bone className="h-4 w-72" />
          </div>
          <div className="flex gap-2 shrink-0">
            <Bone className="h-9 w-9 rounded-md" />
            <Bone className="h-9 w-9 rounded-md" />
          </div>
        </div>

        {/* بطاقات الإحصائيات */}
        {statCards > 0 && (
          <div className={`grid grid-cols-2 gap-4 lg:grid-cols-${statCards}`}>
            {Array.from({ length: statCards }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
        )}

        {/* فلتر */}
        {filterFields > 0 && <FilterBarSkeleton fields={filterFields} />}

        {/* جدول */}
        <TableSkeleton rows={tableRows} cols={tableCols} />
      </main>
    </div>
  );
}
