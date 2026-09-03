-- Empty REP-001, the owner's own test account, back to nothing.
--
-- He uses this rep to try things out, so its history is not trade — the
-- 250,000 commission adjustment and the 250,000 penalty were both tests, and
-- the four "settled" boxes were a dry run of the settlement flow rather than a
-- real sale to a real customer. Left alone they sit inside the revenue, the
-- stock ledger and the commission owed, quietly wrong.
--
-- This is the one deliberately destructive migration in the project, asked for
-- explicitly, and it is narrow: it names a single rep by code AND by the name
-- on the account, so it cannot run away across a database where REP-001 is
-- somebody else. On any database where that pair does not match, every
-- statement matches nothing and the migration is a no-op.
--
-- Deleting the inventory rows is what returns the stock: balances are derived
-- from the ledger, never stored, so removing the issue, the sale and the
-- return leaves the warehouse exactly as if the boxes had never left it.
--
-- Order matters — children before parents, and the finance rows before the
-- sales they point at, since nothing links them back.

-- The one rep this touches. Empty unless the code and the name both match.
CREATE TEMPORARY TABLE _target_rep AS
SELECT r.id
  FROM sales_representatives r
  JOIN users u ON u.id = r."userId"
 WHERE r.code = 'REP-001'
   AND lower(u.name) LIKE 'nino%';

-- Their sales, and the credit sales and finance rows hanging off them.
CREATE TEMPORARY TABLE _target_sales AS
SELECT s.id FROM sales s WHERE s."salesRepId" IN (SELECT id FROM _target_rep);

DELETE FROM finance_transactions
 WHERE ("refType" = 'Sale' AND "refId" IN (SELECT id FROM _target_sales))
    OR ("refType" = 'CommissionWithdrawal'
        AND "refId" IN (SELECT id FROM commission_withdrawals
                         WHERE "salesRepId" IN (SELECT id FROM _target_rep)));

DELETE FROM credit_sales WHERE "saleId" IN (SELECT id FROM _target_sales);
DELETE FROM sale_items   WHERE "saleId" IN (SELECT id FROM _target_sales);
DELETE FROM sales        WHERE id IN (SELECT id FROM _target_sales);

-- Everything hung off their settlement orders.
CREATE TEMPORARY TABLE _target_settlements AS
SELECT s.id FROM settlements s WHERE s."salesRepId" IN (SELECT id FROM _target_rep);

DELETE FROM settlement_payments     WHERE "settlementId" IN (SELECT id FROM _target_settlements);
DELETE FROM settlement_submissions  WHERE "salesRepId"  IN (SELECT id FROM _target_rep);
DELETE FROM settlement_penalties    WHERE "salesRepId"  IN (SELECT id FROM _target_rep);

-- Returns, then the orders themselves.
CREATE TEMPORARY TABLE _target_returns AS
SELECT r.id FROM returns r WHERE r."salesRepId" IN (SELECT id FROM _target_rep);

DELETE FROM return_items WHERE "returnId" IN (SELECT id FROM _target_returns);
DELETE FROM returns      WHERE id IN (SELECT id FROM _target_returns);
DELETE FROM settlements  WHERE id IN (SELECT id FROM _target_settlements);

-- Stock requests they raised.
CREATE TEMPORARY TABLE _target_requests AS
SELECT sr.id FROM stock_requests sr WHERE sr."salesRepId" IN (SELECT id FROM _target_rep);

DELETE FROM stock_request_items WHERE "stockRequestId" IN (SELECT id FROM _target_requests);
DELETE FROM stock_requests      WHERE id IN (SELECT id FROM _target_requests);

-- The stock ledger. Removing these is what puts the boxes back on the shelf,
-- because every balance in the app is summed from this table.
DELETE FROM inventory_transactions WHERE "salesRepId" IN (SELECT id FROM _target_rep);
DELETE FROM rep_stocks             WHERE "salesRepId" IN (SELECT id FROM _target_rep);

-- Commission: the requests, the bonuses, and the hand-typed adjustment.
DELETE FROM commission_withdrawals WHERE "salesRepId" IN (SELECT id FROM _target_rep);
DELETE FROM bonus_awards           WHERE "salesRepId" IN (SELECT id FROM _target_rep);
DELETE FROM stock_counts           WHERE "salesRepId" IN (SELECT id FROM _target_rep);
DELETE FROM daily_reports          WHERE "salesRepId" IN (SELECT id FROM _target_rep);

UPDATE sales_representatives
   SET "commissionAdjustment" = 0,
       "commissionAdjustmentNote" = NULL,
       "commissionAdjustedAt" = NULL
 WHERE id IN (SELECT id FROM _target_rep);

DROP TABLE _target_requests;
DROP TABLE _target_returns;
DROP TABLE _target_settlements;
DROP TABLE _target_sales;
DROP TABLE _target_rep;
