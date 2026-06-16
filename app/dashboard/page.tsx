import Link from "next/link";
import { dashboardStats } from "@/lib/queries";
import { formatUsd, formatTokens } from "@/lib/format";
import { StatCard } from "@/app/_components/dashboard/StatCard";
import { SpendBars } from "@/app/_components/dashboard/SpendBars";
import { TokenBars } from "@/app/_components/dashboard/TokenSplitBar";
import { StatusPill } from "@/app/_components/Pills";

export const dynamic = "force-dynamic";

const MODEL_ROLE: Record<string, string> = {
  "claude-sonnet-4-6": "agent",
  "claude-haiku-4-5": "compaction",
};

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[11px] border border-border bg-surface px-5 py-[18px]">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
        {sub && <span className="font-mono text-[10.5px] text-faint">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const s = await dashboardStats();
  const maxModel = Math.max(...s.spendByModel.map((m) => m.spend), 0.000001);

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-10 flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-6">
        <h1 className="text-base font-semibold text-ink">Dashboard</h1>
        <span className="font-mono text-[11px] text-muted">cost &amp; observability</span>
      </header>

      <div className="flex-1 space-y-3.5 px-6 py-[22px]">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard label="TOTAL SPEND" value={formatUsd(s.totalSpend)} sub={`${s.totalCalls} model calls`} />
          <StatCard label="TICKETS RESOLVED" value={String(s.resolvedCount)} sub={`of ${s.totalTickets} tickets`} />
          <StatCard label="AVG COST / RESOLVED" value={formatUsd(s.avgCostPerResolved)} sub="per resolved ticket" />
          <StatCard
            label="TOKENS"
            value={formatTokens(s.inputTokens + s.outputTokens)}
            sub={`${formatTokens(s.cacheReadTokens)} from cache`}
            good={s.cacheReadTokens > 0}
          />
        </div>

        {/* Spend by day + token economics */}
        <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
          <Card title="Spend by day" sub="USD · all model calls">
            <SpendBars data={s.spendByDay} />
          </Card>
          <Card title="Token economics">
            <TokenBars input={s.inputTokens} output={s.outputTokens} cache={s.cacheReadTokens} />
            <div className="mt-1 rounded-[9px] border border-dashed border-accent-bd bg-accent-soft px-[13px] py-[11px]">
              <div className="font-mono text-[9.5px] font-semibold tracking-[0.06em] text-accent-ink">
                COMPACTION SAVINGS
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-[20px] font-semibold" style={{ color: "var(--resolved-fg)" }}>
                  {formatUsd(s.compactionSavings.costSaved)}
                </span>
                <span className="text-[11.5px] text-ink-3">
                  {formatTokens(s.compactionSavings.tokensSaved)} tokens · {s.compactionSavings.count} compactions
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Spend by model + recent runs */}
        <div className="grid gap-3.5 lg:grid-cols-[1fr_1.9fr]">
          <Card title="Spend by model">
            {s.spendByModel.length === 0 && <p className="text-[12px] text-faint">No model calls yet.</p>}
            <div className="space-y-3">
              {s.spendByModel.map((m, i) => (
                <div key={m.model} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold text-ink">{m.model}</span>
                    <span className="rounded border border-border px-1.5 text-[10.5px] text-faint">
                      {MODEL_ROLE[m.model] ?? "model"}
                    </span>
                    <span className="ml-auto font-mono text-[13px] font-semibold text-ink">{formatUsd(m.spend)}</span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-[3px] bg-inset">
                    <div
                      className="h-full rounded-[3px]"
                      style={{ width: `${(m.spend / maxModel) * 100}%`, background: i === 0 ? "var(--accent)" : "var(--bar)" }}
                    />
                  </div>
                  <div className="font-mono text-[10.5px] text-faint">{m.calls} calls</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Recent agent runs">
            <div className="grid grid-cols-[88px_minmax(0,1fr)_104px_64px] gap-3 border-b border-border-2 pb-2 font-mono text-[9px] tracking-[0.05em] text-faint">
              <span>TICKET</span>
              <span>SUBJECT</span>
              <span>STATUS</span>
              <span className="text-right">COST</span>
            </div>
            {s.recentRuns.length === 0 && (
              <p className="py-4 text-[12px] text-faint">No agent runs yet.</p>
            )}
            {s.recentRuns.map((r) => (
              <Link
                key={r.ticketId}
                href={`/tickets/${r.ticketId}`}
                className="grid grid-cols-[88px_minmax(0,1fr)_104px_64px] items-center gap-3 border-b border-border-2 py-[11px] transition hover:bg-inset"
              >
                <span className="font-mono text-[11px] text-muted">{r.ticketId.slice(0, 8)}</span>
                <span className="truncate text-[13px] text-ink">{r.subject}</span>
                <StatusPill status={r.status} />
                <span className="text-right font-mono text-[11.5px] font-semibold text-ink">
                  {formatUsd(r.costUsd)}
                </span>
              </Link>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
