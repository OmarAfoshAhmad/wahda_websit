import { NextRequest, NextResponse } from "next/server";
import { decrypt } from "@/lib/auth";

const publicRoutes = ["/login", "/api/login"];

/**
 * Middleware خفيف — يفحص JWT فقط ولا يستعلم من قاعدة البيانات.
 * فحص حالة الحذف الناعم يتم عبر session-guard.ts في العمليات الحساسة.
 */
export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublicRoute = publicRoutes.includes(path);

  const cookie = req.cookies.get("session")?.value;
  let session: { id: string; is_admin?: boolean; must_change_password?: boolean } | null = null;

  if (cookie) {
    try {
      session = await decrypt(cookie) as unknown as { id: string; is_admin?: boolean; must_change_password?: boolean };
    } catch {
      // رمز الجلسة غير صالح
    }
  }

  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (isPublicRoute && session) {
    if (session.must_change_password) {
      return NextResponse.redirect(new URL("/change-password", req.nextUrl));
    }
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // إجبار المستخدم على تغيير كلمة المرور قبل أي صفحة أخرى
  if (session?.must_change_password && path !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }

  // إذا لم يكن بحاجة لتغيير كلمة المرور لا يُسمح بالوصول لصفحة الإجبار
  if (path === "/change-password" && session && !session.must_change_password) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // حماية مسارات /admin للمشرفين فقط
  if (path.startsWith("/admin") && !session?.is_admin) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$|.*\\.ico$|.*\\.css$|.*\\.js$).*)"],
};
