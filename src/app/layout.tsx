import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BunkerNex",
  description:
    "Service route and bunker price explorer for PIL East Coast India services.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
