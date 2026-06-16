// lib/queries.ts
//
// Reusable read-side aggregations over the LlmCall observability spine. Kept out of
// the page components so the per-ticket readout and the dashboard share one source
// of truth. All Decimal values are converted to number here (server side).

import { prisma } from "./prisma";
import { decToNumber } from "./format";

export interface TicketCost {
  costUsd: number;
  calls: number;
  tools: number;
}

/** Per-ticket cost readout: total spend, model-call count, and tool-call count. */
export async function ticketCostSummary(ticketId: string): Promise<TicketCost> {
  const [agg, rows] = await Promise.all([
    prisma.llmCall.aggregate({
      where: { ticketId },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    prisma.llmCall.findMany({ where: { ticketId }, select: { toolCalls: true } }),
  ]);
  // toolCalls is Json? — each row is an array of tool_use blocks (or null).
  const tools = rows.reduce(
    (n, r) => n + (Array.isArray(r.toolCalls) ? r.toolCalls.length : 0),
    0,
  );
  return { costUsd: decToNumber(agg._sum.costUsd), calls: agg._count._all, tools };
}
