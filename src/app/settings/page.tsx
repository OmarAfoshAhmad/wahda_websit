import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { getOtpSettings, getWahdaAllocationWindowEnabled } from "@/lib/system-settings";
import { SettingsPageClient } from "@/components/settings-page-client";

export default async function SettingsPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");

  const initialBalance = await getCurrentInitialBalance();
  const [otpSettings, wahdaAllocationWindowEnabled] = await Promise.all([
    getOtpSettings(),
    getWahdaAllocationWindowEnabled(),
  ]);

  return (
    <SettingsPageClient
      initialBalance={initialBalance}
      otpSettings={otpSettings}
      canManageInitialBalance={session.role_v2 === "SUPER_ADMIN"}
      canManageSystemFeatures={session.role_v2 === "SUPER_ADMIN"}
      wahdaAllocationWindowEnabled={wahdaAllocationWindowEnabled}
    />
  );
}
