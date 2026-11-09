-- A sales rep can work more than one region (owner, 10 Nov 2026).
--
-- ADDITIVE ONLY: one new column with an empty default. No existing row is
-- changed, none is rewritten, nothing is dropped; a rep from before this reads
-- as [region] in code (repRegions), so no backfill is needed either. `region`
-- stays and holds the main (first) region, which every report already reads.
-- AlterTable
ALTER TABLE "sales_representatives" ADD COLUMN     "regions" TEXT[] DEFAULT ARRAY[]::TEXT[];
