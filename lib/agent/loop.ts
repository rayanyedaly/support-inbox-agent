// lib/agent/loop.ts
//
// The hand-rolled tool-use loop — the core of the system. No framework runs this;
// it's a plain loop on the Anthropic SDK so a reader can see exactly how tools are
// chained, how every model call is logged, and where compaction happens.
//
// Per iteration:
//   1. stream a Messages API call with tools + the running messages,
//   2. log one LlmCall (real usage -> cost),
//   3. if stop_reason === "tool_use": run each tool, append tool_results, compact
//      if over the token threshold, loop,
//   4. else: return the final assistant message.
// MAX_ITERATIONS caps the loop as a runaway guard.

import type Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "./tools";
import { SYSTEM_PROMPT } from "./system-prompt";
import { maybeCompact, liveContextTokens } from "./context";
import { prisma } from "../prisma";
import {
  getAnthropic,
  logLlmCall,
  AGENT_MODEL,
  MAX_TOKENS,
  EFFORT,
  MAX_ITERATIONS,
} from "./llm";

/** Progress events, so the Phase 2 UI (and the CLI runner) can watch the chain. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | {
      type: "llm_call";
      model: string;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      type: "compaction";
      tokensBefore: number;
      tokensAfter: number;
      tokensSaved: number;
    };

export interface AgentRunResult {
  finalText: string;
  stopReason: string | null;
  toolCalls: { name: string; input: unknown }[];
  llmCalls: number;
  totalCostUsd: number;
  compactions: number;
  tokensSaved: number;
  hitIterationCap: boolean;
}

export async function runAgent(opts: {
  ticketId?: string | null;
  initialUserMessage: string;
  onEvent?: (e: AgentEvent) => void;
}): Promise<AgentRunResult> {
  const { ticketId, initialUserMessage, onEvent } = opts;
  const client = getAnthropic();

  // Stable prefix (tools render before system); cache_control caches tools+system
  // together so the loop's later iterations read it instead of re-paying for it.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ];
  const tools = toolDefinitions;

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: initialUserMessage },
  ];

  const toolCalls: { name: string; input: unknown }[] = [];
  let llmCalls = 0;
  let totalCostUsd = 0;
  let compactions = 0;
  let tokensSaved = 0;
  let finalText = "";
  let stopReason: string | null = null;
  let hitIterationCap = true;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const startedAt = Date.now();
    // effort is a current API param the installed SDK types may lag on; cast the
    // params so it still reaches the wire (extra body keys are sent as-is).
    const stream = client.messages.stream({
      model: AGENT_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      messages,
      output_config: { effort: EFFORT },
    } as Parameters<typeof client.messages.stream>[0]);

    stream.on("text", (delta) => onEvent?.({ type: "text", text: delta }));
    const msg = await stream.finalMessage();
    const latencyMs = Date.now() - startedAt;

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // (2) Log the call — observability spine. Never skip this.
    const cost = await logLlmCall({
      ticketId,
      model: AGENT_MODEL,
      usage: msg.usage,
      latencyMs,
      toolCalls: toolUses.length
        ? toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input }))
        : undefined,
    });
    llmCalls++;
    totalCostUsd += cost;
    onEvent?.({
      type: "llm_call",
      model: AGENT_MODEL,
      costUsd: cost,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) finalText = text;
    stopReason = msg.stop_reason;

    // (4) Not a tool turn (end_turn / refusal / max_tokens) -> done.
    if (msg.stop_reason !== "tool_use") {
      hitIterationCap = false;
      break;
    }

    // (3) Append the assistant turn verbatim (preserves tool_use blocks), run the
    // tools, and feed the tool_results back in.
    messages.push({ role: "assistant", content: msg.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      onEvent?.({ type: "tool_use", name: t.name, input: t.input });
      toolCalls.push({ name: t.name, input: t.input });
      const result = await runTool(t.name, t.input);
      onEvent?.({ type: "tool_result", name: t.name, result });
      results.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });

    // Compact older turns if the live context has grown past the threshold.
    const liveTokens = liveContextTokens(msg.usage) + msg.usage.output_tokens;
    const comp = await maybeCompact({ ticketId, system, tools, messages, liveTokens });
    totalCostUsd += comp.summaryCostUsd;
    if (comp.compacted) {
      messages = comp.messages;
      compactions++;
      tokensSaved += comp.tokensSaved;
      onEvent?.({
        type: "compaction",
        tokensBefore: comp.tokensBefore,
        tokensAfter: comp.tokensAfter,
        tokensSaved: comp.tokensSaved,
      });
    }
  }

  return {
    finalText,
    stopReason,
    toolCalls,
    llmCalls,
    totalCostUsd,
    compactions,
    tokensSaved,
    hitIterationCap,
  };
}

/**
 * Load a ticket and run the agent on it. The initial message gives the agent the
 * ticketId + customer name/email + the customer's message, but deliberately NOT the
 * customerId — so it must chain search_customer -> get_customer_context to resolve
 * identity (the orchestration proof).
 */
export async function runTicket(
  ticketId: string,
  onEvent?: (e: AgentEvent) => void,
): Promise<AgentRunResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { customer: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) throw new Error(`ticket_not_found:${ticketId}`);

  const customerMessage = ticket.messages
    .filter((m) => m.role === "CUSTOMER")
    .map((m) => m.body)
    .join("\n\n");

  const initialUserMessage = [
    "New support ticket to resolve.",
    `ticketId: ${ticket.id}`,
    `subject: ${ticket.subject}`,
    `channel: ${ticket.channel}`,
    `priority: ${ticket.priority}`,
    `customer name: ${ticket.customer.name}`,
    `customer email: ${ticket.customer.email}`,
    "",
    "Customer message:",
    customerMessage || "(no message body)",
  ].join("\n");

  return runAgent({ ticketId: ticket.id, initialUserMessage, onEvent });
}
