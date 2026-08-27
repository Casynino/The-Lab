-- Commission rates as data, and a sales bonus — both admin-controlled.

CREATE TABLE "commission_rates" (
  "id"            TEXT NOT NULL,
  "brandId"       TEXT,
  "perBox"        DECIMAL(14,2) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "note"          TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "commission_rates_brandId_effectiveFrom_key" ON "commission_rates"("brandId", "effectiveFrom");
CREATE INDEX "commission_rates_brandId_effectiveFrom_idx" ON "commission_rates"("brandId", "effectiveFrom");
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commission_rates" ADD CONSTRAINT "commission_rates_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "bonus_rules" (
  "id"            TEXT NOT NULL,
  "salesTarget"   DECIMAL(16,2) NOT NULL,
  "bonusAmount"   DECIMAL(14,2) NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "note"          TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bonus_rules_effectiveFrom_idx" ON "bonus_rules"("effectiveFrom");
ALTER TABLE "bonus_rules" ADD CONSTRAINT "bonus_rules_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "bonus_awards" (
  "id"              TEXT NOT NULL,
  "salesRepId"      TEXT NOT NULL,
  "bonusRuleId"     TEXT NOT NULL,
  "qualifyingSales" DECIMAL(16,2) NOT NULL,
  "bonusAmount"     DECIMAL(14,2) NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'ELIGIBLE',
  "unlockedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"          TIMESTAMP(3),
  "paidById"        TEXT,
  "notes"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_awards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bonus_awards_salesRepId_bonusRuleId_key" ON "bonus_awards"("salesRepId", "bonusRuleId");
CREATE INDEX "bonus_awards_salesRepId_idx" ON "bonus_awards"("salesRepId");
ALTER TABLE "bonus_awards" ADD CONSTRAINT "bonus_awards_salesRepId_fkey"
  FOREIGN KEY ("salesRepId") REFERENCES "sales_representatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_awards" ADD CONSTRAINT "bonus_awards_bonusRuleId_fkey"
  FOREIGN KEY ("bonusRuleId") REFERENCES "bonus_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_awards" ADD CONSTRAINT "bonus_awards_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Seed the rates so the table reproduces TODAY'S behaviour exactly, then adds
-- the September change on top. Nothing already settled may move.
--
-- Until now the rules were code: a flat legacy rate for orders before
-- 1 Aug 2026, and OHIS 5,000 / Civlily 3,000 from that date. The legacy rate
-- lives in commission.v1PerBox and is NOT assumed to be 5,000 — a deployment
-- whose withdrawal minimum was never 250,000 has a different one, and hardcoding
-- would silently re-price every pre-August box.
-- ---------------------------------------------------------------------------

-- The far-past rows: the legacy flat rate, for every brand and as the fallback.
INSERT INTO "commission_rates" ("id", "brandId", "perBox", "effectiveFrom", "note", "createdAt")
SELECT gen_random_uuid()::text, b."id",
       COALESCE((SELECT s."value"::numeric FROM "settings" s WHERE s."key" = 'commission.v1PerBox'), 5000),
       TIMESTAMP '1970-01-01 00:00:00',
       'Legacy flat rate, carried over when rates became data',
       now()
  FROM "brands" b;

INSERT INTO "commission_rates" ("id", "brandId", "perBox", "effectiveFrom", "note", "createdAt")
SELECT gen_random_uuid()::text, NULL,
       COALESCE((SELECT s."value"::numeric FROM "settings" s WHERE s."key" = 'commission.v1PerBox'), 5000),
       TIMESTAMP '1970-01-01 00:00:00',
       'Fallback for a brand with no rate of its own',
       now();

-- 1 Aug 2026 00:00 EAT = 2026-07-31 21:00 UTC. Civlily dropped to 3,000; OHIS
-- was unchanged, so it needs no row.
INSERT INTO "commission_rates" ("id", "brandId", "perBox", "effectiveFrom", "note", "createdAt")
SELECT gen_random_uuid()::text, b."id", 3000,
       TIMESTAMP '2026-07-31 21:00:00',
       'Per-brand rates begin', now()
  FROM "brands" b
 WHERE upper(regexp_replace(b."name", '[^A-Za-z]', '', 'g')) IN ('CIVLILY', 'CIVILLY');

-- 1 Sep 2026 00:00 EAT = 2026-08-31 21:00 UTC. Civlily rises to 4,000.
INSERT INTO "commission_rates" ("id", "brandId", "perBox", "effectiveFrom", "note", "createdAt")
SELECT gen_random_uuid()::text, b."id", 4000,
       TIMESTAMP '2026-08-31 21:00:00',
       'Civlily increase', now()
  FROM "brands" b
 WHERE upper(regexp_replace(b."name", '[^A-Za-z]', '', 'g')) IN ('CIVLILY', 'CIVILLY');

-- The opening bonus rule, effective now so it counts sales from today onward.
INSERT INTO "bonus_rules" ("id", "salesTarget", "bonusAmount", "effectiveFrom", "isActive", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 10000000, 500000, now(), true, 'Opening sales bonus', now(), now()
 WHERE NOT EXISTS (SELECT 1 FROM "bonus_rules");
