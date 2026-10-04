import { describe, expect, it } from "vitest";
import { calculatePharmacyDispense } from "@/lib/pharmacy/calculation";
import { getNextChronicEligibleDate, getPolicyYearWindow, getTripoliDayWindow, isChronicDrugEligible, resolvePharmacyCategoryPolicy } from "@/lib/pharmacy/policy";

describe("pharmacy policy time rules", () => {
  it("resets the daily window at Tripoli midnight, not UTC midnight", () => {
    // 23:30 UTC on Oct 3 is 01:30 on Oct 4 in Tripoli.
    const window = getTripoliDayWindow(new Date("2026-10-03T23:30:00Z"));
    expect(window.start.toISOString()).toBe("2026-10-03T22:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });

  it("computes the insurance year from the configured start month", () => {
    const window = getPolicyYearWindow(new Date("2026-02-10T10:00:00Z"), 4);
    expect(window.start.toISOString()).toBe("2025-03-31T22:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-31T22:00:00.000Z");
  });

  it("allows a chronic drug again only after the full interval in Tripoli days", () => {
    const last = new Date("2026-09-01T20:00:00Z"); // Sep 1, 22:00 Tripoli
    expect(getNextChronicEligibleDate(last, 28).toISOString()).toBe("2026-09-28T22:00:00.000Z"); // Sep 29 00:00 Tripoli
    expect(isChronicDrugEligible(last, 28, new Date("2026-09-28T21:59:00Z"))).toBe(false);
    expect(isChronicDrugEligible(last, 28, new Date("2026-09-28T22:00:00Z"))).toBe(true);
    expect(isChronicDrugEligible(null, 28, new Date())).toBe(true);
  });

  it("resolves category coverage with fallback to the service coverage", () => {
    const config = {
      routine_enabled: true, chronic_enabled: true, chemical_enabled: false,
      routine_ceiling: 300, chronic_ceiling: null, chemical_ceiling: 1000,
      routine_coverage_percent: null, chronic_coverage_percent: 90, chemical_coverage_percent: null,
      routine_daily_limit: 2, chemical_daily_limit: 3, chronic_interval_days: 28, policy_year_start_month: 1,
    };
    const policy = { ceiling_amount: 1500, coverage_percent: 80 };
    expect(resolvePharmacyCategoryPolicy(policy, config, "ROUTINE")).toMatchObject({ categoryCeiling: 300, overallCeiling: 1500, coveragePercent: 80, dailyLimit: 2 });
    expect(resolvePharmacyCategoryPolicy(policy, config, "CHRONIC")).toMatchObject({ categoryCeiling: null, coveragePercent: 90, dailyLimit: null });
    expect(resolvePharmacyCategoryPolicy(policy, config, "CHEMICAL")).toMatchObject({ enabled: false, dailyLimit: 3 });
  });
});

describe("pharmacy gross ceiling within the overall ceiling", () => {
  it("consumes the ceiling by gross price and caps by the smaller of category and overall remaining", () => {
    const result = calculatePharmacyDispense({
      items: [{ sequence: 1, price: 100 }, { sequence: 2, price: 100 }],
      defaultCoveragePercent: 80,
      ceilingBasis: "GROSS",
      ceilingAmount: 500, // category: 500 remaining
      consumedBefore: 0,
      additionalCeilings: [{ ceilingAmount: 1000, consumedBefore: 850 }], // overall: 150 remaining
    });
    expect(result.remainingBefore?.toFixed(2)).toBe("150.00");
    expect(result.items[0].companyShare.toFixed(2)).toBe("80.00");
    // Only 50 of the second item fits under the ceiling: company pays 80% of 50.
    expect(result.items[1].companyShare.toFixed(2)).toBe("40.00");
    expect(result.patientTotal.toFixed(2)).toBe("80.00");
    expect(result.ceilingConsumption.toFixed(2)).toBe("150.00");
    expect(result.remainingAfter?.toFixed(2)).toBe("0.00");
  });

  it("has no cap when neither ceiling is set", () => {
    const result = calculatePharmacyDispense({
      items: [{ sequence: 1, price: 40 }],
      defaultCoveragePercent: 75,
      ceilingBasis: "GROSS",
      ceilingAmount: null,
      consumedBefore: 0,
      additionalCeilings: [{ ceilingAmount: null, consumedBefore: 0 }],
    });
    expect(result.companyTotal.toFixed(2)).toBe("30.00");
    expect(result.remainingAfter).toBeNull();
  });
});
