// app/_components/MessageBubble.tsx
//
// One message in the thread, chat-bubble styled by role. A DRAFT AI message is
// visually distinct (dashed violet) and renders its approval action via children.

import type { ReactNode } from "react";
import { formatDate } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  AI: "AI assistant",
  AGENT: "Support agent",
};

export function MessageBubble({
  role,
  body,
  status,
  createdAt,
  children,
}: {
  role: string;
  body: string;
  status: string;
  createdAt: Date;
  children?: ReactNode;
}) {
  const isCustomer = role === "CUSTOMER";
  const isDraft = role === "AI" && status === "DRAFT";

  const bubble = isCustomer
    ? "bg-white border-neutral-200"
    : role === "AI"
      ? isDraft
        ? "border-dashed border-violet-300 bg-violet-50"
        : "border-indigo-200 bg-indigo-50"
      : "border-slate-200 bg-slate-100";

  return (
    <div className={`flex flex-col ${isCustomer ? "items-start" : "items-end"}`}>
      <div className={`max-w-[82%] rounded-2xl border px-4 py-3 ${bubble}`}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">{ROLE_LABEL[role] ?? role}</span>
          {isDraft && (
            <span className="rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
              Draft — awaiting approval
            </span>
          )}
          <span aria-hidden>·</span>
          <span>{formatDate(createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
          {body}
        </p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  );
}
