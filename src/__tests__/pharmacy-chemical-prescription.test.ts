import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  chemicalEnabled: false, companyEnabled: true, create: vi.fn(),
  prescription: vi.fn(),
}));
vi.mock("@/lib/session-guard", () => ({ getSessionWithFreshPermissions: vi.fn(async () => ({ id: "pharmacy", username: "pharmacy" })), hasPermission: vi.fn(() => true) }));
vi.mock("@/lib/company-scope", () => ({ assertCompanyAccessForSession: vi.fn() }));
vi.mock("@/lib/pharmacy/summary", () => ({
  ACTIVE_DISPENSE: {},
  loadPharmacyPolicy: vi.fn(async () => ({ ceiling_amount: null, coverage_percent: 100, pharmacy_config: { chemical_enabled: state.companyEnabled, chemical_ceiling: null, chemical_daily_limit: 2, policy_year_start_month: 1 } })),
}));
vi.mock("@/lib/pharmacy/dispense-notify", () => ({ notifyBeneficiaryOfDispense: vi.fn() }));
vi.mock("@/lib/transaction-cancel", () => ({ cancelTransactionInTx: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(),
    beneficiary: { findFirst: vi.fn(async () => ({ id: "member", chemical_enabled: state.chemicalEnabled })) },
    pharmacyPrescription: { count: vi.fn(async () => 0), aggregate: vi.fn(async () => ({ _max: { prescription_number: null } })), create: state.create, findUnique: state.prescription },
    auditLog: { create: vi.fn() },
  };
  return { default: { ...tx, facility: { findFirst: vi.fn(async () => ({ id: "pharmacy" })) }, $transaction: vi.fn(async (fn) => fn(tx)), pharmacyDispense: { findUnique: vi.fn(async () => null) } } };
});
import { createPharmacyPrescription, dispensePharmacyPrescriptionItems } from "@/app/actions/pharmacy";

describe("chemical prescription eligibility enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.chemicalEnabled = false; state.companyEnabled = true;
    state.prescription.mockReset();
    state.create.mockResolvedValue({ id: "rx", prescription_number: 1, total_item_count: 5 });
    state.prescription.mockResolvedValueOnce({ company_id: "company", beneficiary_id: "member" })
      .mockResolvedValueOnce({ id: "rx", status: "OPEN", created_at: new Date(), medicine_category: "CHEMICAL", total_item_count: 5, beneficiary: { status: "ACTIVE", deleted_at: null, chemical_enabled: false } });
  });
  it("blocks creating a chemical prescription when the beneficiary is disabled", async () => {
    expect(await createPharmacyPrescription({ companyId: "company", beneficiaryId: "member", category: "CHEMICAL" })).toMatchObject({ error: "الكيميائي موقوف لهذا المستفيد" });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("allows an individually enabled beneficiary", async () => {
    state.chemicalEnabled = true;
    expect(await createPharmacyPrescription({ companyId: "company", beneficiaryId: "member", category: "CHEMICAL" })).toHaveProperty("prescriptionId", "rx");
  });
  it("keeps company policy mandatory", async () => {
    state.chemicalEnabled = true; state.companyEnabled = false;
    expect(await createPharmacyPrescription({ companyId: "company", beneficiaryId: "member", category: "CHEMICAL" })).toHaveProperty("error");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("blocks an already open prescription after the beneficiary is disabled", async () => {
    expect(await dispensePharmacyPrescriptionItems({ prescriptionId: "rx", items: [{ sequence: 1, price: 10 }], idempotencyKey: "test" })).toMatchObject({ error: "الكيميائي موقوف لهذا المستفيد" });
  });
});
