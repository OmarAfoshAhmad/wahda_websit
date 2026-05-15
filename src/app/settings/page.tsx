import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { getOtpSettings } from "@/lib/system-settings";
import { SettingsPageClient } from "@/components/settings-page-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const initialBalance = await getCurrentInitialBalance();
  const otpSettings = await getOtpSettings();

  return (
    <SettingsPageClient
      initialBalance={initialBalance}
      otpSettings={otpSettings}
      canManageInitialBalance={Boolean(session.is_admin)}
    />
  );
}
