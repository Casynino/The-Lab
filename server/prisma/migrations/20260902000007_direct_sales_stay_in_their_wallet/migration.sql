-- Narrow the previous migration to rep settlements only.
--
-- ...0006 moves a receipt back to the retired Cash account when no rep vouched
-- for the account it was paid into. That test is right for a SETTLEMENT, where
-- a rep names the account on their submission. It is wrong for a direct
-- warehouse sale: those have no rep and therefore no submission, so every one
-- of them looks unvouched and would be swept out of the wallet it was banked
-- into — taking real money off the totals.
--
-- The previous migration is already applied, so it cannot be edited. This puts
-- back anything of that kind it took, using the brand on the row, then the
-- brand of its sale. Nothing is deleted.
WITH cash AS (
  SELECT id FROM business_accounts WHERE type = 'CASH' ORDER BY "createdAt" LIMIT 1
),
fallback AS (
  SELECT a.id FROM business_accounts a
   WHERE a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
   ORDER BY a."isDefault" DESC, a."sortOrder", a."createdAt" LIMIT 1
),
misplaced AS (
  SELECT f.id AS txn_id,
         COALESCE(
           f."brandId",
           (SELECT p."brandId" FROM sale_items si JOIN products p ON p.id = si."productId"
             WHERE si."saleId" = f."refId" AND p."brandId" IS NOT NULL
             GROUP BY p."brandId" ORDER BY SUM(si."lineTotal") DESC LIMIT 1)
         ) AS brand_id
    FROM finance_transactions f
   WHERE f.type = 'WAREHOUSE_SALE'
     AND f.direction = 'IN'
     AND f."accountId" = (SELECT id FROM cash)
)
UPDATE finance_transactions f
   SET "accountId" = COALESCE(
         (SELECT a.id FROM business_accounts a
           WHERE a."brandId" = m.brand_id AND a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
           ORDER BY a."sortOrder", a."createdAt" LIMIT 1),
         (SELECT fb.id FROM fallback fb LIMIT 1)
       )
  FROM misplaced m
 WHERE f.id = m.txn_id
   AND EXISTS (SELECT 1 FROM fallback)
   AND COALESCE(
         (SELECT a.id FROM business_accounts a
           WHERE a."brandId" = m.brand_id AND a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
           ORDER BY a."sortOrder", a."createdAt" LIMIT 1),
         (SELECT fb.id FROM fallback fb LIMIT 1)
       ) <> f."accountId";
