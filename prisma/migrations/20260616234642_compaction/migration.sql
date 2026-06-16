-- CreateTable
CREATE TABLE "Compaction" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "tokensBefore" INTEGER NOT NULL,
    "tokensAfter" INTEGER NOT NULL,
    "tokensSaved" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Compaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Compaction_ticketId_idx" ON "Compaction"("ticketId");

-- CreateIndex
CREATE INDEX "Compaction_createdAt_idx" ON "Compaction"("createdAt");

-- AddForeignKey
ALTER TABLE "Compaction" ADD CONSTRAINT "Compaction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
