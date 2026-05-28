import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
