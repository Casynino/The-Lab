-- Count the bonus from when the reps actually started selling, not from the
-- moment the feature shipped.
--
-- The opening rule began at deploy time, so every rep saw zero progress against
-- a ten-million target — accurate but useless, since none of the selling they
-- had already done counted. Move the start back to the business's own start so
-- the bar reflects real work.
--
-- Preference order:
--   1. finance.epochAt — the date the books begin. Every money figure in the
--      app already clamps to it, so bonus progress then agrees with the revenue
--      the business reports rather than quietly counting more.
--   2. The earliest settled sale, for a deployment with no epoch set.
--   3. Leave it alone.
--
-- Only the untouched opening rule is moved. A rule that has already granted an
-- award is never re-dated: a rep told they had earned a bonus keeps it.
UPDATE "bonus_rules" r
   SET "effectiveFrom" = COALESCE(
     (SELECT to_timestamp(s."value", 'YYYY-MM-DD"T"HH24:MI:SS') AT TIME ZONE 'UTC'
        FROM "settings" s WHERE s."key" = 'finance.epochAt'),
     (SELECT MIN(sa."soldAt") FROM "sales" sa
       WHERE sa."status" <> 'CANCELLED' AND sa."settlementId" IS NOT NULL),
     r."effectiveFrom"
   )
 WHERE r."note" = 'Opening sales bonus'
   AND NOT EXISTS (SELECT 1 FROM "bonus_awards" a WHERE a."bonusRuleId" = r."id");
