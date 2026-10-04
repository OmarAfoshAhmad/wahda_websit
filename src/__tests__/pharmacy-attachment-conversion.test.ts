// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertPharmacyAttachment } from "@/lib/pharmacy/attachment-conversion";

// PDF بسيط بعدد صفحات محدد؛ pdf.js يعيد بناء جدول xref عند غيابه.
function buildPdf(pageCount: number) {
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 R`).join(" ");
  const pages = Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj`).join("\n");
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pageCount} >> endobj\n${pages}\ntrailer << /Root 1 0 R >>\n%%EOF`);
}

describe("pharmacy attachment conversion", () => {
  it("converts PNG images to webp", async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#336699" } }).png().toBuffer();
    const result = await convertPharmacyAttachment(png, "image/png");
    expect(result.mime).toBe("image/webp");
    expect((await sharp(result.bytes).metadata()).format).toBe("webp");
  });

  it("converts a single-page PDF to webp", async () => {
    const result = await convertPharmacyAttachment(buildPdf(1), "application/pdf");
    expect(result.mime).toBe("image/webp");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(400);
  });

  it("keeps a multi-page PDF as PDF", async () => {
    const pdf = buildPdf(2);
    const result = await convertPharmacyAttachment(pdf, "application/pdf");
    expect(result.mime).toBe("application/pdf");
    expect(result.bytes.equals(pdf)).toBe(true);
  });
});
