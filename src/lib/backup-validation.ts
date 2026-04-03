import { z } from "zod";

function normalizeTransactionType(value: unknown): unknown {
  if (typeof value === "number") {
    if (value === 1) return "MEDICINE";
    if (value === 2) return "SUPPLIES";
    return value;
  }

  if (typeof value !== "string") return value;

  const v = value.trim().toUpperCase();

  const medicineAliases = new Set([
    "MEDICINE",
    "MEDICATION",
    "MEDICINES",
    "MED",
    "MEDS",
    "DRUG",
    "DRUGS",
    "DOAA",
    "DOA",
    "DWA",
    "DWAYA",
    "ADWIA",
    "DOUAA",
    "\u062F\u0648\u0627\u0621",
    "\u062F\u0648\u0627\u0621\u0020",
    "\u062F\u0648\u0627\u0621\u0020\u0637\u0628\u064A",
    "\u0627\u062F\u0648\u064A\u0629",
    "\u0623\u062F\u0648\u064A\u0629",
    "\u0639\u0644\u0627\u062C",
  ]);

  const suppliesAliases = new Set([
    "SUPPLIES",
    "SUPPLY",
    "MATERIAL",
    "MATERIALS",
    "EQUIPMENT",
    "TOOLS",
    "CONSUMABLES",
    "\u0645\u0633\u062A\u0644\u0632\u0645\u0627\u062A",
    "\u0645\u0633\u062A\u0644\u0632\u0645",
  ]);

  const importAliases = new Set([
    "IMPORT",
    "IMPORTED",
    "INITIAL",
    "OPENING",
    "OPENING_BALANCE",
    "BALANCE_IMPORT",
    "\u0627\u0633\u062A\u064A\u0631\u0627\u062F",
    "\u0631\u0635\u064A\u062F\u0020\u0645\u0633\u062A\u0648\u0631\u062F",
    "\u0631\u0635\u064A\u062F\u0020\u0645\u0633\u062A\u062E\u062F\u0645",
  ]);

  const cancellationAliases = new Set([
    "CANCELLATION",
    "CANCELLED",
    "CANCEL",
    "REVERSAL",
    "REVERSE",
    "إلغاء",
    "الغاء",
    "ملغي",
    "ملغاة",
  ]);

  if (medicineAliases.has(v)) return "MEDICINE";
  if (suppliesAliases.has(v)) return "SUPPLIES";
  if (importAliases.has(v)) return "IMPORT";
  if (cancellationAliases.has(v)) return "CANCELLATION";

  return value;
}

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  password_hash: z.string().nullable().optional(),
  is_admin: z.boolean().optional().default(false),
  must_change_password: z.boolean().optional().default(false),
  deleted_at: z.string().nullable().optional(),
  created_at: z.string(),
});

const providerSchema = z.object({
  id: z.string(),
  card_number: z.string(),
  name: z.string(),
  birth_date: z.string().nullable().optional(),
  total_balance: z.number(),
  remaining_balance: z.number(),
  status: z.enum(["ACTIVE", "FINISHED", "SUSPENDED"]),
  pin_hash: z.string().nullable().optional(),
  failed_attempts: z.number().optional().default(0),
  locked_until: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  created_at: z.string(),
});

const transactionSchema = z.object({
  id: z.string(),
  beneficiary_id: z.string(),
  facility_id: z.string(),
  amount: z.number(),
  type: z.preprocess(normalizeTransactionType, z.enum(["MEDICINE", "SUPPLIES", "IMPORT", "CANCELLATION"])),
  is_cancelled: z.boolean().optional().default(false),
  original_transaction_id: z.string().nullable().optional(),
  created_at: z.string(),
});

const auditLogSchema = z.object({
  id: z.string(),
  facility_id: z.string().nullable().optional(),
  user: z.string(),
  action: z.string(),
  metadata: z.any().optional(),
  created_at: z.string(),
});

const notificationSchema = z.object({
  id: z.string(),
  beneficiary_id: z.string(),
  title: z.string(),
  message: z.string(),
  amount: z.number().nullable().optional(),
  is_read: z.boolean().optional().default(false),
  created_at: z.string(),
});

export const backupSchema = z.object({
  version: z.literal("1.0"),
  exported_at: z.string(),
  created_by: z.string().optional(),
  includes_sensitive: z.boolean(),
  data: z.object({
    users: z.array(userSchema),
    providers: z.array(providerSchema),
    transactions: z.array(transactionSchema),
    audit_logs: z.array(auditLogSchema),
    notifications: z.array(notificationSchema),
  }),
});

export type BackupData = z.infer<typeof backupSchema>;
