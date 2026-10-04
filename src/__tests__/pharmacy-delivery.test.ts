import { describe, expect, it } from "vitest";
import { deliveryQuote, distanceKm, isOpenNow } from "@/lib/pharmacy/delivery";

describe("pharmacy delivery", () => {
  it("measures distance between two Benghazi points", () => {
    const km = distanceKm({ latitude: 32.1167, longitude: 20.0667 }, { latitude: 32.0833, longitude: 20.1 });
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(5.5);
  });

  it("prices delivery as base plus per-km, rounded up to a quarter dinar", () => {
    expect(deliveryQuote({ enabled: true, baseFee: 5, perKm: 1.1, maxKm: 20 }, 3)).toEqual({ available: true, fee: 8.5 });
    expect(deliveryQuote({ enabled: true, baseFee: 10, perKm: 0, maxKm: null }, null)).toEqual({ available: true, fee: 10 });
  });

  it("refuses delivery when disabled, out of range, or location is unknown for distance pricing", () => {
    expect(deliveryQuote({ enabled: false, baseFee: 5, perKm: 0, maxKm: null }, 1).available).toBe(false);
    expect(deliveryQuote({ enabled: true, baseFee: 5, perKm: 1, maxKm: 10 }, 12).available).toBe(false);
    expect(deliveryQuote({ enabled: true, baseFee: 5, perKm: 1, maxKm: 10 }, null).available).toBe(false);
  });

  it("checks opening hours in Tripoli time, including shifts past midnight", () => {
    // 07:30 UTC = 09:30 Tripoli
    expect(isOpenNow("09:00", "22:00", new Date("2026-10-04T07:30:00Z"))).toBe(true);
    expect(isOpenNow("10:00", "22:00", new Date("2026-10-04T07:30:00Z"))).toBe(false);
    // 23:00 UTC = 01:00 Tripoli
    expect(isOpenNow("18:00", "02:00", new Date("2026-10-04T23:00:00Z"))).toBe(true);
    expect(isOpenNow(null, null)).toBe(true);
  });
});
