import type { Metadata } from "next";
import Link from "next/link";
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
        <nav className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span aria-hidden>📨</span> Support Inbox Agent
            </Link>
            <div className="ml-auto flex items-center gap-5 text-sm text-neutral-600">
              <Link href="/" className="hover:text-neutral-900">
                Inbox
              </Link>
              <Link href="/dashboard" className="hover:text-neutral-900">
                Dashboard
              </Link>
            </div>
          </div>
        </nav>
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}
