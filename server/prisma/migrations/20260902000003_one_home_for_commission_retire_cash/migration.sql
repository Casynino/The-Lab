-- Retire cash, give every brand ONE settlement account, and hold the record of
-- rep commission in a place of its own.
--
-- The owner's instruction, in four parts:
--   (a) the business neither accepts cash nor holds money in cash — he does not
--       want to see a Cash account anywhere, admin included;
--   (b) OHIS settles to M-Pesa, Civlily settles to Airtel Money, and a rep
--       settling sees ONE option, not a choice;
--   (c) paying commission must not add to or subtract from either wallet — the
--       RECORD is what he wants, held in one clearly labelled place;
--   (d) that record is tracked, never deducted from profit.
--
-- Nothing is deleted here. Every ledger row keeps its id, its number and its
-- history; only WHICH account it is filed under changes, and only where the
-- evidence on the row itself says where it belongs.

-- ── 1. The commission account ───────────────────────────────────────────────
-- One row, type COMMISSION (added in 20260902000002). Not a wallet: no money is
-- ever added to or taken from it, so its balance is zero by design and the
-- application reports the TOTAL RECORDED against it instead.
INSERT INTO business_accounts
  (id, name, type, currency, "openingBalance", "isActive", "isDefault", "sortOrder", notes, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'Commission',
  'COMMISSION',
  'TZS',
  0,
  true,
  false,
  90,
  'Rep commission, paid by the owner in cash from his own pocket. A record only — no money is held here, so the balance is always zero.',
  now() AT TIME ZONE 'UTC',
  now() AT TIME ZONE 'UTC'
 WHERE NOT EXISTS (SELECT 1 FROM business_accounts WHERE type = 'COMMISSION')
   AND NOT EXISTS (SELECT 1 FROM business_accounts WHERE name = 'Commission');

-- ── 2. One settlement account per brand ─────────────────────────────────────
-- The brandId column has existed since 20260705000002 but was never filled, so
-- both wallets read as "any brand" and every rep was offered all of them. Bind
-- them, but only where the account is still unbound AND that brand has no
-- account already — two accounts for one brand would put the choice back.
UPDATE business_accounts a
   SET "brandId" = (SELECT b.id FROM brands b WHERE upper(b.name) = 'OHIS' ORDER BY b."createdAt" LIMIT 1)
 WHERE a."brandId" IS NULL
   AND a.type <> 'COMMISSION'
   AND (a.name = 'M-Pesa' OR a.notes ILIKE '%OHIS%')
   AND EXISTS (SELECT 1 FROM brands b WHERE upper(b.name) = 'OHIS')
   AND NOT EXISTS (
     SELECT 1 FROM business_accounts x
      WHERE x."brandId" = (SELECT b.id FROM brands b WHERE upper(b.name) = 'OHIS' ORDER BY b."createdAt" LIMIT 1)
   );

-- The brand is spelled CIVILLY in the database and "Civlily" by the owner; both
-- start CIV and no other brand does.
UPDATE business_accounts a
   SET "brandId" = (SELECT b.id FROM brands b WHERE upper(b.name) LIKE 'CIV%' ORDER BY b."createdAt" LIMIT 1)
 WHERE a."brandId" IS NULL
   AND a.type <> 'COMMISSION'
   AND (a.name = 'Airtel Money' OR a.notes ILIKE '%civ%')
   AND EXISTS (SELECT 1 FROM brands b WHERE upper(b.name) LIKE 'CIV%')
   AND NOT EXISTS (
     SELECT 1 FROM business_accounts x
      WHERE x."brandId" = (SELECT b.id FROM brands b WHERE upper(b.name) LIKE 'CIV%' ORDER BY b."createdAt" LIMIT 1)
   );

-- ── 3. Every commission record moves to the commission account ──────────────
-- Both legs: the COMMISSION_PAYMENT itself, and the legacy OWNER_CONTRIBUTION
-- stamped 'CommissionWithdrawal' by 20260830000007 that used to "fund" it.
-- Both are already excluded from every balance and from money in/out, so no
-- displayed figure moves — this only gathers the record into one place.
UPDATE finance_transactions f
   SET "accountId" = ca.id
  FROM business_accounts ca
 WHERE ca.type = 'COMMISSION'
   AND f."accountId" <> ca.id
   AND (
     f.type = 'COMMISSION_PAYMENT'
     OR (f.type = 'OWNER_CONTRIBUTION' AND f."refType" = 'CommissionWithdrawal')
   );

-- ── 4. The settlement money filed under Cash goes where it really went ──────
-- THE 501,000 BUG. Those rows are not commission and were never meant to be
-- excluded: they are SETTLEMENT income — real money reps handed over — filed
-- against Cash because the account was `isDefault` and recordSaleIncome falls
-- back to the default whenever a settlement carries no account (every
-- settlement predating the rep's account picker, and every one whose account
-- was cleared by 20260830000004). With the wallets unbound, "Cash" was also
-- offered to every rep for every brand. Deactivating Cash while this money sat
-- on it would have deleted 501,000 from the totals.
--
-- 4a. Rows that already carry the brand go to that brand's account.
UPDATE finance_transactions f
   SET "accountId" = target.id
  FROM business_accounts cash, business_accounts target
 WHERE f."accountId" = cash.id
   AND cash.type = 'CASH'
   AND f.type IN ('SETTLEMENT', 'WAREHOUSE_SALE')
   AND f."brandId" IS NOT NULL
   AND target."brandId" = f."brandId"
   AND target."isActive"
   AND target.type <> 'COMMISSION';

-- 4b. Rows with no brand: take it from the sale they mirror, but only when that
-- sale sold ONE brand. A mixed sale has no single right answer, so it is left
-- alone and stays visible rather than being guessed at.
UPDATE finance_transactions f
   SET "accountId" = target.id,
       "brandId"   = sb.brand_id
  FROM business_accounts cash,
       business_accounts target,
       (
         SELECT si."saleId" AS sale_id, min(p."brandId") AS brand_id
           FROM sale_items si
           JOIN products p ON p.id = si."productId"
          WHERE p."brandId" IS NOT NULL
          GROUP BY si."saleId"
         HAVING count(DISTINCT p."brandId") = 1
       ) sb
 WHERE f."accountId" = cash.id
   AND cash.type = 'CASH'
   AND f.type IN ('SETTLEMENT', 'WAREHOUSE_SALE')
   AND f."brandId" IS NULL
   AND f."refType" = 'Sale'
   AND f."refId" = sb.sale_id
   AND target."brandId" = sb.brand_id
   AND target."isActive"
   AND target.type <> 'COMMISSION';

-- ── 5. Retire Cash ──────────────────────────────────────────────────────────
-- Deactivated, never deleted: accountBalances() drops inactive accounts, so the
-- wallet disappears from every screen while its history stays in the ledger.
--
-- ONLY when it now holds nothing. An account is dropped from the totals the
-- moment it goes inactive, so deactivating one with a balance would make real
-- money vanish silently. A Cash account still holding money after step 4 keeps
-- its history AND stays visible, so the owner can see it and move it with the
-- Transfer tool — an unexplained figure on screen beats a missing one.
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
       OR (f.type = 'OWNER_CONTRIBUTION' AND f."refType" = 'CommissionWithdrawal')
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
   AND held.balance = 0;

-- A Cash account that survived the check must not be the default target for
-- anything new: money still lands where the brand says, never in cash.
UPDATE business_accounts SET "isDefault" = false WHERE type = 'CASH' AND "isDefault";
