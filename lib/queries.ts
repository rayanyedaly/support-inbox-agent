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

const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-haiku-4-5";

export interface TraceStep {
  index: number;
  kind: "tool" | "compaction";
  name: string;
  detail: string;
}
export interface TicketTrace {
  steps: TraceStep[];
  costUsd: number;
  latencyMs: number;
  modelCalls: number;
  toolCalls: number;
  /** KB articles the agent consulted during the run (derived from its search calls). */
  citations: { slug: string; title: string }[];
  hasRun: boolean;
}

/**
 * Reconstruct a ticket's agent run as a tool-chain trace from the logged LlmCall rows
 * (no per-run table needed). Compaction steps are the summarizer-model calls. Citations
 * are derived by re-resolving each search_knowledge_base query against the KB.
 */
export async function ticketTrace(ticketId: string): Promise<TicketTrace> {
  const calls = await prisma.llmCall.findMany({
    where: { ticketId },
    orderBy: { createdAt: "asc" },
    select: { model: true, latencyMs: true, costUsd: true, toolCalls: true },
  });

  const steps: TraceStep[] = [];
  const kbQueries: string[] = [];
  let toolCalls = 0;
  let latencyMs = 0;
  let costUsd = 0;
  let idx = 0;

  for (const c of calls) {
    latencyMs += c.latencyMs;
    costUsd += decToNumber(c.costUsd);
    if (c.model === SUMMARY_MODEL) {
      steps.push({ index: ++idx, kind: "compaction", name: "Context compacted", detail: "older turns summarized" });
      continue;
    }
    if (Array.isArray(c.toolCalls)) {
      for (const t of c.toolCalls as { name?: string; input?: Record<string, unknown> }[]) {
        if (!t?.name) continue;
        toolCalls++;
        steps.push({ index: ++idx, kind: "tool", name: t.name, detail: traceDetail(t.input) });
        if (t.name === "search_knowledge_base" && typeof t.input?.query === "string") {
          kbQueries.push(t.input.query);
        }
      }
    }
  }

  return {
    steps,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    latencyMs,
    modelCalls: calls.length,
    toolCalls,
    citations: await resolveKbCitations(kbQueries),
    hasRun: calls.length > 0,
  };
}

function traceDetail(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const v = o.query ?? o.customerId ?? o.ticketId ?? o.status ?? o.team ?? o.reason;
  return v == null ? "" : String(v);
}

async function resolveKbCitations(queries: string[]): Promise<{ slug: string; title: string }[]> {
  const uniq = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (uniq.length === 0) return [];
  const articles = await prisma.kbArticle.findMany({
    where: {
      OR: uniq.flatMap((q) => [
        { title: { contains: q, mode: "insensitive" as const } },
        { body: { contains: q, mode: "insensitive" as const } },
        { tags: { has: q.toLowerCase() } },
      ]),
    },
    select: { slug: true, title: true },
    take: 6,
  });
  const seen = new Set<string>();
  return articles.filter((a) => !seen.has(a.slug) && seen.add(a.slug));
}

export interface InboxRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  updatedAt: Date;
  customerName: string;
  customerPlan: string;
  /** What the agent's last run produced for this ticket. */
  outcome: "draft" | "sent" | "escalated" | "none";
  toolCount: number;
  costUsd: number;
  lastRunAt: Date | null;
  hasDraft: boolean;
}

/**
 * Inbox rows with the "agent footprint" (cost, tool count, last-run, outcome) derived
 * per ticket. One findMany + one grouped raw aggregate over LlmCall, joined in JS.
 */
export async function inboxRows(): Promise<InboxRow[]> {
  const [tickets, stats] = await Promise.all([
    prisma.ticket.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { name: true, plan: true } },
        messages: { select: { role: true, status: true } },
      },
    }),
    prisma.$queryRaw<{ ticketId: string; cost: string; tools: number; lastrun: Date }[]>`
      SELECT "ticketId",
             SUM("costUsd") AS cost,
             COALESCE(SUM(CASE WHEN jsonb_typeof("toolCalls") = 'array'
                               THEN jsonb_array_length("toolCalls") ELSE 0 END), 0)::int AS tools,
             MAX("createdAt") AS lastrun
      FROM "LlmCall" WHERE "ticketId" IS NOT NULL GROUP BY "ticketId"`,
  ]);

  const byId = new Map(stats.map((s) => [s.ticketId, s]));
  return tickets.map((t) => {
    const st = byId.get(t.id);
    const hasDraft = t.messages.some((m) => m.role === "AI" && m.status === "DRAFT");
    const hasSent = t.messages.some((m) => m.role === "AI" && m.status === "SENT");
    const outcome: InboxRow["outcome"] =
      t.status === "ESCALATED" ? "escalated" : hasDraft ? "draft" : hasSent ? "sent" : "none";
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      updatedAt: t.updatedAt,
      customerName: t.customer.name,
      customerPlan: t.customer.plan,
      outcome,
      toolCount: st?.tools ?? 0,
      costUsd: decToNumber(st?.cost ?? 0),
      lastRunAt: st?.lastrun ?? null,
      hasDraft,
    };
  });
}

