-- One settlement account per brand — enforced, not assumed.
--
-- The previous migration bound each wallet to its brand and guarded with
--   NOT EXISTS (SELECT 1 FROM business_accounts WHERE "brandId" = <brand>)
-- but a guard like that is evaluated against the snapshot taken BEFORE the
-- statement ran, so it cannot see rows the same UPDATE is binding. Two
-- matching accounts — say "M-Pesa" and an "Equity Bank — OHIS deposits" whose
-- notes mention OHIS — would both bind, and the rep would be shown a choice
-- again. The owner asked for exactly one option.
--
-- This corrects that, and is idempotent: with one account per brand it changes
-- nothing. Nothing is deleted; extra accounts are merely unbound and go back
-- to being general accounts.
WITH ranked AS (
  SELECT
    id,
    "brandId",
    row_number() OVER (
      PARTITION BY "brandId"
      ORDER BY
        -- The named wallets win: they are the ones the owner settles into.
        (name IN ('M-Pesa', 'Airtel Money')) DESC,
        -- Then a mobile-money account over a bank or other.
        (type = 'MOBILE_MONEY') DESC,
        "sortOrder",
        "createdAt"
    ) AS rank
  FROM business_accounts
  WHERE "brandId" IS NOT NULL
    AND type <> 'COMMISSION'
)
UPDATE business_accounts a
   SET "brandId" = NULL
  FROM ranked r
 WHERE a.id = r.id
   AND r.rank > 1;
