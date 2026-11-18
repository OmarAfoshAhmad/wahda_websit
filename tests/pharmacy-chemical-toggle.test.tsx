import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PharmacyBeneficiariesPanel } from "@/components/pharmacy/pharmacy-beneficiaries-panel";

const actions = vi.hoisted(() => ({ list: vi.fn(), toggle: vi.fn() }));
vi.mock("@/app/actions/pharmacy-beneficiaries", () => ({ listPharmacyFamilies: actions.list, setBeneficiaryChemicalEnabled: actions.toggle }));
vi.mock("@/app/actions/pharmacy-phone-import", () => ({ importFamilyPhones: vi.fn() }));
vi.mock("@/components/pharmacy/manual-dispense-form", () => ({ ManualDispenseForm: () => null }));
vi.mock("@/components/pharmacy/chronic-last-dispense-form", () => ({ ChronicLastDispenseForm: () => null }));

describe("per-beneficiary chemical switches", () => {
  beforeEach(() => {
    cleanup(); vi.clearAllMocks();
    actions.list.mockResolvedValue({ families: [{
      key: "family", headId: "head", name: "أحمد", cardNumber: "A", hasHeadCard: true,
      phone: null, hasPassword: false, status: "ACTIVE", chronicCount: 0, lastDispenseAt: null,
      members: [
        { id: "head", name: "أحمد", cardNumber: "A", relation: "صاحب البطاقة", status: "ACTIVE", chemicalEnabled: false, chronicCount: 0, lastDispenseAt: null, matched: false },
        { id: "child", name: "سارة", cardNumber: "A1", relation: "ابنة", status: "ACTIVE", chemicalEnabled: false, chronicCount: 0, lastDispenseAt: null, matched: false },
      ],
    }], total: 1, pageSize: 50, stats: null, canManageChemical: true });
    actions.toggle.mockResolvedValue({ success: true, enabled: true });
  });

  it("saves in one click and synchronizes desktop and mobile without changing another member", async () => {
    render(<PharmacyBeneficiariesPanel companyId="company" />);
    const headSwitches = await screen.findAllByRole("switch", { name: "الكيميائي للمستفيد أحمد" });
    expect(headSwitches).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "إظهار أفراد الأسرة" }));
    fireEvent.click(headSwitches[0]);
    await waitFor(() => expect(actions.toggle).toHaveBeenCalledWith("head", true));
    await waitFor(() => screen.getAllByRole("switch", { name: "الكيميائي للمستفيد أحمد" }).forEach((element) => expect(element).toHaveAttribute("aria-checked", "true")));
    screen.getAllByRole("switch", { name: "الكيميائي للمستفيد سارة" }).forEach((element) => expect(element).toHaveAttribute("aria-checked", "false"));
  });

  it("keeps the saved state unchanged and shows a server error", async () => {
    actions.toggle.mockResolvedValue({ error: "غير مصرح" });
    render(<PharmacyBeneficiariesPanel companyId="company" />);
    fireEvent.click((await screen.findAllByRole("switch", { name: "الكيميائي للمستفيد أحمد" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("غير مصرح");
    screen.getAllByRole("switch", { name: "الكيميائي للمستفيد أحمد" }).forEach((element) => expect(element).toHaveAttribute("aria-checked", "false"));
  });
});
