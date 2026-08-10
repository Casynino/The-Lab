'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/authorize');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/settings.controller');
const { settingUpsert } = require('../validators/misc.validator');

const router = express.Router();

router.use(authenticate);
router.get('/', ctrl.list);

// WhatsApp notification centre (two-segment paths — never shadowed by /:key).
router.get('/whatsapp/types', requireAdmin, ctrl.whatsappTypes);
router.get('/whatsapp/history', requireAdmin, ctrl.whatsappHistory);
router.post('/whatsapp/test', requireAdmin, ctrl.whatsappTest);
router.post('/whatsapp/retry-failed', requireAdmin, ctrl.whatsappRetryFailed);

router.get('/:key', ctrl.get);
router.put('/:key', requireAdmin, validate(settingUpsert), ctrl.upsert);

module.exports = router;
