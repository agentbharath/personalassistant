import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeInitScript } from "@/components/layout/theme";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { ToastProvider } from "@/components/ui/Toast";
import { ConversationDeletionProvider } from "@/components/layout/ConversationDeletion";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Daylark", template: "%s · Daylark" },
  description: "A private, durable personal assistant for calendar, email, and finances.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f8fa" }, { media: "(prefers-color-scheme: dark)", color: "#0b0e13" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} `} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <ToastProvider><ConversationDeletionProvider>{children}</ConversationDeletionProvider></ToastProvider>
      </body>
    </html>
  );
}
