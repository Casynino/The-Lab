-- Rep commissions are funded by the owner, not by the business.
--
-- The owner pays every rep in physical cash out of his own pocket. The ledger
-- recorded only the payment, so a business account was drained for money it
-- never held; and to compensate he had been recording his own cash as INCOME
-- just before each payout, which made his personal money look like business
-- earnings and inflated money-in.
--
-- Two corrections, both additive — nothing is deleted, every row keeps its
-- history and its number:
--   1. INCOME rows that exist only to fund a commission payout (same day,
--      same amount, same account) are relabelled as the owner's contribution.
--   2. Commission payouts with no matching contribution get one, dated with
--      the payout, so the business balance is restored to what it really was.
--
-- Profit does not move: commission remains a genuine cost of the sales that
-- earned it. Only whose money paid it changes.

-- 1. Relabel the owner's cash that was filed as income.
UPDATE finance_transactions f
   SET type        = 'OWNER_CONTRIBUTION',
       category    = 'Owner contribution',
       description = COALESCE(NULLIF(f.description, ''), 'Own money in to pay a rep')
 WHERE f.type = 'INCOME'
   AND f.direction = 'IN'
   AND EXISTS (
     SELECT 1 FROM finance_transactions c
      WHERE c.type = 'COMMISSION_PAYMENT'
        AND c.direction = 'OUT'
        AND c."accountId" = f."accountId"
        AND c.amount = f.amount
        AND date_trunc('day', c."occurredAt") = date_trunc('day', f."occurredAt")
   );

-- 2. Fund the payouts that never had the owner's money recorded against them.
--    The new row's number is derived from the payout's own id, which is
--    unique by construction — deriving it from a running counter collided.
INSERT INTO finance_transactions
  (id, "txnNumber", "accountId", direction, type, amount, category, description,
   "refType", "refId", "occurredAt", "createdById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'FTX-OWN-' || c.id,
  c."accountId",
  'IN',
  'OWNER_CONTRIBUTION',
  c.amount,
  'Owner contribution',
  'Own money in to pay a rep (recorded retrospectively — the payout was funded from the owner''s pocket)',
  'CommissionWithdrawal',
  c.id,
  c."occurredAt",
  c."createdById",
  now() AT TIME ZONE 'UTC',
  now() AT TIME ZONE 'UTC'
  FROM finance_transactions c
 WHERE c.type = 'COMMISSION_PAYMENT'
   AND c.direction = 'OUT'
   AND NOT EXISTS (
     SELECT 1 FROM finance_transactions o
      WHERE o.type = 'OWNER_CONTRIBUTION'
        AND o.direction = 'IN'
        AND o."accountId" = c."accountId"
        AND o.amount = c.amount
        AND date_trunc('day', o."occurredAt") = date_trunc('day', c."occurredAt")
   );
