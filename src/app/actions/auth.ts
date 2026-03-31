"use server";

import prisma from "@/lib/prisma";
import { loginSchema, changePasswordSchema, voluntaryChangePasswordSchema } from "@/lib/validation";
import { login, logout as authLogout, getSession, type ManagerPermissions } from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export async function authenticate(prevState: unknown, formData: FormData) {
  const data = Object.fromEntries(formData);
  const validated = loginSchema.safeParse(data);

  if (!validated.success) {
    return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
  }

  const { username, password } = validated.data;
  let stage = "validate";

  // فحص Rate Limiting قبل أي استعلام للقاعدة
  const rateLimitError = await checkRateLimit(`login:${username}`);
  if (rateLimitError) {
    return { error: rateLimitError };
  }

  try {
    stage = "find-facility";
    const facility = await prisma.facility.findUnique({
      where: { username },
    });

    // مرفق غير موجود أو محذوف
    if (!facility || facility.deleted_at !== null) {
      return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
    }

    stage = "verify-password";
    const passwordMatch = await bcrypt.compare(password, facility.password_hash);

    if (!passwordMatch) {
      return { error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
    }

    // تسجيل دخول ناجح — إعادة تعيين العداد
    await resetRateLimit(`login:${username}`);

    // تسجيل الحدث في سجل المراجعة
    stage = "audit-login";
    await prisma.auditLog.create({
      data: {
        facility_id: facility.id,
        user: facility.username,
        action: "LOGIN",
        metadata: { name: facility.name },
      },
    });

    stage = "create-session";
    await login({
      id: facility.id,
      name: facility.name,
      username: facility.username,
      is_admin: facility.is_admin,
      is_manager: facility.is_manager,
      manager_permissions: facility.manager_permissions as ManagerPermissions | null,
      must_change_password: facility.must_change_password,
    });
  } catch (error) {
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
      stack?: string;
    };

    logger.error("AUTH_LOGIN_FAILED", {
      stage,
      username,
      errorName: err?.name ?? "UnknownError",
      errorCode: err?.code ?? null,
      errorMessage: err?.message ?? "No message",
      nodeEnv: process.env.NODE_ENV,
    });

    if (process.env.NODE_ENV !== "production" && err?.stack) {
      logger.error("AUTH_LOGIN_STACK", { stage, username, stack: err.stack });
    }

    return { error: "حدث خطأ غير متوقع. يرجى المحاولة مجدداً." };
  }

  redirect("/dashboard");
}

export async function changePassword(prevState: unknown, formData: FormData) {
  const session = await getSession();
  if (!session) {
    return { error: "غير مصرح" };
  }

  const data = {
    newPassword: formData.get("newPassword") as string,
    confirmPassword: formData.get("confirmPassword") as string,
  };

  const validated = changePasswordSchema.safeParse(data);
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { newPassword } = validated.data;

  const password_hash = await bcrypt.hash(newPassword, 10);

  await prisma.facility.update({
    where: { id: session.id },
    data: { password_hash, must_change_password: false },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CHANGE_PASSWORD",
    },
  });

  // تحديث الجلسة لإزالة علامة إجبار تغيير كلمة المرور
  await login({
    id: session.id,
    name: session.name,
    username: session.username,
    is_admin: session.is_admin,
    is_manager: session.is_manager,
    manager_permissions: session.manager_permissions,
    must_change_password: false,
  });

  redirect("/dashboard");
}

export async function voluntaryChangePassword(prevState: unknown, formData: FormData) {
  const session = await getSession();
  if (!session) return { error: "غير مصرح" };

  const data = Object.fromEntries(formData);
  const validated = voluntaryChangePasswordSchema.safeParse(data);
  if (!validated.success) {
    return { error: validated.error.issues[0].message };
  }

  const { currentPassword, newPassword } = validated.data;

  const facility = await prisma.facility.findUnique({ where: { id: session.id } });
  if (!facility) return { error: "الحساب غير موجود" };

  const passwordMatch = await bcrypt.compare(currentPassword, facility.password_hash);
  if (!passwordMatch) return { error: "كلمة المرور الحالية غير صحيحة" };

  const password_hash = await bcrypt.hash(newPassword, 10);

  await prisma.facility.update({
    where: { id: session.id },
    data: { password_hash },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CHANGE_PASSWORD",
    },
  });

  return { success: "تم تغيير كلمة المرور بنجاح" };
}

export async function logout() {
  // تسجيل خروج في سجل المراجعة (الجلسة قد لا تكون موجودة دائماً)
  try {
    const session = await getSession();
    if (session) {
      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "LOGOUT",
        },
      });
    }
  } catch {
    // لا نوقف عملية الخروج بسبب خطأ في التسجيل
  }
  await authLogout();
  redirect("/login");
}
