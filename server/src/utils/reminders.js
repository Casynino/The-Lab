'use strict';

// The rep's settlement-deadline reminders: 24 h, 6 h and 1 h before an order's deadline. Each stage fires
// once, tracked by Settlement.reminderStage (0 = none, 1 = 24 h, 2 = 6 h, 3 = 1 h). Kept free of the
// database so settlement.service (which sends them) and returns.service (which moves deadlines) share it.

// Which reminder stage a given hours-to-deadline falls in (0 = none).
function reminderStageFor(hoursRemaining) {
  if (hoursRemaining > 0 && hoursRemaining <= 1) return 3;
  if (hoursRemaining > 1 && hoursRemaining <= 6) return 2;
  if (hoursRemaining > 6 && hoursRemaining <= 24) return 1;
  return 0;
}

// The stage an order should carry after its deadline moved later by a few hours (a return gave back the
// hours it kept the order paused). Reminders already sent for a window the order is no longer in are
// re-armed, so the rep is reminded again before the new deadline, starting with the window it is in now;
// a reminder already sent for the window it is still in is not sent twice. A deadline still behind keeps
// its stage. Before this, the stage stayed at 3 ("1 hour left") with a day to go, so no reminder could
// fire for the new deadline (final audit, 12 Nov 2026).
function rearmedReminderStage(currentStage, deadlineAt, now = Date.now()) {
  const stage = currentStage || 0;
  const hours = (new Date(deadlineAt).getTime() - now) / 3_600_000;
  if (!(hours > 0)) return stage;
  const window = reminderStageFor(hours);
  return stage > window ? Math.max(0, window - 1) : stage;
}

module.exports = { reminderStageFor, rearmedReminderStage };
