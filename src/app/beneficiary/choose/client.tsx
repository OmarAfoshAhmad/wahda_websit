"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Loader2, UserRound } from "lucide-react";

type Member = { id: string; name: string; relation: string };

export function ChooseMemberClient({ members, currentId }: { members: Member[]; currentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  const choose = async (id: string) => {
    setPending(id);
    setError("");
    try {
      const res = await fetch("/api/beneficiary/switch-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beneficiary_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "تعذر الاختيار");
        return;
      }
      router.push("/beneficiary/dashboard");
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-4 pb-8 pt-8">
      <h1 className="text-2xl font-black text-slate-900 dark:text-white">لمن الدواء؟</h1>
      <p className="mt-1 text-base text-slate-500 dark:text-slate-400">اختر الشخص الذي تطلب له الدواء.</p>

      <div role="radiogroup" aria-label="أفراد الأسرة" className="mt-5 space-y-3">
        {members.map((member) => {
          const selected = member.id === currentId;
          return (
            <button
              key={member.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending !== null}
              onClick={() => void choose(member.id)}
              className={`flex min-h-19 w-full items-center gap-3 rounded-2xl border-2 bg-white px-4 py-3 text-start shadow-sm transition disabled:opacity-60 dark:bg-slate-900 ${selected ? "border-primary" : "border-slate-200 dark:border-slate-700"}`}
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary dark:bg-primary/20 dark:text-teal-300">
                <UserRound className="h-6 w-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-black text-slate-900 dark:text-white">{member.name}</span>
                <span className="block text-sm text-slate-500 dark:text-slate-400">{member.relation}</span>
              </span>
              {pending === member.id ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : selected ? <Check className="h-6 w-6 text-primary" /> : <ChevronLeft className="h-5 w-5 text-slate-400" />}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
