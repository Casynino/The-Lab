-- The city of each line of a stock request: a rep with several cities can split one request between them.
-- Additive and nullable: every existing line keeps working unchanged.
ALTER TABLE "stock_request_items" ADD COLUMN "region" TEXT;
