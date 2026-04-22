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
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const preHydrationDomCleanup = `(function(){try{var ATTR='bis_skin_checked';var clean=function(node){if(!node)return;var nodes=node.querySelectorAll?node.querySelectorAll('['+ATTR+']'):[];for(var i=0;i<nodes.length;i++){nodes[i].removeAttribute(ATTR);}if(node.documentElement&&node.documentElement.hasAttribute&&node.documentElement.hasAttribute(ATTR)){node.documentElement.removeAttribute(ATTR);}if(node.body&&node.body.hasAttribute&&node.body.hasAttribute(ATTR)){node.body.removeAttribute(ATTR);}};clean(document);var mo=new MutationObserver(function(mutations){for(var i=0;i<mutations.length;i++){var m=mutations[i];if(m.type==='attributes'&&m.target&&m.target.removeAttribute){m.target.removeAttribute(ATTR);}if(m.addedNodes){for(var j=0;j<m.addedNodes.length;j++){var added=m.addedNodes[j];if(added&&added.nodeType===1&&added.removeAttribute){added.removeAttribute(ATTR);}if(added&&added.querySelectorAll){var descendants=added.querySelectorAll('['+ATTR+']');for(var k=0;k<descendants.length;k++){descendants[k].removeAttribute(ATTR);}}}}}});if(document.documentElement){mo.observe(document.documentElement,{attributes:true,attributeFilter:[ATTR],subtree:true,childList:true});}setTimeout(function(){clean(document);},0);setTimeout(function(){clean(document);},50);}catch(_e){}})();`;

  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${tajawal.variable} ${tajawal.className}`} suppressHydrationWarning>
        <Script id="pre-hydration-dom-cleanup" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: preHydrationDomCleanup }} />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
