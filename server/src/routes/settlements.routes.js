'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, requireAdmin, ROLES } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/settlements.controller');
const { settlementQuery, settlementSettle, settlementSettleBoxes } = require('../validators/phase2.validator');
const { idParam } = require('../validators/common.validator');

const router = express.Router();
const staff = requireRoles(ROLES.WAREHOUSE_STAFF);
const settlers = requireRoles(ROLES.SALES_REP, ROLES.WAREHOUSE_STAFF);

router.use(authenticate);
router.get('/', validate(settlementQuery), ctrl.list); // reps see their own (scoped in controller)
router.get('/summary', staff, ctrl.summary);
router.get('/analytics', staff, ctrl.analytics); // "how are we doing" — performance over time
router.get('/pending-approvals', staff, ctrl.pendingApprovals); // approval center (before /:id)
router.get('/payment-accounts', ctrl.paymentAccounts); // account choices for reps (no balances)
// Approve / reject a settlement submission — The Doctor verifies the money.
router.post('/submissions/:id/approve', staff, validate(idParam), ctrl.approveSubmission);
router.post('/submissions/:id/reject', staff, validate(idParam), ctrl.rejectSubmission);
router.get('/:id', validate(idParam), ctrl.get);
// Submit a settlement for approval (rep or staff) — PENDING, no impact yet.
router.post('/:id/settle-boxes', settlers, validate({ ...idParam, ...settlementSettleBoxes }), ctrl.submitSettlement);
router.post('/:id/settle', staff, validate({ ...idParam, ...settlementSettle }), ctrl.settle);
router.post('/:id/extend-deadline', staff, validate(idParam), ctrl.extendDeadline);
// The rep activates their own +96h extension (no approval); staff may too.
router.post('/:id/self-extend', settlers, validate(idParam), ctrl.selfExtend);
router.post('/refresh-overdue', requireAdmin, ctrl.refreshOverdue);

module.exports = router;
