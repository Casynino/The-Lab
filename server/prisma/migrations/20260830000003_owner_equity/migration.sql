-- The owner's own money, as its own kind of movement.
--
-- Until now the ledger could only describe the BUSINESS's money. The owner
-- pays rep commissions out of his personal pocket and has taken no profit
-- out at all — neither fact could be recorded, so the accounts understated
-- the cash he had put in and "profit" looked like money sitting somewhere.
--
-- A contribution is not income (it did not come from selling anything) and a
-- drawing is not an expense (it is profit leaving, not a cost of earning it).
-- Both are excluded from every profit figure and from money-in/money-out;
-- they move account balances and nothing else.
ALTER TYPE "FinanceTxnType" ADD VALUE IF NOT EXISTS 'OWNER_CONTRIBUTION';
ALTER TYPE "FinanceTxnType" ADD VALUE IF NOT EXISTS 'OWNER_DRAWING';
