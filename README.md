# BoxBot — support inbox agent

[![CI](https://github.com/rayanyedaly/support-inbox-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/rayanyedaly/support-inbox-agent/actions/workflows/ci.yml)

BoxBot is a single-workspace support / ops **inbox agent**. A human works a queue of support
tickets; for a selected ticket, an AI agent reads the conversation, chains tools over the
application's own data (customers, orders, knowledge base, ticket history), and **stages** a
reply or triage action. Nothing is sent to a customer automatically — a human reviews the
staged draft and approves it. Every model call is recorded with token counts, cost, and latency,
and that record drives a per-ticket run trace and a cost dashboard.

It is a working application backed by PostgreSQL, not a demo of mocked data: the agent's tools
read and write real rows, and the UI reads the same database.

---

## Contents

- [Tech stack](#tech-stack)
- [System architecture](#system-architecture)
- [The agent loop](#the-agent-loop)
- [Tool surface](#tool-surface)
- [Context compaction](#context-compaction)
- [Cost & observability](#cost--observability)
- [Human-in-the-loop](#human-in-the-loop)
- [Web application](#web-application)
- [UI & theming](#ui--theming)
- [Data model](#data-model)
- [Seed data](#seed-data)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Running locally](#running-locally)
- [Testing & CI](#testing--ci)
- [Current scope & limitations](#current-scope--limitations)

---

## Screenshots

Ticket detail — the customer message, the staged agent draft (the human-in-the-loop moment), and
the agent-run trace panel (cost, latency, and the reconstructed tool chain), in light and dark.

| Light | Dark |
|---|---|
| ![BoxBot — light](docs/screenshot-light.png) | ![BoxBot — dark](docs/screenshot-dark.png) |

---

## Tech stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | `^16.2.9` |
| UI runtime | React / React DOM | `^19.2.7` |
| Language | TypeScript | `^6.0.3` |
| Styling | Tailwind CSS v4 (`@tailwindcss/postcss`) | `^4.3.1` |
| Fonts | `next/font/google` — Schibsted Grotesk (UI), JetBrains Mono (data) | — |
| LLM SDK | `@anthropic-ai/sdk` (used directly, no agent framework) | `^0.104.2` |
| ORM | Prisma (`@prisma/client` + `prisma`) | `^6.19.3` |
| Database | PostgreSQL (Docker) | `16` |
| Tests | Vitest + `vite-tsconfig-paths` + `dotenv` | `^4.1.9` |
| Lint | ESLint flat config + `eslint-config-next/core-web-vitals` | `^9.39.4` |
| Scripts | `tsx` (seed + agent CLI) | `^4.22.4` |
| CI | GitHub Actions (Node 20 + Postgres 16 service) | — |

Default models (configurable via env): the agent runs on **`claude-sonnet-4-6`**; context
compaction summarizes with the cheaper **`claude-haiku-4-5`**.

The project is a CommonJS package (`"type": "module"` is **not** set); the Vitest config is
authored as `.mts` so its ESM-only dependency chain loads correctly.

---

## System architecture

The web layer is a thin shell. All non-trivial behavior lives in `lib/agent/`, and a single
`PostgreSQL` database is the source of truth for both the agent's tools and the UI's reads.

```mermaid
flowchart LR
  subgraph Browser["Browser — Next.js client"]
    UI["Inbox · Ticket · Dashboard · KB<br/>Sidebar · ThemeToggle"]
    Panel["AgentTracePanel<br/>(reads live NDJSON)"]
  end

  subgraph App["Next.js App Router — Node runtime"]
    SC["Server Components<br/>read via lib/queries.ts"]
    Route["POST /api/tickets/&#91;id&#93;/run<br/>NDJSON event stream"]
    Action["approveMessage()<br/>server action"]
  end

  subgraph Agent["Agent layer — lib/agent/*"]
    Loop["loop.ts<br/>hand-rolled tool-use loop"]
    Tools["tools.ts<br/>8 DB-backed tools"]
    Ctx["context.ts<br/>compaction"]
    Cost["cost.ts<br/>price map"]
  end

  API["Anthropic Messages API"]
  DB[("PostgreSQL<br/>via Prisma")]

  UI --> SC
  Panel -->|POST| Route
  Route --> Loop
  Loop -->|stream + tool defs| API
  Loop --> Tools
  Loop --> Ctx
  Loop -.->|prices each call| Cost
  Loop -->|logLlmCall| DB
  Ctx -->|Compaction row| DB
  Tools --> DB
  SC --> DB
  Action -->|DRAFT to SENT| DB
```

- **Server Components** (`app/**/page.tsx`) read directly from Postgres through `lib/queries.ts`
  and render on every request (`export const dynamic = "force-dynamic"`).
- A **streaming route handler** (`POST /api/tickets/[id]/run`) runs the agent loop and streams
  each event to the browser as newline-delimited JSON.
- A **server action** (`approveMessage`) is the only path that flips a staged draft to sent.
- The **agent layer** has no web dependencies; it is exercised both by the route handler and by a
  standalone CLI (`npm run agent`).

---

## The agent loop

`lib/agent/loop.ts` is a hand-rolled tool-use loop on the Anthropic Messages API — there is no
LangChain/LlamaIndex/agent-runner abstraction. `runAgent({ ticketId, initialUserMessage, onEvent })`
returns an `AgentRunResult`; `runTicket(ticketId, onEvent)` loads a ticket and calls it.

```mermaid
sequenceDiagram
  participant R as runAgent (loop.ts)
  participant A as Anthropic API
  participant T as runTool (tools.ts)
  participant DB as Postgres

  loop until end_turn or MAX_ITERATIONS (8)
    R->>A: messages.stream(system + tools + messages, effort)
    A-->>R: finalMessage(content, usage, stop_reason)
    R->>DB: logLlmCall — one LlmCall row (cost from real usage)
    alt stop_reason == "tool_use"
      R->>T: runTool(name, input) for each tool_use block
      T->>DB: read / write
      T-->>R: JSON result
      R->>R: append assistant turn + tool_result(s) to messages
      R->>R: maybeCompact(...) if context over threshold
    else end_turn / max_tokens / refusal
      R->>R: break
    end
  end
  R-->>R: AgentRunResult
```

Per iteration the loop:

1. Calls `client.messages.stream(...)` with the system prompt (carrying a `cache_control:
   ephemeral` breakpoint so tools + system are read from the prompt cache on later turns), the tool
   definitions, the running message array, and `output_config: { effort }`.
2. Streams `text` deltas to `onEvent` and awaits `stream.finalMessage()`.
3. Writes **exactly one `LlmCall` row** via `logLlmCall` (model, token counts, computed cost,
   latency, and the tool-use blocks as JSON).
4. If `stop_reason === "tool_use"`: appends the assistant turn verbatim, runs each tool through
   `runTool`, appends the `tool_result` blocks as a user turn, then runs `maybeCompact`.
5. Otherwise breaks. `MAX_ITERATIONS` (default 8) is a runaway guard; `hitIterationCap` reports
   whether the loop stopped on the cap rather than a natural `end_turn`.

`runTicket` builds the first user message from the ticket subject, channel, priority, the
customer's **name and email**, and the customer message bodies — but deliberately **omits the
`customerId`**, so the agent must chain `search_customer → get_customer_context` to resolve
identity.

**`AgentEvent`** (streamed to `onEvent`): `text` · `tool_use` · `tool_result` · `llm_call` ·
`compaction`.

**`AgentRunResult`**: `{ finalText, stopReason, toolCalls[], llmCalls, totalCostUsd, compactions,
tokensSaved, hitIterationCap }`.

The loop is configured entirely through environment variables (see [Configuration](#configuration)):
`ANTHROPIC_MODEL`, `AGENT_MAX_TOKENS` (4096), `AGENT_EFFORT` (`medium`), `AGENT_MAX_ITERATIONS` (8).

---

## Tool surface

`lib/agent/tools.ts` defines eight tools (the `tools` array passed to the API plus their
handlers). Each handler returns a lean JSON object; `runTool(name, input)` dispatches by name and
returns a structured `{ error }` object on an unknown tool or a thrown handler (so the model can
recover instead of the loop crashing). The handlers use their own `PrismaClient`.

| Tool | Inputs | Reads / writes | Returns |
|---|---|---|---|
| `search_customer` | `query` | `customer.findMany` (name/email contains, ≤5) | `{ matches: [{id,name,email,plan}] }` |
| `get_customer_context` | `customerId` | `customer.findUnique` + order/open-ticket counts | `{ customer, orderCount, openTickets }` |
| `search_orders` | `customerId`, `status?`, `limit?=10` | `order.findMany` (desc) | `{ orders: [{id,status,amountUsd,description,createdAt}] }` |
| `search_knowledge_base` | `query`, `limit?=3` | `kbArticle.findMany` (title/body/tags contains) | `{ articles: [{title,body,slug}] }` |
| `get_ticket_history` | `customerId`, `limit?=5` | `ticket.findMany` (desc) | `{ tickets: [{id,subject,status,priority,createdAt}] }` |
| `draft_reply` | `ticketId`, `body` | `message.create` (`role: AI`, `status: DRAFT`) | `{ draftId, status: "DRAFT", staged: true }` |
| `update_ticket` | `ticketId`, `status?`, `priority?`, `tags?` | `ticket.update` | `{ ticket }` |
| `escalate_ticket` | `ticketId`, `reason`, `team` | `ticket.update` (status `ESCALATED`, push `escalated:{team}` tag) | `{ ticket, reason, team, escalated: true }` |

The **system prompt** (`lib/agent/system-prompt.ts`) instructs the agent to: resolve identity with
`search_customer` before guessing IDs; ground any policy claim in `search_knowledge_base`; match
chain depth to question complexity; consult `get_ticket_history` for recurring issues; **never
imply a reply was sent** (only `draft_reply` stages, a human approves); escalate chargebacks /
fraud to `trust_and_safety` and recurring technical issues to `engineering`; and set a ticket to
`PENDING` with a clarifying draft when a request is underspecified.

> `search_knowledge_base` currently uses a case-insensitive substring match; a TODO in the source
> notes a future switch to Postgres full-text (`tsvector`) or embeddings.

---

## Context compaction

`lib/agent/context.ts` implements a hand-rolled compaction step (this is not the API's server-side
compaction). `maybeCompact({ ticketId, system, tools, messages, liveTokens })` returns a
`CompactionResult` and no-ops in two cases: when `liveTokens ≤ COMPACTION_TOKEN_THRESHOLD`
(default 12,000), or when there are not more than `RECENT_TURNS_KEPT` (default 4) assistant turns
to collapse.

When it does compact, it:

1. Picks a split point at the start of the last `RECENT_TURNS_KEPT` assistant turns, so the cut
   never lands between a `tool_use` block and its matching `tool_result`.
2. Summarizes the older turns with `SUMMARY_MODEL` (`claude-haiku-4-5`) via a non-streaming
   `messages.create`, preserving the resolved customer, order facts, KB policy points, ticket
   history, and triage decisions. That summarizer call is itself logged as an `LlmCall`.
3. Measures token counts **before and after** with the real `messages.countTokens` endpoint.
4. Replaces the older turns with a single prepended summary message and keeps the recent turns
   verbatim.
5. Writes a `Compaction` row (`tokensBefore`, `tokensAfter`, `tokensSaved`, summarizer `costUsd`,
   `model`). This write is best-effort (`.catch`) so it can never abort an in-flight run.

---

## Cost & observability

`lib/agent/cost.ts` holds the price map and the cost function. Prices are USD per 1M tokens:

| Model | input | output | cache write (5m) | cache read |
|---|---|---|---|---|
| `claude-sonnet-4-6` | 3.00 | 15.00 | 3.75 | 0.30 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 1.25 | 0.10 |

`costUsd(model, usage)` prices input, output, cache-write, and cache-read tokens, rounds to 6
decimal places (to fit `Decimal(10,6)`), and **throws on a model not in the map** so an unpriced
call surfaces rather than logging `$0`.

The `LlmCall` table is the observability spine: one row per model call, written by `logLlmCall`.
Several UI figures are **derived** from it rather than stored separately:

- The ticket **run trace** is reconstructed from a ticket's `LlmCall` rows: tool steps come from the
  `toolCalls` JSON, and a row whose `model` is the summarizer model is rendered as a compaction step.
- The dashboard's **spend-by-model**, **spend-by-day**, and **recent runs** are SQL aggregates over
  `LlmCall`.
- "**Grounded in**" citations on a draft and KB **cite counts** are derived by re-resolving each
  `search_knowledge_base` query against the knowledge base (approximate — there is no stored
  draft↔article link).
- **Compaction savings** are read from the `Compaction` table (a real persisted figure).

---

## Human-in-the-loop

The agent never sends. `draft_reply` writes a `Message` with `role: AI`, `status: DRAFT`. The only
transition to `SENT` is the `approveMessage` server action (`app/actions/messages.ts`), scoped via
`updateMany` to an AI message in DRAFT on that ticket — so re-approving or targeting any other
message is a no-op. "Sending" is a status flip; there is no outbound email/SMS integration.

```mermaid
stateDiagram-v2
  [*] --> DRAFT: draft_reply (agent stages)
  DRAFT --> SENT: approveMessage (human approves)
  SENT --> [*]
```

---

## Web application

App Router routes, all server-rendered per request:

| Route | Type | Purpose |
|---|---|---|
| `/` | Server page | Inbox: ticket grid (Status · Ticket · Agent run · Age) + filter tabs (All / Needs review / Escalated / Resolved) via `?filter=`. |
| `/tickets/[id]` | Server page | Ticket detail: customer message, the draft/sent/escalated outcome card with "grounded-in" citations, and the `AgentTracePanel`. |
| `/dashboard` | Server page | KPIs (total spend, resolved, avg cost/resolved, tokens), spend-by-day, token split, compaction savings, spend-by-model, recent runs. |
| `/kb` | Server layout + page | Knowledge base: article rail; index redirects to the first article. |
| `/kb/[slug]` | Server page | Article reader (category, body, tags, agent cite count). |
| `POST /api/tickets/[id]/run` | Route handler (Node runtime) | Runs the agent and streams `AgentEvent`s as NDJSON; terminal `{type:"done", …}` or `{type:"error", …}`. |

The **`AgentTracePanel`** (client) has two modes: a static historical trace built from
`ticketTrace(id)`, and a live mode that POSTs to the run endpoint, reads the NDJSON stream via
`response.body.getReader()`, renders events as they arrive, and calls `router.refresh()` when the
run ends so the Server Components re-read the new draft and updated cost.

The read-side query layer is `lib/queries.ts`: `sidebarStats`, `inboxRows`, `ticketTrace`,
`ticketCostSummary`, `dashboardStats`, `kbList`, `kbArticle` (and an internal `kbCitationCounts`).
Prisma `Decimal` values are converted to `number` (via `lib/format.ts` `decToNumber`) before
crossing to any Client Component.

---

## UI & theming

The interface is a sidebar console (Inbox / Dashboard / Knowledge base), built with Tailwind v4
and no component or chart library. UI text uses **Schibsted Grotesk**; all data (IDs, costs,
tokens, latency, statuses) uses **JetBrains Mono**.

**Theming** is CSS-variable driven. `app/globals.css` defines the full token set on
`:root, [data-theme="light"]` and overrides it on `[data-theme="dark"]` — background/surface,
text shades, accent (with an `--on-accent` token for readable text on accent fills in both
themes), per-status color families (open/pending/resolved/escal), and chart colors. A Tailwind v4
`@theme inline` block maps those variables to utilities (`bg-surface`, `text-ink`, `font-mono`,
…), so utilities re-resolve live when the theme flips. Status/priority colors are applied as inline
`var(--token)` styles because the family is chosen dynamically from enum values.

The light/dark switch:

- A small inline script in `<head>` sets `document.documentElement.dataset.theme` from
  `localStorage` / `prefers-color-scheme` **before paint** (no flash); `<html>` carries
  `suppressHydrationWarning`.
- `ThemeToggle` reads the theme with `useSyncExternalStore` (subscribing to a custom `themechange`
  window event) and, on click, writes `data-theme` + `localStorage` and dispatches the event.

Only `Sidebar`-nav, `ThemeToggle`, `AgentTracePanel`, `ApproveButton`, and `KbRail` are client
components; everything else is server-rendered. Icons are an inline SVG set (`currentColor`).

---

## Data model

Prisma + PostgreSQL. `LlmCall` is the observability spine; `Compaction` records each compaction
event.

```mermaid
erDiagram
  Customer ||--o{ Order : has
  Customer ||--o{ Ticket : has
  Ticket ||--o{ Message : has
  Ticket ||--o{ LlmCall : logs
  Ticket ||--o{ Compaction : logs

  Customer {
    string id PK
    string name
    string email UK
    Plan plan
  }
  Order {
    string id PK
    string customerId FK
    OrderStatus status
    decimal amountUsd
    string description
  }
  Ticket {
    string id PK
    string customerId FK
    string subject
    TicketStatus status
    TicketPriority priority
    Channel channel
    string_arr tags
  }
  Message {
    string id PK
    string ticketId FK
    MessageRole role
    string body
    MessageStatus status
  }
  KbArticle {
    string id PK
    string title
    string slug UK
    string body
    string_arr tags
  }
  LlmCall {
    string id PK
    string ticketId FK "nullable"
    string model
    int inputTokens
    int outputTokens
    int cacheReadTokens "nullable"
    int cacheWriteTokens "nullable"
    decimal costUsd
    int latencyMs
    json toolCalls "nullable"
  }
  Compaction {
    string id PK
    string ticketId FK "nullable"
    int tokensBefore
    int tokensAfter
    int tokensSaved
    decimal costUsd
    string model
  }
```

`KbArticle` is standalone (no foreign keys). IDs are `cuid()`. Enums:

| Enum | Values |
|---|---|
| `Plan` | `FREE`, `PRO`, `ENTERPRISE` |
| `OrderStatus` | `PAID`, `REFUNDED`, `PENDING`, `FAILED` |
| `TicketStatus` | `OPEN`, `PENDING`, `RESOLVED`, `ESCALATED` |
| `TicketPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `Channel` | `EMAIL`, `CHAT`, `WHATSAPP`, `WEB` |
| `MessageRole` | `CUSTOMER`, `AGENT`, `AI` |
| `MessageStatus` | `DRAFT`, `SENT` |

Migrations live in `prisma/migrations/` (`…_init`, `…_compaction`).

---

## Seed data

`prisma/seed.ts` (run by `npm run db:seed`) is idempotent — it clears the tables in FK-safe order
and recreates a fixed dataset anchored to a deterministic clock. It produces **7 customers, 9
orders, 6 KB articles, 10 tickets, 15 messages**, shaped so the open tickets exercise distinct tool
chains:

| Customer | Plan | Open ticket | Intended behavior |
|---|---|---|---|
| Maya Chen | PRO | "Where's my refund?" | full chain → `draft_reply` |
| Tom Becker | PRO | "How do I cancel my subscription?" | KB-only → `draft_reply` |
| Priya Nair | PRO | "Login still failing — third time this month" (+3 resolved login tickets) | `get_ticket_history` → escalate to `engineering` |
| Dan Owusu | ENTERPRISE | "Disputing this charge — filing a chargeback" | escalate to `trust_and_safety` |
| Lena Fischer | FREE | "it's broken" | `update_ticket(PENDING)` + clarifying draft |

Plus two background customers (Carlos Mendes, Aisha Khan) with resolved tickets. The 6 KB articles
cover refunds, cancellation, login troubleshooting, billing disputes, SLAs, and account security.

---

## Project structure

```
prisma/
  schema.prisma          # data model (LlmCall + Compaction are the observability spine)
  migrations/            # init + compaction
  seed.ts                # the 7-customer / 10-ticket fixture
lib/
  prisma.ts              # shared PrismaClient singleton
  format.ts              # decToNumber, formatUsd, formatTokens, timeAgo, initials, formatDate
  queries.ts             # all read-side queries + derivations (inbox, trace, dashboard, KB)
  agent/
    loop.ts              # hand-rolled streaming tool-use loop
    tools.ts             # 8 tool definitions + handlers
    context.ts           # compaction
    cost.ts              # price map + costUsd
    llm.ts               # Anthropic client + config + logLlmCall
    system-prompt.ts     # the agent's instructions
app/
  layout.tsx             # shell: fonts, no-flash theme script, Sidebar
  page.tsx               # inbox
  tickets/[id]/page.tsx  # ticket detail + trace panel
  dashboard/page.tsx     # cost dashboard
  kb/                    # knowledge base browser (layout + index + reader)
  api/tickets/[id]/run/route.ts   # NDJSON agent-run stream
  actions/messages.ts    # approveMessage (HITL)
  _components/           # Sidebar, ThemeToggle, Pills, AgentTracePanel, dashboard/*, kb/*, icons
scripts/run-agent.ts     # CLI: run the loop on a ticket and print the trace
tests/                   # vitest: unit (cost/loop/context) + integration (tools/hitl)
.github/workflows/ci.yml # CI
docker-compose.yml       # Postgres 16
```

---

## Configuration

All configuration is via environment variables. `DATABASE_URL` and `ANTHROPIC_API_KEY` are
required for live use; everything else has a default.

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | Prisma datasource, tests | — (required) |
| `ANTHROPIC_API_KEY` | `getAnthropic()` (live runs only) | — (required for runs; not needed in CI) |
| `ANTHROPIC_MODEL` | agent model | `claude-sonnet-4-6` |
| `ANTHROPIC_SUMMARY_MODEL` | compaction summarizer | `claude-haiku-4-5` |
| `AGENT_MAX_TOKENS` | per-turn output cap | `4096` |
| `AGENT_EFFORT` | `output_config.effort` | `medium` |
| `AGENT_MAX_ITERATIONS` | loop runaway guard | `8` |
| `COMPACTION_TOKEN_THRESHOLD` | compaction trigger | `12000` |
| `COMPACTION_RECENT_TURNS` | turns kept verbatim | `4` |
| `DB_PORT` | docker-compose host port | `5432` |
| `NODE_ENV` | Prisma singleton guard | runtime |

`.env*` is gitignored except `.env.example`; `PLAN.md` is gitignored.

---

## Running locally

```bash
docker compose up -d            # Postgres 16 (host port via DB_PORT, default 5432)
cp .env.example .env            # set DATABASE_URL and ANTHROPIC_API_KEY
npm install
npm run db:migrate && npm run db:seed
npm run dev                     # http://localhost:3000

# run the agent on a ticket from the CLI and print its trace + staged draft
npm run agent                   # defaults to the "Where's my refund?" ticket
npm run agent -- "cancel"       # match a ticket by subject fragment (or pass a ticket id)
```

Useful scripts: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:studio`,
`npm run db:reset`.

---

## Testing & CI

16 Vitest tests across 5 files cover the load-bearing behavior:

| File | Type | Covers |
|---|---|---|
| `tests/unit/cost.test.ts` | unit | cost math (input/output + cache), 6dp rounding, unknown-model throw |
| `tests/unit/loop.test.ts` | unit (mocked SDK/tools/context) | multi-step `tool_use → tool_result`, per-turn `LlmCall`, iteration cap, `onEvent` |
| `tests/unit/context.test.ts` | unit (mocked SDK/prisma) | both compaction no-op gates; over-threshold reduce + `Compaction` write |
| `tests/integration/tools.test.ts` | integration (seeded DB) | `search_customer` / `search_orders` / `search_knowledge_base` return real rows |
| `tests/integration/hitl.test.ts` | integration (seeded DB) | `draft_reply` stages DRAFT; `approveMessage` flips to SENT; scope guard |

Unit tests mock the Anthropic SDK and Prisma, so they need **no `ANTHROPIC_API_KEY`**. Integration
tests run against a dedicated `inbox_test` database; a Vitest `globalSetup` migrates and seeds it
(and refuses to run against a URL that doesn't contain `inbox_test`).

```bash
docker compose exec db createdb -U inbox inbox_test
echo 'DATABASE_URL="postgresql://inbox:inbox@localhost:5432/inbox_test?schema=public"' > .env.test
npm run test:run    # single run (globalSetup migrates + seeds, then runs)
npm test            # watch mode
```

**CI** (`.github/workflows/ci.yml`) runs on push to `main` and on PRs: a Postgres 16 service,
Node 20, then `npm ci` → `prisma generate` → `typecheck` → `lint` → `test:run` → `build`. No
secrets are required.

---

## Current scope & limitations

- **Single workspace.** No authentication, multi-tenancy, RBAC, or org isolation.
- **No outbound delivery.** "Approve & send" flips a message's status to `SENT`; there is no email/
  SMS integration.
- **Knowledge base search** is a case-insensitive substring match (not full-text or embeddings).
- **Derived data.** The "grounded-in" citations and KB cite counts are re-derived from logged
  search queries and are approximate; the ticket trace and most dashboard panels are computed from
  the `LlmCall` table rather than a dedicated run-history table.
- **Not yet deployed.** It runs locally and in CI against Docker Postgres; there is no hosted
  instance.
- The agent persona and user in the UI (model status card, sidebar profile) are fixed demo chrome.
