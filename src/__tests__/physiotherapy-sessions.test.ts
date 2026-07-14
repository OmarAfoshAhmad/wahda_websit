import { describe, expect, it } from "vitest";
import { calculatePhysiotherapySessions, parsePhysiotherapySessionCount } from "@/lib/physiotherapy-sessions";

describe("calculatePhysiotherapySessions", () => {
  it("reads sessions from an explicit note and never from a financial value", () => {
    expect(parsePhysiotherapySessionCount(null, "10 جلسات")).toBe(10);
    expect(parsePhysiotherapySessionCount(null, "10")).toBe(10);
    expect(parsePhysiotherapySessionCount(null, "القيمة المالية 558.75")).toBe(0);
  });

  it("counts every session without applying a financial coverage percentage", () => {
    const result = calculatePhysiotherapySessions({ sessions: 10, consumedBefore: 0, limit: 20 });

    expect(result.consumedAfter).toBe(10);
    expect(result.remainingAfter).toBe(10);
    expect(result.exceededSessions).toBe(0);
  });

  it("reports only the number of sessions above the configured session limit", () => {
    const result = calculatePhysiotherapySessions({ sessions: 20, consumedBefore: 10, limit: 20 });

    expect(result.consumedAfter).toBe(30);
    expect(result.remainingBefore).toBe(10);
    expect(result.remainingAfter).toBe(0);
    expect(result.exceededSessions).toBe(10);
  });

  it("supports an unlimited session policy", () => {
    const result = calculatePhysiotherapySessions({ sessions: 20, consumedBefore: 30, limit: null });

    expect(result.consumedAfter).toBe(50);
    expect(result.remainingBefore).toBeNull();
    expect(result.exceededSessions).toBe(0);
  });

  it("rejects fractional session counts", () => {
    expect(() => calculatePhysiotherapySessions({ sessions: 7.5, consumedBefore: 0, limit: 20 }))
      .toThrow("عدداً صحيحاً");
  });
});
