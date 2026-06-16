// lib/agent/cost.ts
//
// Price map + cost math. Pure (no I/O) so it's trivially unit-testable. Prices are
// per MILLION tokens, in USD.
//
// Source: input/output rates confirmed against the live model docs
// (platform.claude.com/docs/en/about-claude/models/overview) on 2026-06-16. Prompt-
// cache rates follow the documented multipliers: a 5-minute cache WRITE costs 1.25x
// the input rate, a cache READ costs 0.1x the input rate.
//
// Every model the loop or the compaction step can call MUST have an entry here, or
// costUsd throws — an unpriced call should surface loudly, never log as $0.

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M tokens written to the 5-minute prompt cache (1.25x input). */
  cacheWrite5m: number;
  /** USD per 1M tokens read from the prompt cache (0.1x input). */
  cacheRead: number;
}

export const PRICES: Record<string, ModelPrice> = {
  // Agent default (ANTHROPIC_MODEL): best speed/intelligence balance for support.
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheWrite5m: 3.75, cacheRead: 0.3 },
  // Used by the compaction step to summarize older turns cheaply.
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite5m: 1.25, cacheRead: 0.1 },
};

/** The token counts we price. Mirrors the Anthropic Messages API `usage` object. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const PER_MTOK = 1_000_000;

/**
 * Compute the USD cost of one model call from the API's real `usage`. Returns a
 * number rounded to 6 decimal places to fit LlmCall.costUsd (Decimal(10,6)).
 * Throws on an unknown model so an unpriced call surfaces instead of logging $0.
 */
export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  if (!price) {
    throw new Error(
      `No price for model "${model}". Add it to PRICES in lib/agent/cost.ts.`,
    );
  }
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const dollars =
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      cacheWrite * price.cacheWrite5m +
      cacheRead * price.cacheRead) /
    PER_MTOK;
  // Round to 6dp (Decimal(10,6)) and strip float noise from the stored value.
  return Math.round(dollars * 1e6) / 1e6;
}
