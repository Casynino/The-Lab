-- Heal settlement submissions whose payment account was deleted.
--
-- 20260830000001 merged duplicate business_accounts (created by a cold-start
-- seeding race) and repointed finance_transactions before deleting the
-- losers. It did NOT repoint settlement_submissions.accountId — a bare TEXT
-- column with no foreign key, so nothing complained. A rep's PENDING
-- submission could therefore name an account that no longer exists, and on
-- approval recordSaleIncome silently falls back to the DEFAULT account: the
-- settlement money lands in Cash instead of M-Pesa, with no error anywhere.
--
-- The rep also picked a payment method by name, stored alongside, so the
-- intended account can be recovered exactly.
UPDATE settlement_submissions s
   SET "accountId" = a.id
  FROM business_accounts a
 WHERE a.name = s.method
   AND s."accountId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM business_accounts b WHERE b.id = s."accountId");

-- Anything still dangling has no recoverable name: clear it so the fallback
-- to the default account is an explicit "unknown" rather than a broken id.
UPDATE settlement_submissions s
   SET "accountId" = NULL
 WHERE s."accountId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM business_accounts b WHERE b.id = s."accountId");
