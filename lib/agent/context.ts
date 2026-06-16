// lib/agent/context.ts
//
// Hand-rolled context compaction — one of the three core claims. This is NOT the
// server-side compaction beta; we do it ourselves so the savings are real, visible,
// and testable.
//
// When the live context exceeds a token threshold, summarize the OLDER turns into a
// single note (via the cheaper SUMMARY_MODEL) and keep the most recent turns
// verbatim. The summarizer call is itself logged as an LlmCall, and we report
// tokens-before/after measured with the real count_tokens endpoint.
//
// Correctness invariant: a tool_use block (assistant) and its matching tool_result
// (next user message) must never be split across the summary boundary, or the next
// request 400s. We therefore only cut at the start of an assistant turn, and prepend
// the summary as a user message — keeping valid user/assistant alternation and
// intact tool_use/tool_result pairs.

import type Anthropic from "@anthropic-ai/sdk";
import {
  getAnthropic,
  logLlmCall,
  AGENT_MODEL,
  SUMMARY_MODEL,
  RECENT_TURNS_KEPT,
  COMPACTION_TOKEN_THRESHOLD,
} from "./llm";
import type { TokenUsage } from "./cost";

/** Live context size = everything the model reads next turn (uncached + cached). */
export function liveContextTokens(usage: TokenUsage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

export interface CompactionResult {
  messages: Anthropic.MessageParam[];
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
}

const SUMMARY_SYSTEM =
  "You compress a support agent's working transcript. Summarize the conversation " +
  "below into a tight note (a few sentences) that preserves everything the agent " +
  "still needs: the resolved customerId and plan, concrete order facts (ids, " +
  "statuses, amounts), any knowledge-base policy points found, ticket-history " +
  "signals, and any draft/triage/escalation decisions already made. Omit pleasantries " +
  "and tool mechanics. Output only the note.";

/**
 * Compact `messages` if the live context (per the last call's usage) exceeds the
 * threshold. No-op (compacted: false) when under threshold or when there aren't
 * enough turns to safely collapse. Tools/system are passed only to measure token
 * counts accurately — they are not mutated.
 */
export async function maybeCompact(args: {
  ticketId?: string | null;
  system: Anthropic.TextBlockParam[] | string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  liveTokens: number;
}): Promise<CompactionResult> {
  const { ticketId, system, tools, messages, liveTokens } = args;
  const client = getAnthropic();

  const noop = (n: number): CompactionResult => ({
    messages,
    compacted: false,
    tokensBefore: n,
    tokensAfter: n,
    tokensSaved: 0,
  });

  if (liveTokens <= COMPACTION_TOKEN_THRESHOLD) return noop(liveTokens);

  // Find the assistant-turn boundary that starts the last RECENT_TURNS_KEPT rounds.
  const assistantIdx = messages.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  if (assistantIdx.length <= RECENT_TURNS_KEPT) return noop(liveTokens);
  const splitIndex = assistantIdx[assistantIdx.length - RECENT_TURNS_KEPT];

  const older = messages.slice(0, splitIndex); // starts at the initial user turn
  const recent = messages.slice(splitIndex); // starts at an assistant turn

  // Measure the honest "before" on the current array.
  const before = await client.messages.countTokens({
    model: AGENT_MODEL,
    system,
    tools,
    messages,
  });

  // Summarize the older turns with the cheaper model — and LOG that call.
  const startedAt = Date.now();
  const summaryMsg = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: renderTranscript(older) }],
  });
  await logLlmCall({
    ticketId,
    model: SUMMARY_MODEL,
    usage: summaryMsg.usage,
    latencyMs: Date.now() - startedAt,
  });

  const summaryText = summaryMsg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const compactedMessages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "[Earlier conversation compacted to save context. Summary of what was " +
        `established so far:]\n${summaryText}`,
    },
    ...recent,
  ];

  const after = await client.messages.countTokens({
    model: AGENT_MODEL,
    system,
    tools,
    messages: compactedMessages,
  });

  return {
    messages: compactedMessages,
    compacted: true,
    tokensBefore: before.input_tokens,
    tokensAfter: after.input_tokens,
    tokensSaved: before.input_tokens - after.input_tokens,
  };
}

/** Flatten messages into a plain-text transcript for the summarizer to read. */
function renderTranscript(messages: Anthropic.MessageParam[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      lines.push(`${m.role}: ${m.content}`);
      continue;
    }
    for (const block of m.content) {
      // Permissive: content here is a union of param/response blocks.
      const b = block as {
        type: string;
        text?: string;
        name?: string;
        input?: unknown;
        content?: unknown;
      };
      if (b.type === "text") {
        lines.push(`${m.role}: ${b.text ?? ""}`);
      } else if (b.type === "tool_use") {
        lines.push(`${m.role} called ${b.name}(${JSON.stringify(b.input ?? {})})`);
      } else if (b.type === "tool_result") {
        lines.push(`tool_result: ${stringifyToolResult(b.content)}`);
      }
    }
  }
  return lines.join("\n");
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "object" && c && "text" in c ? (c as { text: string }).text : JSON.stringify(c)))
      .join(" ");
  }
  return JSON.stringify(content ?? "");
}
