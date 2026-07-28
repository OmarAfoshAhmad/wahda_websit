import { describe, expect, it } from "vitest";

import { canonicalizeCardNumber, leadingZeroScoreAfterPrefix } from "@/lib/normalize";
import { buildDuplicateGroups } from "@/lib/duplicate-groups";

describe("multi-company card normalization", () => {
  it("normalizes leading zero variants for WAB and JFZ prefixes", () => {
    expect(canonicalizeCardNumber("WAB202500123D1")).toBe("WAB2025123D1");
    expect(canonicalizeCardNumber("JFZ202500123D1")).toBe("JFZ2025123D1");
    expect(leadingZeroScoreAfterPrefix("JFZ202500123D1")).toBe(2);
  });

  it("detects JFZ zero variants and same-name problems", () => {
    const rows = [
      { id: "1", name: "مستفيد أول", card_number: "JFZ202500123", birth_date: null, status: "ACTIVE", total_balance: 100, remaining_balance: 100 },
      { id: "2", name: "مستفيد أول", card_number: "JFZ2025123", birth_date: null, status: "ACTIVE", total_balance: 100, remaining_balance: 100 },
      { id: "3", name: "اسم متكرر", card_number: "JFZ2025456", birth_date: null, status: "ACTIVE", total_balance: 100, remaining_balance: 100 },
      { id: "4", name: "اسم متكرر", card_number: "JFZ2025789", birth_date: null, status: "ACTIVE", total_balance: 100, remaining_balance: 100 },
    ];

    const result = buildDuplicateGroups(rows);
    expect(result.zeroVariantGroups).toHaveLength(1);
    expect(result.zeroVariantGroups[0].canonical).toBe("JFZ2025123");
    expect(result.sameNameGroups).toHaveLength(1);
  });
});
