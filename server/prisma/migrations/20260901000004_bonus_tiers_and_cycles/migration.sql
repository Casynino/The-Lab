-- Bonus becomes tiered and repeatable.
--
-- Two changes to how it behaves:
--   * Several active rules are now several TIERS a rep can aim at. Reaching a
--     lower one does not end the run, so a rep can take 500k at ten million or
--     hold out for a million at fifteen.
--   * Taking a bonus resets that rep's counter to zero and a new run begins, so
--     the same tier can be earned again later. The run's start is what tells two
--     awards of the same tier apart.

ALTER TABLE "bonus_awards"
  ADD COLUMN "cycleStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A rep could only ever hold one award per rule; now they can hold one per rule
-- per run.
DROP INDEX IF EXISTS "bonus_awards_salesRepId_bonusRuleId_key";
CREATE UNIQUE INDEX "bonus_awards_salesRepId_bonusRuleId_cycleStart_key"
  ON "bonus_awards"("salesRepId", "bonusRuleId", "cycleStart");

-- The second tier, starting from the same date as the first so both are already
-- in play. Skipped if it is somehow already there.
INSERT INTO "bonus_rules" ("id", "salesTarget", "bonusAmount", "effectiveFrom", "isActive", "note", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 15000000, 1000000, r."effectiveFrom", true, 'Higher tier', now(), now()
  FROM "bonus_rules" r
 WHERE r."note" = 'Opening sales bonus'
   AND NOT EXISTS (SELECT 1 FROM "bonus_rules" x WHERE x."salesTarget" = 15000000)
 LIMIT 1;
