-- CLEAR THE LAST CASH — and retire the account for good.
--
-- Migration 20260902000003 moved the settlement money that had been filed
-- against Cash onto the wallet each brand really settles to, but it moved only
-- what it could prove: a row carrying its own brandId, or a row whose sale sold
-- exactly ONE brand. A sale that mixed OHIS and Civlily, and a row with no
-- brand evidence at all, were deliberately left where they were — so Cash kept
-- a balance, and an account with a balance is never deactivated (deactivating
-- one drops it from every total, which would make real money vanish).
--
-- Production is left showing a Cash card holding TSh 46,000 that the owner does
-- not recognise and wants gone. It is money that physically arrived, so it is
-- not deleted and it is not filed against the Commission account either: that
-- account is off-account by construction (finance.service.js OFF_ACCOUNT_WHERE)
-- and every row on it is subtracted back out of every balance, so parking real
-- income there would erase it from his totals. He asked for the Cash card gone;
-- he did not ask to be poorer.
--
-- So the remainder is placed by evidence, strongest first:
--   (1) the brand already on the row;
--   (2) the single brand its sale sold;
--   (3) for a MIXED sale, the brand with the greatest value in that sale
--       (SUM of sale_items.lineTotal, which is quantity x price less the line
--       discount — the closest thing the schema has to "what this brand was
--       worth in this sale");
--   (4) last resort, the default settlement wallet, because money that came in
--       physically landed somewhere real.
--
-- Nothing is deleted, no amount and no direction changes, and no row leaves the
-- ledger — only WHICH account it is filed under. The sum of every account's
-- balance is therefore identical before and after; all this moves is which
-- pocket the same shillings are counted in.
--
-- Idempotent by construction: every statement is driven off rows that are still
-- filed against a CASH account, and after the first run there are none.

-- ── 1. The record of commission is held in ONE place ────────────────────────
-- Re-run of 20260902000003 step 3, so that a payout written between the two
-- migrations (or one that landed on Cash because the Commission account was
-- briefly missing) is gathered back before the sweep below runs. These rows are
-- off-account: they move no balance, here or anywhere, so this changes no
-- figure on any screen. It exists so that step 2 can never reach a commission
-- row and re-file the owner's own cash against a brand's wallet.
UPDATE finance_transactions f
   SET "accountId" = (SELECT ca.id FROM business_accounts ca WHERE ca.type = 'COMMISSION' ORDER BY ca."createdAt" LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM business_accounts ca WHERE ca.type = 'COMMISSION')
   AND f."accountId" <> (SELECT ca.id FROM business_accounts ca WHERE ca.type = 'COMMISSION' ORDER BY ca."createdAt" LIMIT 1)
   AND (
     f.type = 'COMMISSION_PAYMENT'
     OR (f.type = 'OWNER_CONTRIBUTION' AND COALESCE(f."refType", '') = 'CommissionWithdrawal')
   );

-- ── 2. Everything still on Cash goes where the money really went ────────────
-- Note the shape of the off-account test: `COALESCE(refType, '')`, never a bare
-- inequality. refType is NULL on most rows, and `NOT (type = X AND refType = Y)`
-- evaluates to NULL — not TRUE — for a row with a NULL refType, which would
-- have silently dropped almost every stranded row out of this sweep and left
-- Cash exactly where it started.
WITH fallback AS (
  -- The same choice finance.service.defaultAccount() makes: the flagged default
  -- if there is one, else the first wallet by sort order. Never Cash (that is
  -- what is being emptied) and never the Commission record (it holds no money).
  SELECT a.id
    FROM business_accounts a
   WHERE a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
   ORDER BY a."isDefault" DESC, a."sortOrder", a."createdAt"
   LIMIT 1
),
stranded AS (
  SELECT f.id AS txn_id, f."brandId" AS row_brand, f."refType" AS ref_type, f."refId" AS ref_id
    FROM finance_transactions f
    JOIN business_accounts c ON c.id = f."accountId" AND c.type = 'CASH'
   WHERE NOT (
     f.type = 'COMMISSION_PAYMENT'
     OR (f.type = 'OWNER_CONTRIBUTION' AND COALESCE(f."refType", '') = 'CommissionWithdrawal')
   )
),
sale_brand AS (
  -- What each brand was worth inside the sale this row mirrors.
  SELECT s.txn_id,
         p."brandId"            AS brand_id,
         SUM(si."lineTotal")    AS line_value,
         SUM(si."baseQuantity") AS units
    FROM stranded s
    JOIN sale_items si ON si."saleId" = s.ref_id
    JOIN products   p  ON p.id = si."productId"
   WHERE s.ref_type = 'Sale'
     AND p."brandId" IS NOT NULL
   GROUP BY s.txn_id, p."brandId"
),
sale_shape AS (
  SELECT txn_id, count(*) AS brand_count FROM sale_brand GROUP BY txn_id
),
dominant AS (
  -- Evidence (2) and (3) in one: with a single brand there is only one row to
  -- pick; with several, the biggest by value wins. Ties break on units and then
  -- on the brand id, so the answer is the same on every run and on every
  -- database — a guess is acceptable here, a different guess each time is not.
  SELECT DISTINCT ON (txn_id) txn_id, brand_id
    FROM sale_brand
   ORDER BY txn_id, line_value DESC, units DESC, brand_id
),
resolved AS (
  SELECT
    s.txn_id,
    s.row_brand,
    d.brand_id                     AS sale_brand,
    COALESCE(sh.brand_count, 0)    AS brand_count,
    CASE
      -- (1) the row's own brand. If that brand somehow has no wallet, fall back
      -- only to an account that may legally hold its money: an unbound one, or
      -- one bound to the same brand. Anything else would put a branded row on
      -- another brand's wallet, which the application rejects on edit.
      WHEN s.row_brand IS NOT NULL THEN COALESCE(
        (SELECT a.id FROM business_accounts a
          WHERE a."brandId" = s.row_brand AND a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
          ORDER BY a."sortOrder", a."createdAt" LIMIT 1),
        (SELECT a.id FROM business_accounts a
          WHERE a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
            AND (a."brandId" IS NULL OR a."brandId" = s.row_brand)
          ORDER BY a."isDefault" DESC, a."sortOrder", a."createdAt" LIMIT 1)
      )
      -- (2) and (3) the brand its sale points at.
      WHEN d.brand_id IS NOT NULL THEN COALESCE(
        (SELECT a.id FROM business_accounts a
          WHERE a."brandId" = d.brand_id AND a."isActive" AND a.type NOT IN ('CASH', 'COMMISSION')
          ORDER BY a."sortOrder", a."createdAt" LIMIT 1),
        (SELECT fb.id FROM fallback fb LIMIT 1)
      )
      -- (4) no evidence anywhere.
      ELSE (SELECT fb.id FROM fallback fb LIMIT 1)
    END AS account_id
  FROM stranded s
  LEFT JOIN dominant   d  ON d.txn_id  = s.txn_id
  LEFT JOIN sale_shape sh ON sh.txn_id = s.txn_id
)
UPDATE finance_transactions f
   SET "accountId" = r.account_id,
       -- The brand is stamped only where it is CERTAIN: the sale sold one brand
       -- and one brand only. A mixed sale's money belongs partly to each brand,
       -- so the row stays "general" and the account records where it landed —
       -- a guess about where money went is recoverable, a guess written into
       -- brand income is not.
       "brandId" = CASE
                     WHEN f."brandId" IS NOT NULL THEN f."brandId"
                     WHEN r.brand_count = 1       THEN r.sale_brand
                     ELSE f."brandId"
                   END,
       -- Why this row moved, on the row, for the one person who will ask. Only
       -- ever written into an EMPTY notes field: a note someone typed is his.
       notes = COALESCE(
         f.notes,
         'Moved off the retired Cash account. ' || CASE
           WHEN r.row_brand IS NOT NULL  THEN 'Filed to the wallet of the brand already on this row.'
           WHEN r.brand_count = 1        THEN 'Its sale sold one brand only, so it is filed to that brand''s wallet.'
           WHEN r.brand_count > 1        THEN 'Its sale mixed brands, so it is filed to the wallet of the brand worth the most in it.'
           ELSE 'No brand evidence on this row or its sale, so it is filed to the default settlement wallet — the money did arrive somewhere real.'
         END
       )
  FROM resolved r
 WHERE f.id = r.txn_id
   AND r.account_id IS NOT NULL
   AND r.account_id <> f."accountId";

-- ── 3. Retire Cash, once it holds nothing ───────────────────────────────────
-- Still guarded on a zero balance. If some row could not be placed (no wallet
-- exists at all, say), Cash keeps its money AND stays visible: an unexplained
-- figure on screen beats a missing one. The `isActive` test is what makes this
-- a no-op on a second run rather than a fresh write of the same values.
WITH held AS (
  SELECT c.id,
         c."openingBalance"
           + COALESCE(SUM(CASE WHEN f.direction = 'IN'  THEN f.amount ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN f.direction = 'OUT' THEN f.amount ELSE 0 END), 0) AS balance
    FROM business_accounts c
    LEFT JOIN finance_transactions f
      ON f."accountId" = c.id
     AND NOT (
       f.type = 'COMMISSION_PAYMENT'
       OR (f.type = 'OWNER_CONTRIBUTION' AND COALESCE(f."refType", '') = 'CommissionWithdrawal')
     )
   WHERE c.type = 'CASH'
   GROUP BY c.id, c."openingBalance"
)
UPDATE business_accounts a
   SET "isActive"  = false,
       "isDefault" = false,
       notes = 'Retired — the business no longer accepts cash payments or holds money in cash. Kept for history only.'
  FROM held
 WHERE a.id = held.id
   AND held.balance = 0
   AND a."isActive";

-- A Cash account that survived the check must still never be the target for
-- anything new.
UPDATE business_accounts SET "isDefault" = false WHERE type = 'CASH' AND "isDefault";
