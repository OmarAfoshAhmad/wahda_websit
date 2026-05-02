import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { CardNumberingClient } from "@/components/card-numbering-client";
import { getCardNumberingArchive } from "@/app/actions/card-numbering";

export const metadata = {
  title: "ترقيم البطاقات | شركة الواحة",
};

export default async function CardNumberingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  
  // Only admins can access this maintenance tool
  if (!canAccessAdmin(session)) {
    redirect("/dashboard");
  }

  const { items, error } = await getCardNumberingArchive();

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div>
          <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">ترقيم البطاقات</h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            أداة صيانة لاستيراد الموظفين وترقيم بطاقاتهم تلقائياً بناءً على الرقم الوظيفي (6 خانات).
          </p>
        </div>

        {error ? (
          <div className="p-10 text-center text-red-500 font-bold bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800">
            {error}
          </div>
        ) : (
          <CardNumberingClient initialItems={items || []} />
        )}
      </div>
    </Shell>
  );
}
