import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { PushProvider } from "@/app/push/PushProvider";
import UsernameEnforcer from "@/components/UsernameEnforcer";
import { Suspense } from "react";
import AppFooter from "@/components/AppFooter";
import AnalyticsListener from "@/components/AnalyticsListener";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Badminton Manager 2025",
  description: "Manage your badminton sessions with ease",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#111827" />
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7532456849898601"
          crossOrigin="anonymous"
        ></script>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppHeader />
        <Suspense fallback={null}>
          <UsernameEnforcer />
        </Suspense>
        <ServiceWorkerRegister />
        <PushProvider>{children}</PushProvider>
        <Suspense fallback={null}>
          <AnalyticsListener />
        </Suspense>
        <AppFooter />
      </body>
    </html>
  );
}
