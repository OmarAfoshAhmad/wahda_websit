import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { CardNumberingClient } from "@/components/card-numbering-client";
import { getCardNumberingArchive } from "@/app/actions/card-numbering";

export const metadata = {
  title: "ترقيم البطاقات | شركة الواحة",
};

export default async function CardNumberingPage(props: { searchParams: Promise<{ deleted?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  
  // التحقق من الصلاحيات: حصراً للمشرف أو من لديه صلاحية ترقيم أو ترحيل البطاقات
  const canManage = hasPermission(session, "manage_card_numbering");
  const canMigrate = hasPermission(session, "migrate_card_numbering");
  
  if (!canManage && !canMigrate) {
    redirect("/dashboard");
  }

  const showDeleted = searchParams.deleted === "true";
  const { items, error } = await getCardNumberingArchive(showDeleted);

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        {error ? (
          <div className="p-10 text-center text-red-500 font-bold bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-800">
            {error}
          </div>
        ) : (
          <CardNumberingClient 
            initialItems={items || []} 
            showDeleted={showDeleted} 
            canManage={canManage}
            canMigrate={canMigrate}
          />
        )}
      </div>
    </Shell>
  );
}
