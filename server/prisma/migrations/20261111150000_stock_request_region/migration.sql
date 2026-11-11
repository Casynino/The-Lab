-- The city a stock request is for, picked by a rep who works two or more cities.
-- Additive and nullable: every existing request keeps working unchanged.
ALTER TABLE "stock_requests" ADD COLUMN "region" TEXT;
