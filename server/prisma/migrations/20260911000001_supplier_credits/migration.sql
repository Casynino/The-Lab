-- Goods sent back to a supplier.
--
-- Until now a supplier's balance was purchased minus paid, and there was no way
-- to record stock going the other way. The only levers available were to edit a
-- purchase order after the fact, or to log a payment that never happened — one
-- rewrites history, the other puts shillings in "total paid" that never left an
-- account.
--
-- A return is the opposite of a purchase, not a payment, so it comes off what
-- was bought: outstanding becomes purchased − returned − paid.
--
-- Money only. The boxes are corrected through the stock ledger like any other
-- movement, so this never becomes a second, competing way to change what is on
-- the shelf.
--
-- Purely additive: a new table, nothing altered, no enum touched. Every
-- existing balance is unchanged until a row is written here.
CREATE TABLE IF NOT EXISTS "supplier_credits" (
  "id"          TEXT NOT NULL,
  "supplierId"  TEXT NOT NULL,
  "amount"      DECIMAL(16,2) NOT NULL,
  "reason"      TEXT NOT NULL,
  "occurredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supplier_credits_supplierId_idx"  ON "supplier_credits"("supplierId");
CREATE INDEX IF NOT EXISTS "supplier_credits_occurredAt_idx" ON "supplier_credits"("occurredAt");

ALTER TABLE "supplier_credits"
  ADD CONSTRAINT "supplier_credits_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
