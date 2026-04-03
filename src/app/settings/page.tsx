import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { SettingsPageClient } from "@/components/settings-page-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const initialBalance = await getCurrentInitialBalance();

  return (
    <SettingsPageClient
      initialBalance={initialBalance}
      canManageInitialBalance={Boolean(session.is_admin)}
    />
  );
}
