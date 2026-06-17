# support-inbox-agent

[![CI](https://github.com/rayanyedaly/support-inbox-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/rayanyedaly/support-inbox-agent/actions/workflows/ci.yml)

A single-workspace support / ops **inbox agent**. A human works a ticket queue; an AI
agent reads each ticket, chains tools over the app's own data (customers, orders,
knowledge base, ticket history), and **stages** a reply or triage action that a human
approves. Every model call is logged with token + cost data and surfaced in the UI.

Next.js (App Router) · TypeScript · Tailwind v4 · Prisma · PostgreSQL · `@anthropic-ai/sdk` · Vitest.

## The three things it's built to show

1. **Multi-tool orchestration** — a hand-rolled streaming tool-use loop on the Anthropic
   SDK (`lib/agent/loop.ts`), no framework. It chains tools to resolve one ticket.
2. **Context management** — a real compaction step (`lib/agent/context.ts`): older turns
   are summarized once the context crosses a token threshold, with measured savings.
3. **Per-call token/cost observability** — every model call writes an `LlmCall` row priced
   from real `usage` (`lib/agent/cost.ts`); the dashboard reads from it.

The agent never sends anything: `draft_reply` stages a `DRAFT`; a human clicks **Approve &
send** to flip it to `SENT`.

## Screenshots

<!-- Captured from the running app (ticket detail, light + dark). Drop the two PNGs into docs/. -->

| Light | Dark |
|---|---|
| ![BoxBot — light](docs/screenshot-light.png) | ![BoxBot — dark](docs/screenshot-dark.png) |

## Architecture

- **Hand-rolled loop, no framework** (`lib/agent/loop.ts`). One `for`-loop on the Messages
  API: each iteration streams a turn, logs exactly one `LlmCall`, and on
  `stop_reason: "tool_use"` runs each tool (`lib/agent/tools.ts`) and feeds the `tool_result`s
  back in. `MAX_ITERATIONS` (8) is the runaway guard. No LangChain/etc. — the orchestration is
  the point, so it stays legible and every model call is observable.
- **Compaction with measured savings** (`lib/agent/context.ts`). When live context crosses
  `COMPACTION_TOKEN_THRESHOLD` (12k), older turns are summarized with the cheaper Haiku model,
  the last `RECENT_TURNS_KEPT` (4) turns are kept verbatim, and a `tool_use`/`tool_result` pair
  is never split. Before/after counts come from the real `count_tokens` endpoint and each event
  persists to the `Compaction` table (so the dashboard's savings figure is real).
- **Per-call cost spine** (`lib/agent/cost.ts`). Each call is priced from the API's real `usage`
  (incl. cache read/write); `costUsd` **throws on an unpriced model** so a call never silently
  logs $0. `logLlmCall` writes one `LlmCall` row per turn — the spine the trace panel and
  dashboard both read from.
- **Human-in-the-loop gate** (`app/actions/messages.ts`). `draft_reply` writes `role:"AI",
  status:"DRAFT"`; the only path to `SENT` is `approveMessage`, scoped (via `updateMany`) to an
  AI DRAFT on that ticket — a no-op on anything else.

The **UI** ("BoxBot", a crisp/technical console — slate base, blue accent, Schibsted Grotesk for
UI + JetBrains Mono for data, **light/dark toggle**) is a thin shell over the agent. Theme tokens
are CSS variables in `app/globals.css` mapped to Tailwind utilities; the toggle swaps
`<html data-theme>`. Screens: Inbox queue, Ticket detail with a collapsible agent-trace panel
(the tool chain reconstructed from logged `LlmCall` rows, plus live re-run), Cost dashboard, and a
Knowledge base browser.

## Run it

```bash
docker compose up -d            # Postgres (host port via DB_PORT, default 5432)
cp .env.example .env            # set DATABASE_URL + ANTHROPIC_API_KEY
npm install
npm run db:migrate && npm run db:seed
npm run dev                     # http://localhost:3000
npm run agent                   # CLI: run the loop on the "Where's my refund?" ticket
```

## Testing

```bash
# one-time: a dedicated test DB so dev data is never clobbered
docker compose exec db createdb -U inbox inbox_test
echo 'DATABASE_URL="postgresql://inbox:inbox@localhost:5432/inbox_test?schema=public"' > .env.test

npm run test:run                # vitest — globalSetup migrates + seeds inbox_test, then runs
npm test                        # watch mode
```

~16 tests cover the **load-bearing claims** (not getters): cost math (incl. cache tokens +
unknown-model throw), the loop's multi-step tool_use→tool_result chain + the iteration cap,
compaction's no-op gates and token reduction, the tools against a seeded DB returning real rows,
and the HITL DRAFT→SENT gate (+ its scope guard). **Unit tests mock the SDK + Prisma, so they need
no `ANTHROPIC_API_KEY`** — CI runs the whole suite with only a Postgres service (`.github/workflows/ci.yml`).

## Notes / tradeoffs

- The ticket **agent trace** and the dashboard's **spend-by-model / recent-runs** are derived
  from the logged `LlmCall` rows — no separate run table.
- **Compaction savings** are persisted (`Compaction` model) so the dashboard figure is real; the
  dollar estimate prices saved tokens at the agent model's input rate.
- "Grounded in" citations and the KB **cite counts** are *derived* by re-resolving each
  `search_knowledge_base` query against the knowledge base — best-effort/approximate, since the
  draft↔article link isn't stored.
- Single-workspace by design: no auth / multi-tenant.

## What I'd do next

Swap the KB `contains`-match for Postgres full-text (`tsvector`) or a small embedding index (the
TODO already in `tools.ts`); store the draft↔article citation link instead of re-deriving it; split
the unit/integration tests into separate Vitest projects so unit tests run with zero Postgres; add
streaming-event assertions and a coverage gate; and surface prompt-caching savings alongside the
compaction figure on the dashboard.
