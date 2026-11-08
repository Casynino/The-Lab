'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, ROLES } = require('../middleware/authorize');
const ctrl = require('../controllers/dashboard.controller');

const router = express.Router();

router.use(authenticate);
router.get('/', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.overview);
router.get('/activity', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.activity);
router.get('/brands', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.brands);
router.get('/pending-actions', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.pendingActions);
router.get('/command', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.command);
router.get('/analysis', requireRoles(ROLES.WAREHOUSE_STAFF), ctrl.analysis);
router.get('/me', ctrl.myOverview);
router.get('/me/stats', ctrl.myStats);

module.exports = router;
