-- Stop counting the owner's rep-funding money twice.
--
-- What the business owes him was being computed as his recorded
-- contributions PLUS every rep payout — but the contributions he recorded
-- exist precisely to fund those payouts. The same 476,000 was counted on
-- both sides, overstating the debt to him by that amount.
--
-- Stamp the rep-funding contributions so they can be told apart from money
-- he puts in for anything else. Matching rule is the one that identified
-- them in the first place: same account, same amount, same day as a payout.
UPDATE finance_transactions f
   SET "refType" = 'CommissionWithdrawal'
 WHERE f.type = 'OWNER_CONTRIBUTION'
   AND f.direction = 'IN'
   AND f."refType" IS DISTINCT FROM 'CommissionWithdrawal'
   AND EXISTS (
     SELECT 1 FROM finance_transactions c
      WHERE c.type = 'COMMISSION_PAYMENT'
        AND c.direction = 'OUT'
        AND c."accountId" = f."accountId"
        AND c.amount = f.amount
        AND date_trunc('day', c."occurredAt") = date_trunc('day', f."occurredAt")
   );
