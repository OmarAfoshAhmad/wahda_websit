import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "بوابة المستفيد — الواحة للرعاية الصحية",
};

export default function BeneficiaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-medical min-h-screen bg-linear-to-b from-[#effcf9] to-slate-50 dark:from-[#04201d] dark:to-slate-900" dir="rtl">
      {children}
    </div>
  );
}
