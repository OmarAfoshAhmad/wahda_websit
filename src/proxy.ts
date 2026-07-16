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
  let session: any = null;

  if (cookie) {
    try {
      session = await decrypt(cookie);
    } catch {
      // Invalid session cookie
    }
  }

  // Beneficiary routes - separate session logic (ben_session)
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

  // Auth protection for health facility routes
  if (!isPublicRoute && !session) {
    const loginUrl = new URL("/login", req.nextUrl);
    // If it's a data request, we should still redirect but Next.js might need a specific response
    return NextResponse.redirect(loginUrl);
  }

  // Routes that stay public even for logged-in users (e.g. health checks)
  const alwaysPublic = publicPrefixes.some((p) => path === p || path.startsWith(p + "/"));

  // if (isPublicRoute && session && !alwaysPublic) {
  //   if (session.must_change_password) {
  //     return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  //   }
  //   return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  // }

  // Force password change before accessing other pages
  if (session?.must_change_password && path !== "/change-password" && !path.startsWith("/api")) {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }

  // Don't allow access to change-password if not required
  if (path === "/change-password" && session && !session.must_change_password) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // Protect /admin routes for admins only
  // if (path.startsWith("/admin") && !session?.is_admin) {
  //   return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  // }

  // تجديد الجلسة (sliding window)
  // نمنعها في طلبات POST (Server Actions) لمنع تعارض تعديل الكوكيز
  if (cookie && session && req.method !== "POST") {
    try {
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      // إزالة manager_permissions لتقليص حجم الكوكي (يمنع خطأ Header Too Large / 502)
      // وإزالة حقول JWT القياسية
      const { exp, iat, jti, nbf, manager_permissions, ...cleanSession } = session as any;
      
      const refreshed = await encrypt(cleanSession);
      
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
    } catch (err) {
      console.error("PROXY_SESSION_REFRESH_ERROR", err);
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$|.*\\.ico$|.*\\.css$|.*\\.js$).*)",
  ],
};
