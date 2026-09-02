-- Undo the over-sweep. Put every receipt back in its brand's wallet.
--
-- Migration ...0006 treated a receipt as misplaced whenever no rep had named
-- the account it was paid into. That test was too broad. Plenty of genuine
-- wallet money was recorded before reps were ever asked to name an account, so
-- the sweep carried 204,000 of real money out of the wallets along with the
-- money that had never been in one: Airtel read 550,000 where the owner holds
-- 574,000, and M-Pesa lost 180,000 it really has.
--
-- Trying to tell one historical row from another by inference has now been
-- wrong twice, so this stops inferring and simply puts them all back, at which
-- point the wallets reconcile with money in and money out again. The 501,000
-- that genuinely never sat in a wallet is a separate correction, made
-- deliberately and visibly rather than buried in a data migration.
--
-- Nothing is deleted and no money is invented here; rows return to the wallet
-- of the brand they belong to.
WITH commission AS (
  SELECT id FROM business_accounts WHERE type = 'COMMISSION' ORDER BY "createdAt" LIMIT 1
),
fallback AS (
  SELECT a.id FROM business_accounts a
   WHERE a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
   ORDER BY a."isDefault" DESC, a."sortOrder", a."createdAt" LIMIT 1
),
misfiled AS (
  SELECT f.id AS txn_id,
         COALESCE(
           f."brandId",
           (SELECT p."brandId"
              FROM sale_items si
              JOIN products p ON p.id = si."productId"
             WHERE si."saleId" = f."refId"
               AND p."brandId" IS NOT NULL
             GROUP BY p."brandId"
             ORDER BY SUM(si."lineTotal") DESC
             LIMIT 1)
         ) AS brand_id
    FROM finance_transactions f
   WHERE f.type = 'SETTLEMENT'
     AND f.direction = 'IN'
     AND f."accountId" IN (
       SELECT id FROM business_accounts WHERE type IN ('CASH', 'COMMISSION')
     )
)
UPDATE finance_transactions f
   SET "accountId" = COALESCE(
         (SELECT a.id FROM business_accounts a
           WHERE a."brandId" = m.brand_id
             AND a."isActive"
             AND a.type NOT IN ('CASH', 'COMMISSION')
           ORDER BY a."sortOrder", a."createdAt"
           LIMIT 1),
         (SELECT fb.id FROM fallback fb LIMIT 1)
       ),
       notes = NULL
  FROM misfiled m
 WHERE f.id = m.txn_id
   AND EXISTS (SELECT 1 FROM fallback);
