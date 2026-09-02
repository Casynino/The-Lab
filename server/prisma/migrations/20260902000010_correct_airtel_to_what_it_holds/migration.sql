-- Correct the Airtel wallet to what it actually holds.
--
-- The owner has stated the figure directly, twice, and instructed that the
-- difference be removed: "civily only have 574,000, the other money remove it,
-- it was not in our math, it was just a mistake."
--
-- The app has been showing 1,075,000. The 501,000 above that came from
-- settlement receipts that were filed against the old Cash account when no
-- payment account had been recorded, and which two earlier migrations of mine
-- moved into the wallets on the assumption that money recorded as received
-- must have landed somewhere. It did not. It was a recording error.
--
-- Why a correction rather than deleting those rows: they cannot be told apart
-- from genuine receipts. The same test that would find them also catches
-- 204,000 of real wallet money — that is exactly the mistake migration
-- ...0009 had to undo. A single correction against a figure the owner has
-- stated is honest, visible in the ledger, and reversible; guessing at rows a
-- third time is neither.
--
-- ADJUSTMENT is the right type: it moves the balance and counts in money out,
-- so the cash-flow totals still reconcile with the wallets, and it never
-- touches profit — profit is computed from the sales themselves.
--
-- Guarded three ways: the wallet must exist and be active; it must actually
-- hold at least this much, so this is a no-op on any database that does not
-- carry the error; and the fixed txnNumber makes a second run change nothing.
-- Nothing is deleted. Delete this one row and the previous figure returns.
INSERT INTO finance_transactions
  ("id", "txnNumber", "accountId", "direction", "type", "amount", "category",
   "description", "notes", "occurredAt", "createdAt", "updatedAt")
SELECT
  'ftx_correct_airtel_to_574000_v1',
  'FTX-ADJ-AIRTEL-CORRECTION',
  a.id,
  'OUT',
  'ADJUSTMENT',
  501000,
  'Correction',
  'Correction — receipts recorded against this wallet that never reached it',
  'Settlement receipts filed with no payment account, which earlier migrations moved into this wallet on the assumption the money had landed here. It had not. Removed at the owner''s instruction, against the balance he confirmed: 574,000. Delete this row to undo.',
  now(), now(), now()
  FROM business_accounts a
 WHERE a.name = 'Airtel Money'
   AND a."isActive"
   AND NOT EXISTS (
     SELECT 1 FROM finance_transactions x
      WHERE x."txnNumber" = 'FTX-ADJ-AIRTEL-CORRECTION'
   )
   AND (
     a."openingBalance"
     + COALESCE((SELECT SUM(t.amount) FROM finance_transactions t
                  WHERE t."accountId" = a.id AND t.direction = 'IN'), 0)
     - COALESCE((SELECT SUM(t.amount) FROM finance_transactions t
                  WHERE t."accountId" = a.id AND t.direction = 'OUT'), 0)
   ) >= 501000
 LIMIT 1;