export interface SidebarStats {
  openCount: number;
  kbCount: number;
  todaySpend: number;
  todayCalls: number;
}

/** Ambient sidebar figures: open-ticket count, KB article count, today's spend. */
export async function sidebarStats(): Promise<SidebarStats> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [openCount, kbCount, today] = await Promise.all([
    prisma.ticket.count({ where: { status: "OPEN" } }),
    prisma.kbArticle.count(),
    prisma.llmCall.aggregate({
      where: { createdAt: { gte: startOfDay } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
  ]);
  return {
    openCount,
    kbCount,
    todaySpend: decToNumber(today._sum.costUsd),
    todayCalls: today._count._all,
  };
}

export interface DashboardStats {
  totalSpend: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTickets: number;
  resolvedCount: number;
  avgCostPerResolved: number;
  spendByDay: { day: string; spend: number }[];
  spendByModel: { model: string; spend: number; calls: number }[];
  recentRuns: {
    ticketId: string;
    subject: string;
    status: string;
    costUsd: number;
    latencyMs: number;
  }[];
  compactionSavings: { tokensSaved: number; count: number; costSaved: number };
}

/**
 * Whole-workspace cost stats for the dashboard. "Resolved" = a ticket that has an
 * approved (SENT) AI message — i.e. a human accepted the agent's draft. Avg cost per
 * resolved aggregates spend over the SET of resolved ticket ids (never total/count,
 * which would fold in unresolved tickets and ticketId-null calls).
 */
export async function dashboardStats(): Promise<DashboardStats> {
  const [totals, tokens, resolvedRows, totalTickets, spendRows, modelRows, runRows, comp] =
    await Promise.all([
      prisma.llmCall.aggregate({ _sum: { costUsd: true }, _count: { _all: true } }),
      prisma.llmCall.aggregate({
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true },
      }),
      prisma.message.findMany({
        where: { role: "AI", status: "SENT" },
        select: { ticketId: true },
        distinct: ["ticketId"],
      }),
      prisma.ticket.count(),
      // Bucket + format the day in SQL (to_char) so the label is UTC-deterministic and
      // doesn't depend on the Node server's TZ when a timestamp round-trips through Date.
      // SUM(numeric) comes back as a string from the pg driver — decToNumber handles it.
      prisma.$queryRaw<{ day: string; spend: string }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               SUM("costUsd") AS spend
        FROM "LlmCall" GROUP BY day ORDER BY day`,
      prisma.$queryRaw<{ model: string; spend: string; calls: number }[]>`
        SELECT "model", SUM("costUsd") AS spend, COUNT(*)::int AS calls
        FROM "LlmCall" GROUP BY "model" ORDER BY spend DESC`,
      prisma.$queryRaw<{ ticketId: string; subject: string; status: string; cost: string; latency: number }[]>`
        SELECT l."ticketId", t."subject", t."status"::text AS status,
               SUM(l."costUsd") AS cost, SUM(l."latencyMs")::int AS latency, MAX(l."createdAt") AS lastrun
        FROM "LlmCall" l JOIN "Ticket" t ON t."id" = l."ticketId"
        WHERE l."ticketId" IS NOT NULL
        GROUP BY l."ticketId", t."subject", t."status"
        ORDER BY lastrun DESC LIMIT 8`,
      prisma.compaction.aggregate({ _sum: { tokensSaved: true }, _count: { _all: true } }),
    ]);

  const resolvedIds = resolvedRows.map((r) => r.ticketId);
  const resolvedCost = resolvedIds.length
    ? decToNumber(
        (
          await prisma.llmCall.aggregate({
            where: { ticketId: { in: resolvedIds } },
            _sum: { costUsd: true },
          })
        )._sum.costUsd,
      )
    : 0;

  return {
    totalSpend: decToNumber(totals._sum.costUsd),
    totalCalls: totals._count._all,
    inputTokens: tokens._sum.inputTokens ?? 0,
    outputTokens: tokens._sum.outputTokens ?? 0,
    cacheReadTokens: tokens._sum.cacheReadTokens ?? 0,
    totalTickets,
    resolvedCount: resolvedIds.length,
    avgCostPerResolved: resolvedIds.length ? resolvedCost / resolvedIds.length : 0,
    spendByDay: spendRows.map((r) => ({ day: r.day, spend: decToNumber(r.spend) })),
    spendByModel: modelRows.map((r) => ({
      model: r.model,
      spend: decToNumber(r.spend),
      calls: r.calls,
    })),
    recentRuns: runRows.map((r) => ({
      ticketId: r.ticketId,
      subject: r.subject,
      status: r.status,
      costUsd: decToNumber(r.cost),
      latencyMs: r.latency,
    })),
    compactionSavings: {
      tokensSaved: comp._sum.tokensSaved ?? 0,
      count: comp._count._all,
      // Tokens saved would have re-cost input price on the next call (~$3/MTok Sonnet).
      costSaved: Math.round(((comp._sum.tokensSaved ?? 0) * 3) / 1e6 * 1e6) / 1e6,
    },
  };
}
