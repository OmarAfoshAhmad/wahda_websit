"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { updateInitialBalanceSchema } from "@/lib/validation";
import { setSystemSetting, SHOW_WAHDA_ALLOCATION_WINDOW_KEY } from "@/lib/system-settings";

export async function updateInitialBalance(prevState: unknown, formData: FormData) {
  const session = await getSessionWithFreshPermissions();
  if (!session || session.role_v2 !== "SUPER_ADMIN") {
    return { error: "غير مصرح بهذه العملية" };
  }

  const parsed = updateInitialBalanceSchema.safeParse({
    initialBalance: formData.get("initialBalance"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const value = parsed.data.initialBalance;

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "SET_INITIAL_BALANCE",
      metadata: {
        value,
        effective_from: new Date().toISOString(),
      },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/beneficiaries");
  revalidateTag("beneficiary-counts", "max");
  revalidatePath("/import");

  return { success: `تم تحديث الرصيد الابتدائي إلى ${value} د.ل`, value };
}

export async function updateOtpSettings(prevState: unknown, formData: FormData) {
  const session = await getSessionWithFreshPermissions();
  if (!session || session.role_v2 !== "SUPER_ADMIN") {
    return { error: "غير مصرح بهذه العملية" };
  }

  const provider = formData.get("provider")?.toString() || "";
  const apiKey = formData.get("apiKey")?.toString() || "";
  const senderId = formData.get("senderId")?.toString() || "";
  const apiUrl = formData.get("apiUrl")?.toString() || "";
  const otpLength = formData.get("otpLength")?.toString() || "6";
  const otpExpiry = formData.get("otpExpiry")?.toString() || "5";
  const facilityName = formData.get("facilityName")?.toString() || "";

  if (!provider) {
    return { error: "مزود الخدمة مطلوب" };
  }

  await setSystemSetting("OTP_PROVIDER", provider, "مزود خدمة الـ OTP");
  await setSystemSetting("OTP_API_KEY", apiKey, "مفتاح API الخاص بـ OTP");
  await setSystemSetting("OTP_SENDER_ID", senderId, "اسم المرسل (Sender ID)");
  await setSystemSetting("OTP_API_URL", apiUrl, "رابط API الخاص بـ OTP");
  await setSystemSetting("OTP_LENGTH", otpLength, "طول رمز التفعيل (OTP)");
  await setSystemSetting("OTP_EXPIRY_MINUTES", otpExpiry, "مدة صلاحية رمز التفعيل (بالدقائق)");
  
  if (facilityName) {
    await setSystemSetting("FACILITY_NAME", facilityName, "اسم المنشأة / التطبيق");
  }

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_OTP_SETTINGS",
      metadata: {
        provider,
        senderId,
      },
    },
  });

  revalidatePath("/settings");

  return { success: "تم تحديث إعدادات OTP بنجاح" };
}

export async function updateWahdaAllocationWindow(prevState: unknown, formData: FormData) {
  const session = await getSessionWithFreshPermissions();
  if (!session || session.role_v2 !== "SUPER_ADMIN") {
    return { error: "هذا الإعداد متاح للمبرمج فقط" };
  }

  const enabled = formData.get("enabled") === "true";
  await setSystemSetting(
    SHOW_WAHDA_ALLOCATION_WINDOW_KEY,
    enabled ? "true" : "false",
    "إظهار رابط ونافذة مخصص مصرف الوحدة داخل المنظومة الموحدة",
  );
  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "UPDATE_WAHDA_ALLOCATION_WINDOW",
      metadata: { enabled },
    },
  });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { success: enabled ? "تم إظهار رابط ونافذة مخصص مصرف الوحدة" : "تم إخفاء رابط ونافذة مخصص مصرف الوحدة بالكامل", enabled };
}

