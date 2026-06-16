// app/_components/ApproveButton.tsx
"use client";

import { useTransition } from "react";
import { approveMessage } from "@/app/actions/messages";

export function ApproveButton({
  messageId,
  ticketId,
}: {
  messageId: string;
  ticketId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => approveMessage(messageId, ticketId))}
      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Approving…" : "✓ Approve & Send"}
    </button>
  );
}
