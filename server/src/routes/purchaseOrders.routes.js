'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, ROLES } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/purchases.controller');
const { poCreate, poUpdate, poReceive, poQuery } = require('../validators/phase2.validator');
const { idParam } = require('../validators/common.validator');

const router = express.Router();
const staff = requireRoles(ROLES.WAREHOUSE_STAFF);

router.use(authenticate, staff);
router.get('/', validate(poQuery), ctrl.listPOs);
router.get('/:id', validate(idParam), ctrl.getPO);
router.post('/', validate(poCreate), ctrl.createPO);
router.put('/:id', validate({ ...idParam, ...poUpdate }), ctrl.updatePO);
router.post('/:id/receive', validate({ ...idParam, ...poReceive }), ctrl.receivePO);
router.delete('/:id', validate(idParam), ctrl.deletePO); // only before it lands

module.exports = router;
