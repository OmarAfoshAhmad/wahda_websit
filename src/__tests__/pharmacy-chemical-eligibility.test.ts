import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { id: "admin", username: "admin", role: "ADMIN", is_admin: true },
  allowed: true,
  scope: true,
  find: vi.fn(), update: vi.fn(), audit: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/session-guard", () => ({
  getSessionWithFreshPermissions: vi.fn(async () => state.session),
  hasPermission: vi.fn(() => state.allowed),
}));
vi.mock("@/lib/company-scope", () => ({ assertCompanyAccessForSession: vi.fn(async () => { if (!state.scope) throw new Error("scope"); }) }));
vi.mock("@/lib/prisma", () => {
  const client = { beneficiary: { findFirst: state.find, update: state.update }, auditLog: { create: state.audit }, $queryRaw: state.lock };
  return { default: { ...client, $transaction: vi.fn(async (fn) => fn(client)) } };
});
import { setBeneficiaryChemicalEnabled } from "@/app/actions/pharmacy-beneficiaries";

describe("independent chemical eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.allowed = true; state.scope = true;
    state.session = { id: "admin", username: "admin", role: "ADMIN", is_admin: true };
    state.find.mockResolvedValue({ id: "member-a", company_id: "company", card_number: "CARD-A", chemical_enabled: false });
  });
  it("updates only the selected beneficiary and audits the change", async () => {
    expect(await setBeneficiaryChemicalEnabled("member-a", true)).toMatchObject({ success: true });
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "member-a" }, data: { chemical_enabled: true } });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BENEFICIARY_CHEMICAL_CHANGE", metadata: expect.objectContaining({ beneficiary_id: "member-a", before: false, after: true }) }) }));
    expect(state.lock).toHaveBeenCalled();
  });
  it("can disable a previously enabled beneficiary", async () => {
    state.find.mockResolvedValue({ id: "member-a", company_id: "company", card_number: "CARD-A", chemical_enabled: true });
    expect(await setBeneficiaryChemicalEnabled("member-a", false)).toMatchObject({ success: true });
    expect(state.update).toHaveBeenCalledWith({ where: { id: "member-a" }, data: { chemical_enabled: false } });
  });
  it("rejects read-only staff", async () => {
    state.allowed = false;
    expect(await setBeneficiaryChemicalEnabled("member-a", true)).toHaveProperty("error");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects facilities even with permissions", async () => {
    state.session = { ...state.session, role: "FACILITY", is_admin: false };
    expect(await setBeneficiaryChemicalEnabled("member-a", true)).toHaveProperty("error");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects another company", async () => {
    state.scope = false;
    expect(await setBeneficiaryChemicalEnabled("member-a", true)).toHaveProperty("error");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects malformed toggle values", async () => {
    expect(await setBeneficiaryChemicalEnabled("member-a", "false" as unknown as boolean)).toHaveProperty("error");
    expect(state.update).not.toHaveBeenCalled();
  });
});
