import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";

export type ClaimedBackgroundActor = {
  id: string;
  username: string;
};

export async function resolveVerifiedSuperAdminActor(
  claimed?: ClaimedBackgroundActor,
): Promise<{ id: string; username: string } | null> {
  if (!claimed) {
    const session = await requireActiveFacilitySession();
    return session?.role_v2 === "SUPER_ADMIN"
      ? { id: session.id, username: session.username }
      : null;
  }

  const account = await prisma.facility.findFirst({
    where: {
      id: claimed.id,
      username: claimed.username,
      role_v2: "SUPER_ADMIN",
      deleted_at: null,
    },
    select: { id: true, username: true },
  });
  return account;
}
