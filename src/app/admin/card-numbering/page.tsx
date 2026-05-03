import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { CardNumberingClient } from "@/components/card-numbering-client";
import { getCardNumberingArchive } from "@/app/actions/card-numbering";

export const metadata = {
  title: "ترقيم البطاقات | شركة الواحة",
};

export default async function CardNumberingPage(props: { searchParams: Promise<{ deleted?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  
  // التحقق من الصلاحيات: حصراً للمشرف أو من لديه صلاحية ترقيم البطاقات
  if (!hasPermission(session, "manage_card_numbering")) {
    redirect("/dashboard");
  }

  const showDeleted = searchParams.deleted === "true";
  const { items, error } = await getCardNumberingArchive(showDeleted);

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
          <CardNumberingClient initialItems={items || []} showDeleted={showDeleted} />
        )}
      </div>
    </Shell>
  );
}
