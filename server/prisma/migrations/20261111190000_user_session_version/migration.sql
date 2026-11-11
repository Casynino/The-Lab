-- A per-user session version: tokens carry the value they were issued with, so a password change or reset,
-- a role change or switching the account off ends every older session. Additive, defaults to 0: every
-- existing token (which carries no version, read as 0) keeps working until the first such change.
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
