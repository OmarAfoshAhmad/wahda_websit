import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "بوابة المستفيد — الواحة للرعاية الصحية",
};

export default function BeneficiaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-linear-to-b from-[#f0f4fb] to-slate-50 dark:from-[#0b1120] dark:to-slate-900" dir="rtl">
      {children}
    </div>
  );
}
