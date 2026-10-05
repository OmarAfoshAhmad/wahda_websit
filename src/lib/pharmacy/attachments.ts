import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PharmacyAttachmentKind } from "@prisma/client";
import { convertPharmacyAttachment } from "@/lib/pharmacy/attachment-conversion";

// تخزين مرفقات الصيدلية (البطاقة والوصفة ومرفقات المحادثة). مكتبة خادم فقط وليست server action.
export const ATTACHMENT_KINDS: PharmacyAttachmentKind[] = ["INSURANCE_CARD", "PRESCRIPTION"];
export const ATTACHMENT_LABELS: Record<PharmacyAttachmentKind, string> = { INSURANCE_CARD: "صورة البطاقة التأمينية", PRESCRIPTION: "صورة الوصفة" };
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** يحدد نوع الملف من محتواه الفعلي لا من الامتداد أو نوع المتصفح. */
function sniffFileType(bytes: Buffer): { mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp" };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf" };
  return null;
}

function sanitizeFileName(name: string) {
  return name.replace(/[\\/\u0000-\u001f<>:"|?*]+/g, "_").slice(0, 120) || "file";
}

export type StoredFile = { kind: PharmacyAttachmentKind; fileName: string; mime: string; size: number; storagePath: string; absolutePath: string };

export async function storeAttachmentFile(file: File, kind: PharmacyAttachmentKind): Promise<StoredFile | { error: string }> {
  if (file.size === 0) return { error: `أرفق ${ATTACHMENT_LABELS[kind]}` };
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: `حجم ${ATTACHMENT_LABELS[kind]} يجب ألا يتجاوز 8 ميجابايت` };
  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = sniffFileType(bytes);
  if (!detected) return { error: `${ATTACHMENT_LABELS[kind]}: يسمح فقط بملفات PDF أو صور JPG وPNG وWEBP` };

  let converted;
  try {
    converted = await convertPharmacyAttachment(bytes, detected.mime);
  } catch {
    return { error: `${ATTACHMENT_LABELS[kind]}: تعذرت قراءة الملف، تأكد أنه غير تالف` };
  }

  const directory = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "pharmacy-prescriptions");
  await mkdir(directory, { recursive: true });
  const storedName = `${randomUUID()}${converted.extension}`;
  const absolutePath = path.join(directory, storedName);
  await writeFile(absolutePath, converted.bytes);
  const baseName = sanitizeFileName(file.name).replace(/\.[^.]+$/, "");
  return {
    kind,
    fileName: `${baseName}${converted.extension}`,
    mime: converted.mime,
    size: converted.bytes.length,
    storagePath: path.join("storage", "pharmacy-prescriptions", storedName),
    absolutePath,
  };
}
