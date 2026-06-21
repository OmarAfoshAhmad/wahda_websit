import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { getLegacyCardsAnalysisAction } from "@/app/actions/legacy-cards";
import LegacyCardsClient from "./legacy-cards-client";

export const metadata = {
  title: "البطاقات القديمة | شركة الواحة",
};

export default async function LegacyCardsPage() {
  const session = await getSession();
  
  if (!session || !session.is_admin) {
    redirect("/dashboard");
  }

  const result = await getLegacyCardsAnalysisAction();
  const data = result.success && result.data ? result.data : { withNewCards: [], withoutNewCards: [] };

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6 pb-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">إدارة البطاقات القديمة</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            مراجعة البطاقات القديمة التي تم استيرادها مسبقاً، وإزالة السجلات القديمة لمن صدرت لهم بطاقات جديدة لتجنب التكرار.
          </p>
        </div>

        <LegacyCardsClient initialData={data} />
      </div>
    </Shell>
  );
}
