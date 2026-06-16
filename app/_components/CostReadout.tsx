// app/_components/CostReadout.tsx
import { formatUsd } from "@/lib/format";

/** Inline per-ticket cost chip: "$0.0515 · 5 calls · 9 tools". */
export function CostReadout({
  costUsd,
  calls,
  tools,
}: {
  costUsd: number;
  calls: number;
  tools: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">
      <span className="font-semibold text-neutral-900">{formatUsd(costUsd)}</span>
      <span aria-hidden>·</span>
      <span>
        {calls} call{calls === 1 ? "" : "s"}
      </span>
      <span aria-hidden>·</span>
      <span>
        {tools} tool{tools === 1 ? "" : "s"}
      </span>
    </span>
  );
}
