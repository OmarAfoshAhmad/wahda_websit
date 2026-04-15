"use server";

import prisma from "@/lib/prisma";
import { loginSchema, changePasswordSchema, voluntaryChangePasswordSchema } from "@/lib/validation";
import { login, logout as authLogout, getSession, type ManagerPermissions } from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null
  );
}

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
      select: {
        id: true,
        name: true,
        username: true,
        password_hash: true,
        deleted_at: true,
        is_admin: true,
        is_manager: true,
        manager_permissions: true,
        must_change_password: true,
      },
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
    try {
      const loginIp = await getClientIp();
      await prisma.auditLog.create({
        data: {
          facility_id: facility.id,
          user: facility.username,
          action: "LOGIN",
          ip_address: loginIp,
          metadata: { name: facility.name },
        },
      });
    } catch (auditError) {
      logger.warn("AUTH_LOGIN_AUDIT_FAILED", {
        username,
        error: String(auditError),
      });
    }

    stage = "create-session";
    await login({
      id: facility.id,
      name: facility.name,
      username: facility.username,
      is_admin: facility.is_admin,
      is_manager: facility.is_manager,
      is_employee: !(facility.is_admin || facility.is_manager),
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

  const changeIp = await getClientIp();
  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CHANGE_PASSWORD",
      ip_address: changeIp,
    },
  });

  // تحديث الجلسة لإزالة علامة إجبار تغيير كلمة المرور
  await login({
    id: session.id,
    name: session.name,
    username: session.username,
    is_admin: session.is_admin,
    is_manager: session.is_manager,
    is_employee: Boolean(session.is_employee),
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

  const facility = await prisma.facility.findUnique({
    where: { id: session.id },
    select: { id: true, password_hash: true },
  });
  if (!facility) return { error: "الحساب غير موجود" };

  const passwordMatch = await bcrypt.compare(currentPassword, facility.password_hash);
  if (!passwordMatch) return { error: "كلمة المرور الحالية غير صحيحة" };

  const password_hash = await bcrypt.hash(newPassword, 10);

  await prisma.facility.update({
    where: { id: session.id },
    data: { password_hash },
  });

  const voluntaryChangeIp = await getClientIp();
  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "CHANGE_PASSWORD",
      ip_address: voluntaryChangeIp,
    },
  });

  return { success: "تم تغيير كلمة المرور بنجاح" };
}

export async function logout() {
  // تسجيل خروج في سجل المراجعة (الجلسة قد لا تكون موجودة دائماً)
  try {
    const session = await getSession();
    if (session) {
      const logoutIp = await getClientIp();
      await prisma.auditLog.create({
        data: {
          facility_id: session.id,
          user: session.username,
          action: "LOGOUT",
          ip_address: logoutIp,
        },
      });
    }
  } catch (error: unknown) {
    // سجل الخطأ لكن لا توقف عملية الخروج
    const { logger } = await import("@/lib/logger");
    logger.warn("Logout audit log failed", { error: String(error) });
  }
  await authLogout();
  redirect("/login");
}
