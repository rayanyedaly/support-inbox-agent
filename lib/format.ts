// lib/format.ts
//
// Small presentation helpers shared by the UI. Decimal -> number conversion lives
// here because Prisma.Decimal can't cross the Server -> Client component boundary;
// convert before passing cost values to any client leaf.

import { Prisma } from "@prisma/client";

/** Prisma.Decimal | number | null -> number. */
export function decToNumber(
  d: Prisma.Decimal | number | string | null | undefined,
): number {
  if (d == null) return 0;
  return typeof d === "number" ? d : Number(d);
}

/** Format a USD amount. Costs here are tiny (cents), so default to 4 dp. */
export function formatUsd(n: number, dp = 4): string {
  return `$${n.toFixed(dp)}`;
}

/** Thousands-separated integer (token counts). */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** Compact UTC date label, e.g. "Jun 16" (UTC so server/client agree). */
export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** YYYY-MM-DD in UTC — used to key spend-per-day buckets. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
