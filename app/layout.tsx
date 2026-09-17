import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POTA → OSM Park Updater",
  description: "Review-first reconciliation of POTA parks with OpenStreetMap amateur radio entities.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <html lang="en"><body className="antialiased">{children}</body></html>;
}
