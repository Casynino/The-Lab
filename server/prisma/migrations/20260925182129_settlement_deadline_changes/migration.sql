-- CreateTable
CREATE TABLE "settlement_deadline_changes" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "shiftSeconds" INTEGER NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT,
    "unrecorded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "settlement_deadline_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_deadline_changes_settlementId_createdAt_idx" ON "settlement_deadline_changes"("settlementId", "createdAt");

-- AddForeignKey
ALTER TABLE "settlement_deadline_changes" ADD CONSTRAINT "settlement_deadline_changes_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

