import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support Inbox Agent",
  description:
    "Single-workspace support / ops inbox assistant — an AI agent stages replies a human approves.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
