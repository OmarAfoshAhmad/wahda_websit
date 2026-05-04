import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { BackupClient } from "./client";

export default async function BackupPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  return (
    <Shell
      facilityName={session.name}
      session={session}
    >
      <BackupClient />
    </Shell>
  );
}
