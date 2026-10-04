import sharp from "sharp";

export type ConvertedAttachment = { bytes: Buffer; mime: "image/webp" | "application/pdf"; extension: ".webp" | ".pdf" };

const MAX_DIMENSION = 2400;
const WEBP_QUALITY = 80;
// دقة عرض صفحة PDF قبل تحويلها: 2× تكفي لقراءة الوصفة والبطاقة بوضوح.
const PDF_RENDER_SCALE = 2;

async function imageToWebp(bytes: Buffer) {
  return sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

/** يعرض الصفحة الأولى إن كان الملف صفحة واحدة؛ ويعيد null للملف متعدد الصفحات ليبقى PDF. */
async function renderSinglePagePdf(bytes: Buffer): Promise<Buffer | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false });
  const document = await loadingTask.promise;
  try {
    if (document.numPages !== 1) return null;
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * سياسة التخزين: الصور (JPG/PNG/WEBP) تُحوَّل إلى webp، وPDF من صفحة واحدة يُحوَّل إلى webp،
 * وPDF متعدد الصفحات يبقى كما هو.
 */
export async function convertPharmacyAttachment(bytes: Buffer, detectedMime: string): Promise<ConvertedAttachment> {
  if (detectedMime === "application/pdf") {
    const rendered = await renderSinglePagePdf(bytes);
    if (!rendered) return { bytes, mime: "application/pdf", extension: ".pdf" };
    return { bytes: await imageToWebp(rendered), mime: "image/webp", extension: ".webp" };
  }
  return { bytes: await imageToWebp(bytes), mime: "image/webp", extension: ".webp" };
}
