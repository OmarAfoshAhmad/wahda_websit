"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 border border-red-200">
          <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">حدث خطأ غير متوقع</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          نعتذر عن هذا الخطأ. يمكنك إعادة المحاولة.
        </p>
        {error.digest && (
          <p className="text-xs text-slate-400 mb-4">رمز الخطأ: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center flex-wrap">
          <Button onClick={() => reset()}>إعادة المحاولة</Button>
          <Button variant="outline" onClick={() => window.location.href = "/dashboard"}>
            العودة للرئيسية
          </Button>
        </div>
      </div>
    </div>
  );
}
