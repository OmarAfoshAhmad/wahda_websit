import { NavSkeleton, StatCardSkeleton } from "@/components/page-skeleton";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1120] animate-pulse">
      <NavSkeleton />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:px-6 space-y-5">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
          <div className="h-4 w-80 rounded bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="h-5 w-32 rounded bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
          <div className="flex gap-3">
            <div className="h-12 flex-1 rounded-md bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
            <div className="h-12 w-32 rounded-md bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
          </div>
          <div className="h-12 w-full rounded-md bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
        </div>
      </main>
    </div>
  );
}

