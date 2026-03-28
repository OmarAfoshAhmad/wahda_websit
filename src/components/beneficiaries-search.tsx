"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";

interface BeneficiariesSearchProps {
  initialQuery: string;
}

export function BeneficiariesSearch({ initialQuery }: BeneficiariesSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const isTypingRef = useRef(false);

  const paramsSnapshot = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    const handler = setTimeout(() => {
      const currentQuery = (searchParams.get("q") ?? "").trim();
      const nextQuery = query.trim();

      if (currentQuery === nextQuery) {
        isTypingRef.current = false;
        return;
      }

      const params = new URLSearchParams(paramsSnapshot);
      if (nextQuery) {
        params.set("q", nextQuery);
      } else {
        params.delete("q");
      }

      // عند البحث نعود لأول صفحة
      params.set("page", "1");

      const next = params.toString();
      router.replace(next ? `${pathname}?${next}` : pathname);

      // نُعيد التعيين بعد الانتهاء
      setTimeout(() => { isTypingRef.current = false; }, 100);
    }, 400);

    return () => clearTimeout(handler);
  }, [query, pathname, router, paramsSnapshot, searchParams]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
      <Input
        value={query}
        onChange={(e) => {
          isTypingRef.current = true;
          setQuery(e.target.value);
        }}
        placeholder="ابحث بالاسم أو رقم البطاقة"
        className="pr-10"
      />
    </div>
  );
}
