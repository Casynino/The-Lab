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

router.post('/login', loginLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.get('/me', authenticate, ctrl.me);
router.post('/logout', authenticate, ctrl.logout);
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);

module.exports = router;
