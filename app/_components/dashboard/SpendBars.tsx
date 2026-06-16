// app/_components/dashboard/SpendBars.tsx
import { formatUsd } from "@/lib/format";

export function SpendBars({ data }: { data: { day: string; spend: number }[] }) {
  if (data.length === 0) {
    return <p className="text-[12px] text-faint">No spend recorded yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.spend)) || 1;
  const peak = data.reduce((a, b) => (b.spend > a.spend ? b : a));

  return (
    <div>
      <div className="mb-4 font-mono text-[10.5px] text-faint">
        peak {formatUsd(peak.spend)} · {peak.day.slice(5)}
      </div>
      <div className="flex items-end gap-2" style={{ height: 176 }}>
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return (
            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-[7px]">
              <div className="flex w-full items-end" style={{ height: 176 }}>
                <div
                  className="w-full"
                  style={{
                    height: `${Math.max((d.spend / max) * 100, 2)}%`,
                    background: last ? "var(--accent)" : "var(--bar)",
                    borderRadius: "4px 4px 2px 2px",
                  }}
                />
              </div>
              <span
                className="font-mono text-[9px]"
                style={{ color: last ? "var(--accent-ink)" : "var(--faint)", fontWeight: last ? 600 : 400 }}
              >
                {d.day.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
