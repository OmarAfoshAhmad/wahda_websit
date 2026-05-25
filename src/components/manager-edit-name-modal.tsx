"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateManagerName } from "@/app/actions/manager";
import { Button, Input } from "@/components/ui";

type Props = {
  managerId: string;
  managerName: string;
};

export function ManagerEditNameModal({ managerId, managerName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(managerName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateManagerName(managerId, name);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setName(managerName);
          setError(null);
          setOpen(true);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700"
        title="تعديل الاسم"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-black text-slate-900 dark:text-white">تعديل اسم الحساب</h2>
              <button
                onClick={() => !isPending && setOpen(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">الاسم الجديد</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أدخل الاسم"
              disabled={isPending}
            />

            {error && (
              <div className="mt-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm font-bold text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="flex-1"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="flex-1"
              >
                {isPending ? "جارٍ الحفظ..." : "حفظ"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

