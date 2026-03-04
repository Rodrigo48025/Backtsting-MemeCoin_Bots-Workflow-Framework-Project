import type { Metadata } from "next";
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import "./globals.css";
import { Sidebar } from "@/components/dashboard/sidebar";

export const metadata: Metadata = {
  title: "ANTIGRAVITY // TERMINAL",
  description: "Autonomous Backtesting Framework",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} dark`}>
      <body className="bg-black text-white font-mono flex antialiased h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 h-screen overflow-y-auto bg-black">
          {children}
        </div>
      </body>
    </html>
  );
}