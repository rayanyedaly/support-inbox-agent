import { describe, it, expect } from "vitest";
import { costUsd } from "../../lib/agent/cost";

describe("costUsd", () => {
  it("prices Sonnet input + output per MTok", () => {
    expect(
      costUsd("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 }),
    ).toBe(18); // 3 + 15
  });

  it("prices cache write and cache read", () => {
    expect(
      costUsd("claude-sonnet-4-6", {
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(7.05, 6); // 3 (input) + 3.75 (cache write) + 0.3 (cache read)
  });

  it("rounds to 6 decimal places (fits Decimal(10,6))", () => {
    // Haiku: input $1, output $5 → (333333*1 + 111111*5)/1e6 = 0.888888
    const c = costUsd("claude-haiku-4-5", { input_tokens: 333_333, output_tokens: 111_111 });
    expect(c).toBeCloseTo(0.888888, 6);
    // Never more than 6 dp of precision.
    expect(c.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });

  it("throws on an unpriced model (never silently logs $0)", () => {
    expect(() => costUsd("gpt-5", { input_tokens: 1, output_tokens: 1 })).toThrow(
      /No price for model/,
    );
  });
});
