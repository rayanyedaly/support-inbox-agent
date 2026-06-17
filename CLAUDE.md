# CLAUDE.md

Working conventions for this repo. Read before each session. The disciplines below are
deliberate engineering decisions, not preferences — they keep the hard parts of the system
legible and prevent effort from leaking into the wrong places.

---

## What this is

A single-workspace **support / ops inbox assistant**. A human agent works a queue of
support tickets; an AI agent reads each ticket, chains tools over the app's own data
(customers, orders, knowledge base, ticket history), and **stages** a reply or triage
action that a human approves. Every model call is logged with token + cost data and
surfaced in the UI.

The interesting engineering lives in the agent layer. Keep `lib/agent/` readable and let
the rest of the app stay a thin, conventional shell around it.

---

## Core capabilities (what the agent layer must actually do)

Everything serves these three. If a task doesn't strengthen one of them or the minimal
full-stack shell around them, it's probably scope creep.

1. **Multi-tool orchestration** — a hand-rolled tool-use loop on the Anthropic SDK that
   chains multiple tools to resolve one ticket. The loop must be readable.
2. **Context management** — a real compaction step: when accumulated turns + tool
   results exceed a token threshold, summarize older turns and record tokens saved.
3. **Per-session token/cost observability** — every model call logged from the API's
   real `usage`, cost computed from a price map, surfaced per-ticket and on a dashboard.

---

## Non-negotiable disciplines

- **Build order is agent-first, infra-last.** Do NOT scaffold Docker/CDK or polish
  deployment while the agent loop is still thin. The trap here is sprinting into tractable
  infra while the valuable agent depth runs out of road. Infra is the last 1–1.5 hrs and
  is cuttable.
- **Hand-roll the tool-use loop.** Use the Anthropic SDK directly (`@anthropic-ai/sdk`).
  Do NOT use LangChain, LlamaIndex, or the Vercel `ai` SDK's agent/`generateText`
  tool-runner helpers — anything that hides the loop defeats the point of the project. A
  custom loop in `lib/agent/loop.ts` is the core of the system. (The Vercel AI SDK is fine
  for UI streaming only, not for running tools.)
- **Single-workspace. No multi-tenant.** No subdomains, no tenant table, no RBAC, no org
  isolation. That surface adds large complexity for no benefit to what this project is
  exploring. Keep it out.
- **Draft, never auto-send.** `draft_reply` stages a Message with status `DRAFT`. A human
  clicks approve to flip it to `SENT`. The agent never fires an outbound action on its own.
  This human-in-the-loop gate is a deliberate design choice — keep it.
- **Log every model call.** No model call may happen without writing an `LlmCall` row
  (model, input/output tokens, costUsd, latencyMs, the tool calls made). The dashboard
  reads from this table; if a call isn't logged, the observability has a hole.
- **Commit in small, honest increments** as features land, not one large dump at the end.

---

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL (via `docker-compose` for local dev)
- `@anthropic-ai/sdk` (direct; hand-rolled loop)
- Vitest (or Jest) for tests
- Deploy: Vercel or Railway with a seeded demo DB
- Optional final layer: AWS CDK (account-agnostic IaC) — `cdk deploy` works, document,
  tear down. Separate infra artifact, not the demo host.

Model: set `ANTHROPIC_MODEL` in env (default to a current Sonnet for cost/capability
balance). **Do not hardcode a model string in logic** — read from env so the price map and
the model stay in sync.

---

## Directory shape (target)

```
prisma/schema.prisma        # data model; LlmCall is the observability spine
lib/agent/tools.ts          # tool definitions + handlers
lib/agent/loop.ts           # hand-rolled tool-use loop  [PHASE 2 — the core]
lib/agent/context.ts        # accumulation + compaction   [PHASE 2]
lib/agent/cost.ts           # price map + cost math        [PHASE 2]
lib/agent/system-prompt.ts  # the agent's instructions
app/                        # inbox list, ticket thread, agent panel, cost dashboard
prisma/seed.ts              # fake customers/orders/tickets/KB
```

---

## Build order (track the current phase here)

- [x] **Phase 0 (~30 min)** — scaffold, schema, `docker-compose` Postgres, seed script.
      First commits.
- [x] **Phase 1 — the core (~3–4 hrs)** — tools + handlers, hand-rolled streaming
      tool-use loop, context accumulation + compaction, `LlmCall` logging on every call.
- [x] **Phase 2 (~1.5–2 hrs)** — full-stack surface: inbox list, ticket thread, agent
      panel (watch tool calls happen, approve drafts), cost dashboard. All shipped.
- [~] **Phase 3 (~1–1.5 hrs)** — 16 tests + README (architecture + tradeoffs) + CI: done.
      Remaining: a live deploy with a seeded demo DB (deferred — see Phase 4 note).
- [x] **Phase 4 (~1–1.5 hrs, CUTTABLE)** — multi-stage `Dockerfile` + account-agnostic
      AWS CDK stack in `infra/` (Fargate + RDS); `cdk synth` is clean. IaC is a separate
      artifact, not the demo host — so the Phase 3 "live demo URL" is intentionally open.

Mark the active phase when you start a session so context survives across sessions.

---

## Tests that matter (Phase 3)

Don't test getters. Test the behavior that's actually load-bearing:
- the loop executes a mocked `tool_use` and feeds the `tool_result` back in (multi-step)
- cost math: tokens × price map → expected costUsd
- compaction triggers at the threshold and reduces token count
- a couple of tools run against a seeded test DB and return real rows
- human-in-the-loop: `draft_reply` creates a `DRAFT`, never a `SENT`; approval flips it

---

## README (Phase 3)

Include a short architecture section that explains, in plain words: the loop is
hand-rolled on the SDK (and why), how context compaction works, how cost is tracked per
call, and the human-in-the-loop gate. Add one honest "tradeoffs / what I'd do next"
paragraph. Write it for someone reading the repo cold.
