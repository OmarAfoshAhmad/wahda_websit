import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { BackupClient } from "./client";
import prisma from "@/lib/prisma";

export default async function BackupPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null, is_active: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return (
    <Shell
      facilityName={session.name}
      session={session}
    >
      <BackupClient companies={companies} />
    </Shell>
  );
}
