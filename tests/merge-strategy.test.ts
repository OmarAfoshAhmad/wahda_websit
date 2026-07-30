import { describe, expect, it } from "vitest";
import { pickKeepByStrategy } from "@/app/actions/beneficiary/utils";

const candidates = [
  { id: "with-zeros", card_number: "JMR202500026333", remaining_balance: 3000, tx_count: 0 },
  { id: "without-zeros", card_number: "JMR202526333", remaining_balance: 2500, tx_count: 7 },
];

describe("pickKeepByStrategy", () => {
  it("keeps the card with zeros for ZERO_PRIORITY", () => {
    expect(pickKeepByStrategy(candidates, "ZERO_PRIORITY")?.id).toBe("with-zeros");
  });

  it("keeps the clean card without leading zeros for NON_ZERO_PRIORITY", () => {
    expect(pickKeepByStrategy(candidates, "NON_ZERO_PRIORITY")?.id).toBe("without-zeros");
  });

  it("keeps the lowest balance for LOWEST_BALANCE", () => {
    expect(pickKeepByStrategy(candidates, "LOWEST_BALANCE")?.id).toBe("without-zeros");
  });

  it("keeps the record with the most transactions for HIGHEST_TRANSACTIONS", () => {
    expect(pickKeepByStrategy(candidates, "HIGHEST_TRANSACTIONS")?.id).toBe("without-zeros");
  });
});
