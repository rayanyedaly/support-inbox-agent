# support-inbox-agent

A single-workspace support / ops **inbox agent**. A human works a ticket queue; an AI
agent reads each ticket, chains tools over the app's own data (customers, orders,
knowledge base, ticket history), and **stages** a reply or triage action that a human
approves. Every model call is logged with token + cost data and surfaced in the UI.

Next.js (App Router) · TypeScript · Tailwind v4 · Prisma · PostgreSQL · `@anthropic-ai/sdk`.

## The three things it's built to show

1. **Multi-tool orchestration** — a hand-rolled streaming tool-use loop on the Anthropic
   SDK (`lib/agent/loop.ts`), no framework. It chains tools to resolve one ticket.
2. **Context management** — a real compaction step (`lib/agent/context.ts`): older turns
   are summarized once the context crosses a token threshold, with measured savings.
3. **Per-call token/cost observability** — every model call writes an `LlmCall` row priced
   from real `usage` (`lib/agent/cost.ts`); the dashboard reads from it.

The agent never sends anything: `draft_reply` stages a `DRAFT`; a human clicks **Approve &
send** to flip it to `SENT`.

## UI — "BoxBot" (Direction A · Calm Console)

The interface is a crisp/technical enterprise console (slate base, blue accent, Schibsted
Grotesk for UI + JetBrains Mono for all data) with a **light/dark toggle**, built from a
Claude Design handoff. Screens: Inbox queue, Ticket detail with a collapsible agent-trace
panel (the tool chain reconstructed from logged `LlmCall` rows, plus live re-run),
Cost & observability dashboard, and a Knowledge base browser. Theme tokens are CSS
variables in `app/globals.css` mapped to Tailwind utilities; the toggle swaps
`<html data-theme>`.

## Run it

```bash
docker compose up -d            # Postgres (host port via DB_PORT, default 5432)
cp .env.example .env            # set DATABASE_URL + ANTHROPIC_API_KEY
npm install
npm run db:migrate && npm run db:seed
npm run dev                     # http://localhost:3000
npm run agent                   # CLI: run the loop on the "Where's my refund?" ticket
```

## Notes / tradeoffs

- The ticket **agent trace** and the dashboard's **spend-by-model / recent-runs** are
  derived from the logged `LlmCall` rows — no separate run table.
- **Compaction savings** are persisted (`Compaction` model) so the dashboard figure is real.
- "Grounded in" citations and the KB **cite counts** are *derived* by re-resolving each
  `search_knowledge_base` query against the knowledge base — best-effort/approximate, since
  the draft↔article link isn't stored.
- Single-workspace by design: no auth / multi-tenant.
