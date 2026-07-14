import { describe, expect, it } from "vitest";
import {
  dateOnlyIso,
  importedTransactionKey,
  importedTransactionStablePrefix,
} from "@/lib/service-transaction-date-update";

describe("service transaction date update keys", () => {
  const row = {
    rowNumber: 12,
    card: "jfz 202534408",
    amount: 558.75,
    date: new Date("2026-04-07T00:00:00.000Z"),
  };

  it("builds the same stable prefix format used by the physiotherapy importer", () => {
    expect(importedTransactionStablePrefix("import-physiotherapy-tx", row)).toBe(
      "import-physiotherapy-tx:12:JFZ 202534408:558.75:",
    );
  });

  it("changes only the date suffix when a corrected date is supplied", () => {
    expect(importedTransactionKey("import-physiotherapy-tx", row)).toBe(
      "import-physiotherapy-tx:12:JFZ 202534408:558.75:2026-04-07",
    );
  });

  it("formats a UTC date without a timezone day shift", () => {
    expect(dateOnlyIso(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06-01");
  });
});
