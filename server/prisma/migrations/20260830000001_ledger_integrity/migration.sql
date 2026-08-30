-- Ledger integrity: three defects that let the books drift from the truth.
--
-- 1. Duplicate business accounts. Account seeding was check-then-insert with
--    no constraint behind it; two concurrent cold-start requests both saw an
--    empty table and both seeded, so the local DB holds two of each account
--    (two Cash, both marked default). Merge each duplicate set into its OLDEST
--    row — repointing every transaction first — then make the name unique so
--    it can never happen again.
DO $$
DECLARE dup RECORD;
BEGIN
  FOR dup IN
    SELECT name, (array_agg(id ORDER BY "createdAt" ASC))[1] AS keeper,
           array_agg(id ORDER BY "createdAt" ASC) AS all_ids
      FROM business_accounts
     GROUP BY name
    HAVING count(*) > 1
  LOOP
    UPDATE finance_transactions
       SET "accountId" = dup.keeper
     WHERE "accountId" = ANY (dup.all_ids) AND "accountId" <> dup.keeper;
    -- Fold any opening balance a duplicate carried into the keeper, so no
    -- money vanishes with the row.
    UPDATE business_accounts k
       SET "openingBalance" = k."openingBalance" + COALESCE((
             SELECT SUM(d."openingBalance") FROM business_accounts d
              WHERE d.id = ANY (dup.all_ids) AND d.id <> dup.keeper), 0)
     WHERE k.id = dup.keeper;
    DELETE FROM business_accounts
     WHERE id = ANY (dup.all_ids) AND id <> dup.keeper;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "business_accounts_name_key" ON business_accounts (name);

-- Exactly one default account: keep the oldest default, demote the rest.
UPDATE business_accounts SET "isDefault" = false
 WHERE "isDefault" = true
   AND id <> (SELECT id FROM business_accounts WHERE "isDefault" = true ORDER BY "createdAt" ASC LIMIT 1);

-- 2. Double-posted sale income. The backfill that mirrors sales into the
--    ledger is check-then-insert; two concurrent requests on separate
--    serverless instances can both pass the check and both insert, doubling
--    Money In permanently. First fold any existing duplicates into one row,
--    then let the database enforce one ledger row per sale.
DELETE FROM finance_transactions ft
 USING finance_transactions keep
 WHERE ft."refType" = 'Sale' AND keep."refType" = 'Sale'
   AND ft."refId" = keep."refId"
   AND ft.id <> keep.id
   AND (keep."createdAt" < ft."createdAt" OR (keep."createdAt" = ft."createdAt" AND keep.id < ft.id));

CREATE UNIQUE INDEX IF NOT EXISTS "finance_transactions_sale_ref_key"
  ON finance_transactions ("refId") WHERE "refType" = 'Sale';
