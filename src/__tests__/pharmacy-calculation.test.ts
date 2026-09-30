import { describe, expect, it } from "vitest";
import { calculatePharmacyDispense, getPharmacyPolicyWindow } from "@/lib/pharmacy/calculation";

describe("pharmacy calculation", () => {
  it("calculates four routine prescription prices without floating point drift", () => {
    const result = calculatePharmacyDispense({
      items: [35, 18.5, 42, 12].map((price, index) => ({ sequence: index + 1, price })),
      defaultCoveragePercent: 80,
      ceilingAmount: 500,
      consumedBefore: 200,
    });
    expect(result.itemCount).toBe(4);
    expect(result.grossTotal.toFixed(2)).toBe("107.50");
    expect(result.companyTotal.toFixed(2)).toBe("86.00");
    expect(result.patientTotal.toFixed(2)).toBe("21.50");
    expect(result.remainingAfter?.toFixed(2)).toBe("214.00");
  });

  it("applies sequence coverage and moves ceiling overflow to the patient", () => {
    const result = calculatePharmacyDispense({
      items: [100, 100, 100, 100].map((price, index) => ({ sequence: index + 1, price })),
      defaultCoveragePercent: 80,
      sequenceRules: [
        { from: 1, to: 1, coveragePercent: 100 },
        { from: 2, to: 2, coveragePercent: 80 },
        { from: 3, to: 3, coveragePercent: 70 },
        { from: 4, to: null, coveragePercent: 50 },
      ],
      ceilingAmount: 250,
      consumedBefore: 0,
    });
    expect(result.companyTotal.toFixed(2)).toBe("250.00");
    expect(result.patientTotal.toFixed(2)).toBe("150.00");
    expect(result.items[3].companyShare.toFixed(2)).toBe("0.00");
  });

  it("tracks consumption with an open ceiling", () => {
    const result = calculatePharmacyDispense({
      items: [{ sequence: 1, price: "100.00" }], defaultCoveragePercent: 75,
      ceilingAmount: null, consumedBefore: "900.00",
    });
    expect(result.remainingBefore).toBeNull();
    expect(result.remainingAfter).toBeNull();
    expect(result.ceilingConsumption.toFixed(2)).toBe("75.00");
    expect(result.consumedAfter.toFixed(2)).toBe("975.00");
  });

  it("uses calendar policy periods for monthly and annual renewal", () => {
    const monthly = getPharmacyPolicyWindow(new Date("2026-09-25T12:00:00Z"), 1);
    const annual = getPharmacyPolicyWindow(new Date("2026-09-25T12:00:00Z"), 12);
    expect(monthly.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(monthly.end.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(annual.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(annual.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
