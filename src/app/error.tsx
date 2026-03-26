"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

function reportError(error: Error & { digest?: string }) {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: window.location.href,
      }),
    }).catch(() => {/* ignore send failures */});
  } catch {/* ignore */}
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("Page error:", error);
    reportError(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <h2 className="text-xl font-bold text-slate-900 mb-3">حدث خطأ غير متوقع</h2>
        <p className="text-sm text-slate-500 mb-6">
          نعتذر عن هذا الخطأ. تم إرسال تقرير تلقائي لفريق الدعم.
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button onClick={() => reset()}>إعادة المحاولة</Button>
          <Button variant="outline" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          </Button>
        </div>
        {showDetails && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-left ltr max-h-50 overflow-auto">
            <p className="text-xs font-bold text-red-800 wrap-break-word">{error.message}</p>
            {error.digest && <p className="text-xs text-slate-500 mt-1">Digest: {error.digest}</p>}
            {error.stack && (
              <pre className="mt-2 text-[0.7rem] text-red-700 whitespace-pre-wrap wrap-break-word">{error.stack}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
