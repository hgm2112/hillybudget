import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppNav } from "@/components/app-nav";
import { RegisterServiceWorker } from "@/components/register-sw";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "hillybudget",
  description: "Household expense tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col"><script dangerouslySetInnerHTML={{ __html: "(function(){try{var t=localStorage.getItem('theme');if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'};if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}" }} /><ThemeProvider><AppNav /><RegisterServiceWorker />{children}</ThemeProvider></body>
    </html>
  );
}
