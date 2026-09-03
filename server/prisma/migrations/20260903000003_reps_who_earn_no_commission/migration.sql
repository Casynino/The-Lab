-- Some reps are not on commission at all.
--
-- Not every rep is paid the same way. One may settle boxes and be paid by
-- another arrangement, in which case commission accruing quietly in the
-- background is a debt the business does not owe — and it lands in what the
-- owner is told he owes out of his own pocket.
--
-- The switch defaults to true, so every existing rep keeps earning exactly as
-- before and nothing about anybody else changes.
ALTER TABLE "sales_representatives"
  ADD COLUMN IF NOT EXISTS "earnsCommission" BOOLEAN NOT NULL DEFAULT true;

-- REP-010 is one of them. Turning the switch off is enough on its own: the
-- service reads it and returns nothing earned, nothing available and no fines
-- against a balance that does not exist, so his commission history stops
-- applying to him without a single row being destroyed. The rows stay as the
-- record of what happened, which is what a ledger is for — and if he is ever
-- put back on commission, flipping the switch restores the lot.
--
-- Matched on code AND name so it cannot land on a different rep, and a no-op
-- on any database where that pair does not exist.
UPDATE sales_representatives r
   SET "earnsCommission" = false,
       "commissionAdjustment" = 0,
       "commissionAdjustmentNote" = NULL,
       "commissionAdjustedAt" = NULL
  FROM users u
 WHERE u.id = r."userId"
   AND r.code = 'REP-010'
   AND lower(u.name) LIKE 'amoma%';
