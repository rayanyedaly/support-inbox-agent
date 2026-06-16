export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Support Inbox Agent</h1>
      <p className="text-neutral-600">
        Single-workspace support / ops inbox assistant. A human works the ticket
        queue; an AI agent chains tools over the app&apos;s data and stages a
        reply or triage action a human approves.
      </p>
      <p className="text-sm text-neutral-500">
        Phase 0 scaffold. The hand-rolled agent loop is Phase 1; the inbox,
        ticket thread, agent panel, and cost dashboard land in Phase 2.
      </p>
    </main>
  );
}
