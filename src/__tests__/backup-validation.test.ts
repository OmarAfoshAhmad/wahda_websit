import { describe, expect, it } from "vitest";
import { backupSchema } from "@/lib/backup-validation";

const baseBackup = {
  exported_at: "2026-07-15T00:00:00.000Z",
  includes_sensitive: true,
  data: {
    users: [],
    providers: [],
    transactions: [],
    audit_logs: [],
    notifications: [],
  },
};

describe("backupSchema", () => {
  it("keeps legacy 1.0 backups compatible", () => {
    const parsed = backupSchema.parse({ ...baseBackup, version: "1.0" });
    expect(parsed.version).toBe("1.0");
    expect(parsed.data.family_import_archive).toBeUndefined();
  });

  it("validates the family import archive in 1.1 backups", () => {
    const parsed = backupSchema.parse({
      ...baseBackup,
      version: "1.1",
      data: {
        ...baseBackup.data,
        family_import_archive: [{
          family_base_card: "WAB2025001234",
          family_count_from_file: 4,
          total_balance_from_file: 2400,
          used_balance_from_file: 550.5,
          source_row_number: 10,
          imported_by: "admin",
          last_imported_at: "2026-07-15T00:00:00.000Z",
          created_at: "2026-07-15T00:00:00.000Z",
          updated_at: "2026-07-15T00:00:00.000Z",
          source_file_name: "claims.xlsx",
        }],
      },
    });
    expect(parsed.data.family_import_archive).toHaveLength(1);
    expect(parsed.data.family_import_archive?.[0].used_balance_from_file).toBe(550.5);
  });
});
