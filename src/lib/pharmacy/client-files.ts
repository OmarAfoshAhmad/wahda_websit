// تجهيز ملفات الصيدلية في المتصفح قبل الرفع (نافذة الصرف ومحادثة الطلبات).
export const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const MAX_IMAGE_DIMENSION = 2400;

/**
 * يجهز الملف قبل الإرسال: الصور تُصغَّر وتُحوَّل إلى webp في المتصفح (صور الجوال تصبح عادة أقل من 1 ميجابايت)،
 * وملفات PDF تُرسل كما هي. يعيد رسالة خطأ إن كان الملف غير مقبول.
 */
export async function prepareFile(file: File): Promise<{ file: File } | { error: string }> {
  if (!ACCEPTED_FILES.split(",").includes(file.type)) return { error: "يسمح فقط بملفات PDF أو صور JPG وPNG وWEBP" };
  let prepared = file;
  if (file.type.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
      if (blob && blob.type === "image/webp" && blob.size < file.size) {
        prepared = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
      }
    } catch {
      // إن تعذر الضغط في المتصفح يُرسل الملف الأصلي ويتولى الخادم تحويله.
    }
  }
  if (prepared.size > MAX_FILE_BYTES) return { error: "حجم الملف يجب ألا يتجاوز 8 ميجابايت" };
  return { file: prepared };
}
