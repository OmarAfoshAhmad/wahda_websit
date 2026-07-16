import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { BackupClient } from "./client";

export default async function BackupPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "manage_backup")) redirect("/dashboard");

  return (
    <Shell
      facilityName={session.name}
      session={session}
    >
      <BackupClient />
    </Shell>
  );
}
