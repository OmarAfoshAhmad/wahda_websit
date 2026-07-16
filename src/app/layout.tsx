import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { validateEnv } from "@/lib/env";
import "./globals.css";

validateEnv();

const tajawal = localFont({
  src: [
    { path: "../../public/fonts/Tajawal-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Tajawal-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Tajawal-Bold.ttf", weight: "700", style: "normal" },
    { path: "../../public/fonts/Tajawal-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-tajawal",
  display: "swap",
  fallback: ["Tahoma", "Arial", "sans-serif"],
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

const PRE_HYDRATION_CLEANUP = `(function(){try{var ATTR='bis_skin_checked';var clean=function(node){if(!node)return;var nodes=node.querySelectorAll?node.querySelectorAll('['+ATTR+']'):[];for(var i=0;i<nodes.length;i++){nodes[i].removeAttribute(ATTR);}if(node.documentElement&&node.documentElement.hasAttribute&&node.documentElement.hasAttribute(ATTR)){node.documentElement.removeAttribute(ATTR);}if(node.body&&node.body.hasAttribute&&node.body.hasAttribute(ATTR)){node.body.removeAttribute(ATTR);}};clean(document);var mo=new MutationObserver(function(mutations){for(var i=0;i<mutations.length;i++){var m=mutations[i];if(m.type==='attributes'&&m.target&&m.target.removeAttribute){m.target.removeAttribute(ATTR);}if(m.addedNodes){for(var j=0;j<m.addedNodes.length;j++){var added=m.addedNodes[j];if(added&&added.nodeType===1&&added.removeAttribute){added.removeAttribute(ATTR);}if(added&&added.querySelectorAll){var descendants=added.querySelectorAll('['+ATTR+']');for(var k=0;k<descendants.length;k++){descendants[k].removeAttribute(ATTR);}}}}}});if(document.documentElement){mo.observe(document.documentElement,{attributes:true,attributeFilter:[ATTR],subtree:true,childList:true});}setTimeout(function(){clean(document);},0);setTimeout(function(){clean(document);},50);}catch(_e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script 
          dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_CLEANUP }} 
          suppressHydrationWarning
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
