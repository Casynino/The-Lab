-- An emergency withdrawal window.
--
-- A rep may only request a payout once their balance reaches a minimum —
-- 250,000 by default, or their own agreed figure. KP is on 500,000. The rule is
-- there so payouts are not taken in dribs and drabs out of the owner's own
-- pocket, and it is enforced in exactly one place, requestWithdrawal().
--
-- It has no exception, and a real emergency needs one. This adds a switch The
-- Doctor can press for one rep: while it is open, that rep's MINIMUM is waived
-- and nothing else. What they may ask for is still capped at what they have.
--
-- The window closes three ways, and needs nothing scheduled to do it:
--   * a request claims it — the claim is a conditional UPDATE, so two taps at
--     once cannot both take it;
--   * The Doctor closes it by hand;
--   * 48 hours pass — computed on read from emergencyWindowAt, never swept, so
--     it cannot outlive a job that stopped running.
-- A request that is later REJECTED gives the window back, so a wrong phone
-- number does not cost the rep the one shot he was given.
--
-- Everything here is additive and nullable. No existing row changes meaning:
-- every rep starts with a closed window and every past payout with
-- underEmergency = false, which is what they were.
ALTER TABLE "sales_representatives"
  ADD COLUMN IF NOT EXISTS "emergencyWindowAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emergencyWindowById"   TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyWindowReason" TEXT;

-- Stamped on the payout itself. The audit log in this app renders only
-- when / who / action / entity and never the values recorded alongside, so a
-- note left there is unreadable in the product. These two columns are the only
-- record that can answer "why was he paid below his minimum" on a screen.
ALTER TABLE "commission_withdrawals"
  ADD COLUMN IF NOT EXISTS "underEmergency" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "minWaived"      DECIMAL(14,2);
