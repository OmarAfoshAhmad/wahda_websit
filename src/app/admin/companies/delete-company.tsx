"use client";

import React, { useState } from "react";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { softDeleteCompany } from "@/app/actions/company";

interface Props {
  companyId: string;
  companyName: string;
}

export function DeleteCompany({ companyId, companyName }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    const result = await softDeleteCompany(companyId);
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
  };

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900/40"
        title="حذف الشركة"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 dark:text-white">حذف الشركة</h3>
            <p className="text-sm text-slate-500">هل أنت متأكد من حذف {companyName}؟</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleDelete} disabled={loading} className="flex-1 bg-red-600 hover:bg-red-700">
            {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            تأكيد الحذف
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} disabled={loading} className="flex-1">
            إلغاء
          </Button>
        </div>
      </Card>
    </div>
  );
}
