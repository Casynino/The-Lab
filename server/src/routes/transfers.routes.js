'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { requireRoles, ROLES } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/transfers.controller');
const { transferCreate, transferQuery } = require('../validators/inventory.validator');
const { idParam } = require('../validators/common.validator');

const router = express.Router();
const warehouseStaff = requireRoles(ROLES.WAREHOUSE_STAFF);
const cancelBody = { body: z.object({ reason: z.string().max(500).optional() }) };

router.use(authenticate);
router.get('/', warehouseStaff, validate(transferQuery), ctrl.list);
router.get('/:id', warehouseStaff, validate(idParam), ctrl.get);
router.post('/', warehouseStaff, validate(transferCreate), ctrl.create);
router.post('/:id/cancel', warehouseStaff, validate({ ...idParam, ...cancelBody }), ctrl.cancel);

module.exports = router;
