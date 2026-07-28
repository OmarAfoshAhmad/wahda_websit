import { describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", () => ({
  requireActiveFacilitySession: vi.fn(async () => sessionState.session),
}));

describe("high-risk administrative role guard", () => {
  it("does not trust a legacy is_admin flag when role_v2 is not SUPER_ADMIN", async () => {
    sessionState.session = {
      id: "legacy-admin",
      username: "legacy-admin",
      role_v2: "MANAGER",
      is_admin: true,
    };

    const { GET: exportBackup } = await import("@/app/api/backup/export/route");
    const exportResponse = await exportBackup(new Request("http://localhost/api/backup/export") as never);
    expect(exportResponse.status).toBe(401);

    const { GET: getRestoreJob } = await import("@/app/api/backup/restore-jobs/[jobId]/route");
    const restoreResponse = await getRestoreJob(new Request("http://localhost/api/backup/restore-jobs/fake"), {
      params: Promise.resolve({ jobId: "fake" }),
    });
    expect(restoreResponse.status).toBe(401);

    const { POST: emptyRecycleBin } = await import("@/app/api/admin/empty-recycle-bin/route");
    expect((await emptyRecycleBin()).status).toBe(401);

    const { POST: mergeAllDuplicates } = await import("@/app/api/admin/duplicates/merge-all-safe/route");
    expect((await mergeAllDuplicates(new Request("http://localhost/api/admin/duplicates/merge-all-safe", { method: "POST" }))).status).toBe(403);

    const { GET: exportAuditLog } = await import("@/app/api/export/audit-log/route");
    expect((await exportAuditLog(new Request("http://localhost/api/export/audit-log") as never)).status).toBe(403);
  });
});
