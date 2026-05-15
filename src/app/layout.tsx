import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Tajawal } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { validateEnv } from "@/lib/env";
import "./globals.css";

validateEnv();

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f4e8c" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  title: "Waha Health Care",
  description: "نظام إدارة المستفيدين الصحيين — شركة الواحة للرعاية الصحية",
};

      <head>
        <Script 
          src="/scripts/pre-hydration.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={`${tajawal.variable} ${tajawal.className}`} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
