import { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/auth";
import { jwtVerify } from "jose";

const publicRoutes = ["/login", "/api/login"];
const beneficiaryPublicRoutes = ["/beneficiary/login", "/beneficiary/setup-pin"];
const publicPrefixes = ["/check"];

/**
 * Proxy خفيف — يفحص JWT فقط ولا يستعلم من قاعدة البيانات.
 * فحص حالة الحذف الناعم يتم عبر session-guard.ts في العمليات الحساسة.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublicRoute =
    publicRoutes.includes(path) || publicPrefixes.some((p) => path === p || path.startsWith(p + "/"));

  const cookie = req.cookies.get("session")?.value;
  let session: { id: string; is_admin?: boolean; must_change_password?: boolean } | null = null;

  if (cookie) {
    try {
      session = (await decrypt(cookie)) as unknown as {
        id: string;
        is_admin?: boolean;
        must_change_password?: boolean;
      };
    } catch {
      // رمز الجلسة غير صالح
    }
  }

  // مسارات المستفيد — جلسة مختلفة (ben_session)
  if (path.startsWith("/beneficiary")) {
    if (beneficiaryPublicRoutes.includes(path)) {
      return NextResponse.next();
    }
    const benCookie = req.cookies.get("ben_session")?.value;
    if (!benCookie) {
      return NextResponse.redirect(new URL("/beneficiary/login", req.nextUrl));
    }
    try {
      const secret = process.env.BENEFICIARY_JWT_SECRET || process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET not set");
      const key = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(benCookie, key, { algorithms: ["HS256"] });
      if (payload.type !== "beneficiary") throw new Error();
    } catch {
      return NextResponse.redirect(new URL("/beneficiary/login", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // المسارات العامة التي تظل متاحة حتى للمسجلين (لا توجيه)
  const alwaysPublic = publicPrefixes.some((p) => path === p || path.startsWith(p + "/"));

  if (isPublicRoute && session && !alwaysPublic) {
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

  // تجديد الجلسة (sliding window) لمنع انتهاء صلاحيتها أثناء الاستخدام
  if (cookie && session) {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const refreshed = await encrypt({ ...session, expires });
    const res = NextResponse.next();
    res.cookies.set({
      name: "session",
      value: refreshed,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$|.*\\.ico$|.*\\.css$|.*\\.js$).*)",
  ],
};
