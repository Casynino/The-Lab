'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, requireAdmin, ROLES } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/credit.controller');
const { creditQuery, creditPayment } = require('../validators/sales.validator');
const { idParam } = require('../validators/common.validator');

const router = express.Router();
// Staff only: business-wide debt; no rep screen reads or records it.
const collectors = requireRoles(ROLES.WAREHOUSE_STAFF);

router.use(authenticate);
router.get('/', collectors, validate(creditQuery), ctrl.list);
router.get('/summary', collectors, ctrl.summary);
router.get('/:id', collectors, validate(idParam), ctrl.get);
router.post('/:id/payments', collectors, validate({ ...idParam, ...creditPayment }), ctrl.recordPayment);
router.post('/refresh-overdue', requireAdmin, ctrl.refreshOverdue);

module.exports = router;
