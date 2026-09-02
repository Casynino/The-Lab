-- The cash that paid commission belongs with the commission record.
--
-- The owner has explained what the money on the old Cash account actually was:
-- "airtell was 574,000 — the other money, if it was on cash then i used it for
-- commission, add it on commission so the math can be accurate."
--
-- So those receipts are real income that reps handed over in cash, which then
-- went straight back out again as commission. No wallet ever kept it. The
-- previous migration parked it on the retired Cash account, which kept it out
-- of the balances but filed it away from the thing it actually paid for. It
-- belongs on the Commission account, where the whole record of what he has put
-- into paying reps reads back in one place.
--
-- Every row on that account is off-balance (see OFF_ACCOUNT_WHERE), so this
-- moves no wallet by a shilling: it only decides where the history is kept.
-- The account's "recorded" total counts outgoing payouts only, so these
-- receipts do not inflate it. Nothing is deleted.
WITH cash AS (
  SELECT id FROM business_accounts WHERE type = 'CASH' ORDER BY "createdAt" LIMIT 1
),
commission AS (
  SELECT id FROM business_accounts WHERE type = 'COMMISSION' ORDER BY "createdAt" LIMIT 1
)
UPDATE finance_transactions f
   SET "accountId" = (SELECT id FROM commission),
       notes = COALESCE(
         f.notes,
         'Collected in cash and handed straight back out as rep commission. Kept with the commission record; no wallet ever held it.'
       )
 WHERE EXISTS (SELECT 1 FROM commission)
   AND EXISTS (SELECT 1 FROM cash)
   AND f."accountId" = (SELECT id FROM cash)
   AND f.direction = 'IN'
   AND f.type = 'SETTLEMENT';
