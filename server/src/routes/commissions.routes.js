'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, ROLES } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/commissions.controller');
const { withdrawRequest, withdrawDecide, withdrawalQuery } = require('../validators/phase2.validator');
const { idParam } = require('../validators/common.validator');

const router = express.Router();
const staff = requireRoles(ROLES.WAREHOUSE_STAFF);
const reps = requireRoles(ROLES.SALES_REP);
const admin = requireRoles(ROLES.ADMIN);

router.use(authenticate);
router.get('/me', reps, ctrl.me);
router.get('/rule', ctrl.rule);
router.get('/summary', staff, ctrl.summary);
router.get('/rep/:salesRepId', staff, ctrl.getForRep);
router.get('/withdrawals', validate(withdrawalQuery), ctrl.listWithdrawals);
router.post('/withdrawals', reps, validate(withdrawRequest), ctrl.requestWithdrawal);
router.post('/withdrawals/:id/decide', staff, validate({ ...idParam, ...withdrawDecide }), ctrl.decideWithdrawal);
// Correcting a rep's commission up or down. Admin only — it changes what the
// business owes someone.
router.post('/adjust', requireRoles(ROLES.ADMIN), ctrl.adjustEarned);

// Commission rates — reading is open to any signed-in user (a rep should be
// able to see what a box earns); only an admin may add or remove one.
router.get('/rates', ctrl.listRates);
router.post('/rates', admin, ctrl.createRate);
router.delete('/rates/:id', admin, validate(idParam), ctrl.deleteRate);

// Sales bonus
router.get('/bonus/me', reps, ctrl.bonusMe);
router.get('/bonus/summary', staff, ctrl.bonusSummary);
router.get('/bonus/rules', ctrl.bonusRules);
router.post('/bonus/rules', admin, ctrl.createBonusRule);
router.patch('/bonus/rules/:id', admin, validate(idParam), ctrl.updateBonusRule);
router.patch('/bonus/rules/:id/active', admin, validate(idParam), ctrl.setBonusRuleActive);
router.get('/bonus/awards', staff, ctrl.bonusAwards);
router.post('/bonus/pay', admin, ctrl.payBonusAward);

module.exports = router;
