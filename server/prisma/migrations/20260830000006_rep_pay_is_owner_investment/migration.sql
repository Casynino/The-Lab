-- Paying a rep touches no business account at all.
--
-- The previous migration recorded the owner's pocket money as a contribution
-- INTO the Cash account, which left 501,000 sitting there. He holds no cash:
-- when a rep withdraws, he pays them directly and no business account is
-- involved at any point. The money he lays out is an investment the business
-- owes him back, not a balance it is holding.
--
-- Remove the rows that put money into an account it never reached. The
-- payouts themselves stay — the record of what each rep was paid is exactly
-- what he wants kept — and what he has laid out is derived from those
-- payouts rather than stored as a balance.
DELETE FROM finance_transactions
 WHERE type = 'OWNER_CONTRIBUTION'
   AND "txnNumber" LIKE 'FTX-OWN-%';
