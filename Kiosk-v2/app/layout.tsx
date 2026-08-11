import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scripps Sandbox Makerspace",
  description: "Check in, create a Sandbox account, and manage makerspace operations.",
  openGraph: {
    title: "Scripps Sandbox Makerspace",
    description: "Check-in, first-visit registration, and staff operations for the Scripps Sandbox.",
    images: ["/scripps-sandbox-prototype-og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
