import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  StatusPill,
  PriorityPill,
  ChannelTag,
  PlanTag,
} from "@/app/_components/Pills";
import { formatDate } from "@/lib/format";

// Always read fresh — ticket state changes when the agent runs / a draft is approved.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const tickets = await prisma.ticket.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      customer: { select: { name: true, plan: true } },
      _count: { select: { messages: true, llmCalls: true } },
    },
  });

  return (
    <main>
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-neutral-500">
            {tickets.length} ticket{tickets.length === 1 ? "" : "s"} in the queue
          </p>
        </div>
      </header>

      <ul className="space-y-2">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tickets/${t.id}`}
              className="block rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-900">{t.subject}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-sm text-neutral-500">
                    <span className="truncate">{t.customer.name}</span>
                    <PlanTag plan={t.customer.plan} />
                    <span aria-hidden>·</span>
                    <ChannelTag channel={t.channel} />
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityPill priority={t.priority} />
                    <StatusPill status={t.status} />
                  </div>
                  <p className="flex items-center gap-2 text-xs text-neutral-400">
                    <span>💬 {t._count.messages}</span>
                    {t._count.llmCalls > 0 && <span title="agent has run">🤖 ran</span>}
                    <span>{formatDate(t.updatedAt)}</span>
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
