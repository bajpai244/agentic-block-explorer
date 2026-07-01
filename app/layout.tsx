import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "chacha",
  description: "AI-native PEPE explorer for Ethereum",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
