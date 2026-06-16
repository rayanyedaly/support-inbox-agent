// app/_components/dashboard/TokenSplitBar.tsx
import { formatTokens } from "@/lib/format";

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="mb-[13px]">
      <div className="mb-1 flex items-center justify-between font-mono">
        <span className="text-[11px] text-ink-3">{label}</span>
        <span className="text-[11.5px] font-semibold text-ink">{formatTokens(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-[3px] bg-inset">
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${(value / total) * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function TokenBars({ input, output, cache }: { input: number; output: number; cache: number }) {
  const total = input + output + cache || 1;
  return (
    <div>
      <Bar label="input" value={input} total={total} color="var(--accent)" />
      <Bar label="output" value={output} total={total} color="var(--bar)" />
      <Bar label="cache read" value={cache} total={total} color="var(--resolved)" />
    </div>
  );
}
