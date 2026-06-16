// app/_components/dashboard/StatCard.tsx
export function StatCard({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub?: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-[11px] border border-border bg-surface px-[17px] py-[15px]">
      <div className="font-mono text-[9.5px] tracking-[0.06em] text-faint">{label}</div>
      <div className="mt-2 font-mono text-[26px] font-semibold tracking-[-0.02em] text-ink">
        {value}
      </div>
      {sub && (
        <div
          className="mt-1.5 text-[11.5px] text-muted"
          style={good ? { color: "var(--resolved-fg)" } : undefined}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
