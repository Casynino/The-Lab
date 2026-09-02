-- Undo a wrong guess about where money went.
--
-- Migrations ...0003 and ...0005 took the receipts that had piled up on the
-- Cash account and filed them into the brand wallets, on the reasoning that
-- money which came in must have landed somewhere real. The owner has since
-- said plainly that it did not: Airtel Money holds 574,000 and nothing more,
-- while the app was showing 1,075,000 — inflated by exactly the 501,000 that
-- had been sitting on Cash.
--
-- What really happened is the other reading. That money was collected in cash
-- and handed straight back out as rep commission. The commission side is now
-- off-account by design — it is the owner's own money, not the business's — so
-- excluding the payments while keeping the receipts invented money that no
-- wallet has ever held.
--
-- The rule that separates the two cases: WHO SAID SO. When a rep recorded the
-- account they paid into, the money genuinely is in that account and must not
-- be touched. When nobody recorded one, the placement was inferred by those
-- migrations, and the inference is what was wrong. Only inferred rows move
-- back, onto the retired Cash account — which is excluded from every balance,
-- so the money leaves the totals while the history of it stays intact.
--
-- Nothing is deleted. Reversible: re-pointing these rows at a wallet restores
-- the previous state exactly.
WITH cash AS (
  SELECT id FROM business_accounts WHERE type = 'CASH' ORDER BY "createdAt" LIMIT 1
),
-- A receipt is "vouched for" only when the rep named the account themselves.
vouched AS (
  SELECT DISTINCT s."saleId" AS sale_id
    FROM settlement_submissions s
    JOIN business_accounts a ON a.id = s."accountId"
   WHERE s."saleId" IS NOT NULL
     AND a.type NOT IN ('CASH', 'COMMISSION')
),
inferred AS (
  SELECT f.id
    FROM finance_transactions f
    JOIN business_accounts a ON a.id = f."accountId"
   WHERE f.type IN ('SETTLEMENT', 'WAREHOUSE_SALE')
     AND f.direction = 'IN'
     AND a.type NOT IN ('CASH', 'COMMISSION')
     AND NOT EXISTS (
       SELECT 1 FROM vouched v
        WHERE f."refType" = 'Sale' AND v.sale_id = f."refId"
     )
)
UPDATE finance_transactions f
   SET "accountId" = (SELECT id FROM cash),
       notes = COALESCE(
         f.notes,
         'Collected in cash and paid straight out as rep commission. Kept on the retired Cash account, which no balance counts, because no wallet ever held it.'
       )
  FROM inferred i
 WHERE f.id = i.id
   AND EXISTS (SELECT 1 FROM cash)
   AND f."accountId" <> (SELECT id FROM cash);

-- Cash stays retired. It is holding history, not money, and must never be
-- offered as a place to put anything new.
UPDATE business_accounts
   SET "isActive" = false, "isDefault" = false
 WHERE type = 'CASH' AND "isActive";
