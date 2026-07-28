import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/prisma";
import { resolveVerifiedSuperAdminActor } from "@/lib/super-admin-actor";
import { startMaintenanceJobForActor } from "@/app/actions/maintenance-jobs";

describe("verified background SUPER_ADMIN actor", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a real non-super account even when the caller claims isAdmin=true", async () => {
    const nonSuperAccount = await prisma.facility.findFirst({
      where: {
        deleted_at: null,
        role_v2: { not: "SUPER_ADMIN" },
      },
      select: { id: true, username: true },
    });

    expect(nonSuperAccount).not.toBeNull();

    const verified = await resolveVerifiedSuperAdminActor(nonSuperAccount!);
    expect(verified).toBeNull();

    const result = await startMaintenanceJobForActor(
      { kind: "fix_status_anomalies" },
      { ...nonSuperAccount!, isAdmin: true },
    );

    expect(result).toEqual({ success: false, error: "غير مصرح" });
  });

  it("rejects a forged username for an existing SUPER_ADMIN id", async () => {
    const superAdmin = await prisma.facility.findFirst({
      where: { deleted_at: null, role_v2: "SUPER_ADMIN" },
      select: { id: true, username: true },
    });

    expect(superAdmin).not.toBeNull();
    await expect(
      resolveVerifiedSuperAdminActor({
        id: superAdmin!.id,
        username: `${superAdmin!.username}-forged`,
      }),
    ).resolves.toBeNull();
  });
});
