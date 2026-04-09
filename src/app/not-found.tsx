import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
          <span className="text-3xl font-bold text-slate-400 dark:text-slate-500">404</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">الصفحة غير موجودة</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          عذراً، الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
