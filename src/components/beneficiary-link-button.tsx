"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";

export function BeneficiaryLinkButton({ beneficiaryId }: { beneficiaryId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // Token يُنشأ على الخادم — نطلبه عبر API بسيط
    try {
      const res = await fetch(`/api/beneficiary-link?id=${encodeURIComponent(beneficiaryId)}`);
      if (!res.ok) return;
      const { url } = await res.json() as { url: string };
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      title="نسخ رابط الاستعلام"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary/30 hover:bg-primary-light hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary/20"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" />
      ) : (
        <Link2 className="h-4 w-4" />
      )}
    </button>
  );
}
