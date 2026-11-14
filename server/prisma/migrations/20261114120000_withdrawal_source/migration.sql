-- Bonus in the wallet (owner, 14 Nov 2026): a withdrawal now says what it takes money from.
--
-- ADDITIVE ONLY: one new enum, one new column with a constant default, one new index. No existing row is
-- rewritten (a constant default is a catalogue change on Postgres 11+), nothing is dropped or renamed. Every
-- withdrawal made before this reads as COMMISSION, which is what each of them was, so no commission figure moves.

-- CreateEnum
CREATE TYPE "WithdrawalSource" AS ENUM ('COMMISSION', 'BONUS');

-- AlterTable
ALTER TABLE "commission_withdrawals" ADD COLUMN "source" "WithdrawalSource" NOT NULL DEFAULT 'COMMISSION';

-- CreateIndex
CREATE INDEX "commission_withdrawals_salesRepId_source_status_idx" ON "commission_withdrawals"("salesRepId", "source", "status");
