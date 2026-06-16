import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ticketCostSummary } from "@/lib/queries";
import {
  StatusPill,
  PriorityPill,
  ChannelTag,
  PlanTag,
} from "@/app/_components/Pills";
import { CostReadout } from "@/app/_components/CostReadout";
import { MessageBubble } from "@/app/_components/MessageBubble";
import { ApproveButton } from "@/app/_components/ApproveButton";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) notFound();

  const cost = await ticketCostSummary(id);

  return (
    <main className="space-y-6">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Inbox
      </Link>

      <header className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{ticket.subject}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
              <span className="font-medium text-neutral-700">
                {ticket.customer.name}
              </span>
              <PlanTag plan={ticket.customer.plan} />
              <span aria-hidden>·</span>
              <span>{ticket.customer.email}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <PriorityPill priority={ticket.priority} />
              <StatusPill status={ticket.status} />
            </div>
            <ChannelTag channel={ticket.channel} />
          </div>
        </div>
        <div className="mt-4">
          <CostReadout costUsd={cost.costUsd} calls={cost.calls} tools={cost.tools} />
        </div>
      </header>

      <section className="space-y-3">
        {ticket.messages.map((m) => (
          <MessageBubble
            key={m.id}
            role={m.role}
            body={m.body}
            status={m.status}
            createdAt={m.createdAt}
          >
            {m.role === "AI" && m.status === "DRAFT" && (
              <ApproveButton messageId={m.id} ticketId={ticket.id} />
            )}
          </MessageBubble>
        ))}
      </section>

      {/* Agent panel (Run agent + live tool-chain stream) mounts here in the next commit. */}
    </main>
  );
}
