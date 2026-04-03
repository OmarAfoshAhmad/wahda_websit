"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button, Input } from "@/components/ui";

interface BeneficiariesSearchProps {
  initialQuery: string;
}

export function BeneficiariesSearch({ initialQuery }: BeneficiariesSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  const submitSearch = () => {
    const currentQuery = (searchParams.get("q") ?? "").trim();
    const nextQuery = query.trim();
    if (currentQuery === nextQuery) return;

    const params = new URLSearchParams(searchParams.toString());
    if (nextQuery) {
      params.set("q", nextQuery);
    } else {
      params.delete("q");
    }

    params.set("page", "1");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  };

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submitSearch();
      }}
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو رقم البطاقة"
          className="pr-10"
        />
      </div>
      <Button type="submit" className="h-10 px-4 whitespace-nowrap">
        بحث
      </Button>
    </form>
  );
}
