import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scripps Sandbox Makerspace Check-in",
  description: "Interactive kiosk prototype for the Scripps Sandbox Makerspace.",
  openGraph: {
    title: "Scripps Sandbox Interactive Check-in Prototype",
    description: "Explore the complete check-in, exception, and onboarding flows.",
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
