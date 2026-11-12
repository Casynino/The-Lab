'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');
const {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

const router = express.Router();

// Tighter limiter for credential endpoints to slow brute-force attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many login attempts, try again later' } },
  // A rep refused by the phone-only rule typed the right password (the rule is checked only after it), so
  // that try is no guess and is given back; before, a rep retrying on a computer used up the tries of
  // everyone behind the same address (audit #102 / C28). The limiter gives back every request this calls
  // unsuccessful, and here only that refusal is; every other try still counts as before.
  skipFailedRequests: true,
  requestWasSuccessful: (_req, res) => !res.locals.deviceRestricted,
});

// Change password: at most 5 wrong current passwords per account in 15 minutes (audit 11 Nov 2026,
// auth-device-2: someone holding a session could guess the password at the global rate, and one right
// guess gave them the account and signed the owner out everywhere). Counted per account, not per address,
// so a new address does not reset it; only a wrong current password counts (the controller marks it), so a
// typo in the new password or a successful change never uses a try. Each wrong try is also in the audit
// log. In memory per server instance, like the sign-in limiter.
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many wrong passwords. Wait 15 minutes, then try again.' } },
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => !res.locals.wrongPassword,
});

router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.get('/me', authenticate, ctrl.me);
router.post('/logout', authenticate, ctrl.logout);
router.post('/change-password', authenticate, passwordLimiter, validate(changePasswordSchema), ctrl.changePassword);

module.exports = router;
