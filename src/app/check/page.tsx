"use client";

import { ShieldX } from "lucide-react";

export default function CheckPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center" dir="rtl">
      <ShieldX className="h-12 w-12 text-slate-300" />
      <h1 className="text-xl font-black text-slate-700">الاستعلام عن الرصيد</h1>
      <p className="max-w-xs text-sm text-slate-500">
        للاطلاع على رصيدك وحركاتك، تواصل مع شركة الواحة للحصول على رابطك الخاص.
      </p>
    </div>
  );
}
