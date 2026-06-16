// lib/agent/llm.ts
//
// LLM plumbing shared by the loop and the compaction step: the Anthropic client,
// env-driven config (model is NEVER hardcoded — it's read from ANTHROPIC_MODEL so
// the price map and the model stay in sync), and the LlmCall writer.
//
// logLlmCall is the observability spine: no model call should happen without one
// of these rows. The cost dashboard and per-ticket readout both read from it.

import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
// Relative (not "@/lib/prisma") so the standalone tsx runner resolves it — tsx does
// not honor tsconfig path aliases.
import { prisma } from "../prisma";
import { costUsd, type TokenUsage } from "./cost";

// --- Config (env-driven; sane defaults) ------------------------------------

/** The agent model. Default: current Sonnet (cost/capability balance for support). */
export const AGENT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
/** Cheaper model used only to summarize older turns during compaction. */
export const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-haiku-4-5";
/** Max output tokens per turn. Support drafts are short; tool turns are tiny. */
export const MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS ?? 4096);
/** Effort: cost/quality knob. "medium" is the usual sweet spot for support. */
export const EFFORT = process.env.AGENT_EFFORT ?? "medium";
/** Runaway guard: hard cap on tool-use iterations for one ticket. */
export const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS ?? 8);
/** Compaction trigger: compact when live context exceeds this many tokens. */
export const COMPACTION_TOKEN_THRESHOLD = Number(
  process.env.COMPACTION_TOKEN_THRESHOLD ?? 12000,
);
/** How many of the most recent turns compaction keeps verbatim. */
export const RECENT_TURNS_KEPT = Number(process.env.COMPACTION_RECENT_TURNS ?? 4);

// --- Anthropic client (lazy so importing this module needs no API key) ------

let client: Anthropic | null = null;

/** Get the shared Anthropic client. Reads ANTHROPIC_API_KEY from env on first use. */
export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// --- LlmCall logging --------------------------------------------------------

export interface LlmCallRecord {
  /** Ticket this call belongs to (null for calls outside a ticket). */
  ticketId?: string | null;
  model: string;
  /** Real usage from the API response (structurally a TokenUsage). */
  usage: TokenUsage;
  latencyMs: number;
  /** The tool_use blocks the model emitted on this turn (JSON-serializable; may be omitted). */
  toolCalls?: unknown;
}

/**
 * Write one LlmCall row from a model call's real usage + computed cost. Returns the
 * cost so callers can accumulate a per-run total without re-reading the row.
 */
export async function logLlmCall(rec: LlmCallRecord): Promise<number> {
  const cost = costUsd(rec.model, rec.usage);
  await prisma.llmCall.create({
    data: {
      ticketId: rec.ticketId ?? null,
      model: rec.model,
      inputTokens: rec.usage.input_tokens,
      outputTokens: rec.usage.output_tokens,
      cacheReadTokens: rec.usage.cache_read_input_tokens ?? null,
      cacheWriteTokens: rec.usage.cache_creation_input_tokens ?? null,
      costUsd: cost,
      latencyMs: rec.latencyMs,
      toolCalls:
        rec.toolCalls === undefined
          ? Prisma.JsonNull
          : (rec.toolCalls as Prisma.InputJsonValue),
    },
  });
  return cost;
}
