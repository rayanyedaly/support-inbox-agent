import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({
  countTokens: vi.fn(),
  create: vi.fn(),
  logLlmCall: vi.fn(async () => 0.002),
  compactionCreate: vi.fn(async () => ({})),
}));

vi.mock("../../lib/agent/llm", () => ({
  getAnthropic: () => ({ messages: { countTokens: m.countTokens, create: m.create } }),
  logLlmCall: m.logLlmCall,
  AGENT_MODEL: "claude-sonnet-4-6",
  SUMMARY_MODEL: "claude-haiku-4-5",
  COMPACTION_TOKEN_THRESHOLD: 12000,
  RECENT_TURNS_KEPT: 4,
}));
vi.mock("../../lib/prisma", () => ({ prisma: { compaction: { create: m.compactionCreate } } }));

import { maybeCompact } from "../../lib/agent/context";
import type Anthropic from "@anthropic-ai/sdk";

// N rounds of [assistant(tool_use), user(tool_result)] after an initial user turn.
function buildMessages(rounds: number): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [{ role: "user", content: "initial question" }];
  for (let i = 0; i < rounds; i++) {
    msgs.push({ role: "assistant", content: [{ type: "tool_use", id: `tu_${i}`, name: "search_customer", input: {} }] });
    msgs.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `tu_${i}`, content: "{}" }] });
  }
  return msgs;
}

const base = { ticketId: "t1", system: [] as Anthropic.TextBlockParam[], tools: [] as Anthropic.Tool[] };

beforeEach(() => {
  m.countTokens.mockReset();
  m.create.mockReset();
  m.compactionCreate.mockClear();
  m.logLlmCall.mockClear();
});

describe("maybeCompact — context compaction", () => {
  it("is a no-op under the token threshold", async () => {
    const messages = buildMessages(6);
    const res = await maybeCompact({ ...base, messages, liveTokens: 5000 });

    expect(res.compacted).toBe(false);
    expect(res.tokensBefore).toBe(5000);
    expect(res.tokensAfter).toBe(5000);
    expect(res.summaryCostUsd).toBe(0);
    expect(res.messages).toBe(messages); // untouched
    expect(m.countTokens).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("is a no-op over the threshold when there are too few turns to collapse", async () => {
    const messages = buildMessages(4); // 4 assistant turns == RECENT_TURNS_KEPT
    const res = await maybeCompact({ ...base, messages, liveTokens: 20000 });

    expect(res.compacted).toBe(false);
    expect(m.countTokens).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("summarizes older turns and reduces the token count", async () => {
    m.countTokens
      .mockResolvedValueOnce({ input_tokens: 18000 }) // before
      .mockResolvedValueOnce({ input_tokens: 6000 }); // after
    m.create.mockResolvedValue({
      content: [{ type: "text", text: "summary note" }],
      usage: { input_tokens: 500, output_tokens: 80 },
    });

    const messages = buildMessages(6);
    const res = await maybeCompact({ ...base, messages, liveTokens: 20000 });

    expect(res.compacted).toBe(true);
    expect(res.tokensBefore).toBe(18000);
    expect(res.tokensAfter).toBe(6000);
    expect(res.tokensAfter).toBeLessThan(res.tokensBefore); // it reduced
    expect(res.tokensSaved).toBe(12000);
    expect(res.summaryCostUsd).toBe(0.002);

    // The compacted array starts with the summary user message, then recent turns.
    expect(res.messages[0].role).toBe("user");
    expect(String(res.messages[0].content)).toContain("Earlier conversation compacted");
    expect(res.messages.length).toBeLessThan(messages.length);

    // The event is persisted for the dashboard's real savings figure.
    expect(m.compactionCreate).toHaveBeenCalledTimes(1);
    expect(m.compactionCreate.mock.calls[0][0].data).toMatchObject({
      tokensBefore: 18000,
      tokensAfter: 6000,
      tokensSaved: 12000,
    });
  });
});
