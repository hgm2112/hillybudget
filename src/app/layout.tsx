import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { RegisterServiceWorker } from "@/components/register-sw";

const louis = localFont({
  src: [
    { path: "./fonts/LouisGeorgeCafe.ttf", weight: "400", style: "normal" },
    { path: "./fonts/LouisGeorgeCafe-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-body",
  display: "swap",
});

const comfortaa = localFont({
  src: [
    { path: "./fonts/Comfortaa-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Comfortaa-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const instant = false;

export const metadata: Metadata = {
  title: "hillybudget",
  description: "Household expense tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${louis.variable} ${comfortaa.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning
    >
      <body className="min-h-full"><script dangerouslySetInnerHTML={{ __html: "(function(){try{var t=localStorage.getItem('theme');if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'};if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}" }} /><ThemeProvider><RegisterServiceWorker /><AppShell>{children}</AppShell></ThemeProvider></body>
    </html>
  );
}
