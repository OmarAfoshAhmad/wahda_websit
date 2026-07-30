import { describe, expect, it } from "vitest";
import {
  BASE_BALANCE_EXCLUDED_TRANSACTION_TYPES,
  calculateBaseRemaining,
} from "../lib/base-balance-ledger";

describe("base balance ledger", () => {
  it("keeps independent service wallets outside the base ceiling", () => {
    expect(BASE_BALANCE_EXCLUDED_TRANSACTION_TYPES).toEqual([
      "CANCELLATION",
      "DENTAL",
      "OPTICS",
      "PHYSIOTHERAPY",
    ]);
  });

  it("calculates remaining from the fixed ceiling and never below zero", () => {
    expect(calculateBaseRemaining(3000, 2860)).toBe(140);
    expect(calculateBaseRemaining(3000, 3500)).toBe(0);
  });
});
