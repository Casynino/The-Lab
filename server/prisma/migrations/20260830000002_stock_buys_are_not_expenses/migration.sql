-- Money spent buying stock was recorded through the "Record expense" flow
-- with the category "Stock Purchase", landing as type EXPENSE. The P&L then
-- charged those boxes twice: once as this expense, and again as COGS when
-- they sold. (Stock paid through the supplier flow was already correct —
-- type STOCK_PURCHASE, excluded from expenses.) Reclassify: same row, same
-- account, same money out — only the P&L treatment changes.
UPDATE finance_transactions
   SET type = 'STOCK_PURCHASE'
 WHERE type = 'EXPENSE'
   AND category ILIKE '%stock purchase%';
