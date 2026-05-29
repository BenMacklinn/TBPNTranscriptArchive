import type { Metadata } from "next";
import localFont from "next/font/local";
import { HomeResetProvider } from "./components/home-reset-context";
import { SiteHeader } from "./components/site-header";
import "./globals.css";

const recordLaser = localFont({
  src: [
    {
      path: "./fonts/RecordLaserFreeze-TBPNRegular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/RecordLaserFreeze-TBPNMedium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/RecordLaserFreeze-TBPNBold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TBPN Transcript Archive",
  description: "Search TBPN livestream transcripts with timestamped receipts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={recordLaser.className}>
        <HomeResetProvider>
          <SiteHeader />
          {children}
        </HomeResetProvider>
      </body>
    </html>
  );
}
