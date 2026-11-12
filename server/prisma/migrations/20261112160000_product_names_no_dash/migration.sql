-- Owner, 12 Nov 2026: product names carry no dash — "OHIS Ndogo (Brown) Bila Filter", not
-- "OHIS Ndogo (Brown) – Bila Filter" — on every screen and in every WhatsApp.
-- Data only, no schema change. Only a dash with spaces on both sides (en dash, em dash or hyphen) is
-- replaced by one space; ids, SKUs, prices, stock and all history stay as they are (everything points
-- at the product by id). Running it again changes nothing.
UPDATE "products"
SET "name" = regexp_replace("name", '\s+[-–—]\s+', ' ', 'g'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" ~ '\s[-–—]\s';

-- A settlement still waiting for approval shows the product name it was sent with; keep those in step.
-- Approved and rejected ones are history and keep the name they had.
UPDATE "settlement_submissions"
SET "productName" = regexp_replace("productName", '\s+[-–—]\s+', ' ', 'g')
WHERE "status" = 'PENDING' AND "productName" ~ '\s[-–—]\s';
