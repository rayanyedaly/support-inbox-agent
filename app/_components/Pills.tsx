// app/_components/Pills.tsx
//
// Presentational, color-coded pills for ticket status / priority / channel and the
// DRAFT/SENT message status. Server components (no interactivity).

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}

const STATUS: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700 ring-blue-600/20",
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  ESCALATED: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

const PRIORITY: Record<string, string> = {
  LOW: "bg-neutral-100 text-neutral-600 ring-neutral-500/20",
  MEDIUM: "bg-sky-50 text-sky-700 ring-sky-600/20",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-600/20",
  URGENT: "bg-red-50 text-red-700 ring-red-600/20",
};

const CHANNEL_ICON: Record<string, string> = {
  EMAIL: "✉️",
  CHAT: "💬",
  WHATSAPP: "🟢",
  WEB: "🌐",
};

export function StatusPill({ status }: { status: string }) {
  return <Pill label={status} className={STATUS[status] ?? STATUS.OPEN} />;
}

export function PriorityPill({ priority }: { priority: string }) {
  return <Pill label={priority} className={PRIORITY[priority] ?? PRIORITY.MEDIUM} />;
}

export function ChannelTag({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
      <span aria-hidden>{CHANNEL_ICON[channel] ?? "•"}</span>
      {channel.toLowerCase()}
    </span>
  );
}

export function MessageStatusPill({ status }: { status: string }) {
  return status === "DRAFT" ? (
    <Pill label="DRAFT" className="bg-violet-50 text-violet-700 ring-violet-600/30" />
  ) : (
    <Pill label="SENT" className="bg-emerald-50 text-emerald-700 ring-emerald-600/20" />
  );
}

export function PlanTag({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    FREE: "text-neutral-500",
    PRO: "text-indigo-600",
    ENTERPRISE: "text-fuchsia-600",
  };
  return (
    <span className={`text-xs font-medium ${styles[plan] ?? styles.FREE}`}>{plan}</span>
  );
}
