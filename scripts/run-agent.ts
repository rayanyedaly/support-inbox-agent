// scripts/run-agent.ts
//
// Phase 1 verification harness: run the hand-rolled loop against a seeded ticket
// and watch the tool chain, the per-call cost, and the staged draft.
//
//   npm run agent                 # defaults to the "Where's my refund?" ticket
//   npm run agent -- "cancel"     # match a ticket by subject fragment (or pass an id)
//
// Needs ANTHROPIC_API_KEY in .env (loaded via --env-file in the npm script).

import { prisma } from "../lib/prisma";
import { runTicket, type AgentEvent } from "../lib/agent/loop";

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function main() {
  const arg = process.argv[2];
  const ticket = arg
    ? await prisma.ticket.findFirst({
        where: {
          OR: [{ id: arg }, { subject: { contains: arg, mode: "insensitive" } }],
        },
        include: { customer: true },
      })
    : await prisma.ticket.findFirst({
        where: {
          subject: { contains: "refund", mode: "insensitive" },
          status: "OPEN",
        },
        include: { customer: true },
      });

  if (!ticket) {
    console.error(arg ? `No ticket matching "${arg}".` : "No refund ticket found — run `npm run db:seed`.");
    process.exit(1);
  }

  console.log(
    `\n▶ Agent on: "${ticket.subject}"  ·  ${ticket.customer.name}  ·  ${ticket.id}\n`,
  );

  const onEvent = (e: AgentEvent) => {
    switch (e.type) {
      case "text":
        process.stdout.write(e.text);
        break;
      case "tool_use":
        console.log(`\n  🔧 ${e.name}(${truncate(JSON.stringify(e.input), 140)})`);
        break;
      case "tool_result":
        console.log(`  ↳ ${truncate(JSON.stringify(e.result), 180)}`);
        break;
      case "llm_call":
        console.log(
          `  · ${e.model}  in=${e.inputTokens} out=${e.outputTokens}  $${e.costUsd.toFixed(6)}`,
        );
        break;
      case "compaction":
        console.log(
          `  🗜  compaction: ${e.tokensBefore}→${e.tokensAfter} tokens (saved ${e.tokensSaved})`,
        );
        break;
    }
  };

  const result = await runTicket(ticket.id, onEvent);

  console.log("\n\n── Run summary ──────────────────────────────");
  console.log(
    `tools chained : ${result.toolCalls.length}  [${result.toolCalls.map((t) => t.name).join(" → ")}]`,
  );
  console.log(`model calls   : ${result.llmCalls}`);
  console.log(`total cost    : $${result.totalCostUsd.toFixed(6)}`);
  console.log(
    `compactions   : ${result.compactions}` +
      (result.compactions ? `  (tokens saved ${result.tokensSaved})` : ""),
  );
  console.log(`stop reason   : ${result.stopReason}${result.hitIterationCap ? " (hit iteration cap)" : ""}`);

  const draft = await prisma.message.findFirst({
    where: { ticketId: ticket.id, role: "AI", status: "DRAFT" },
    orderBy: { createdAt: "desc" },
  });
  const after = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    select: { status: true, tags: true },
  });

  if (draft) {
    console.log(`\n── Staged DRAFT (id ${draft.id}, status ${draft.status}) ──`);
    console.log(draft.body);
  } else {
    console.log("\n(no draft staged)");
  }
  console.log(`\nticket now: status=${after?.status}  tags=[${after?.tags.join(", ")}]\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
