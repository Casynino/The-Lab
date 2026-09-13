'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/authorize');
const ctrl = require('../controllers/productPage.controller');

const router = express.Router();

router.use(authenticate);
router.get('/', requireAdmin, ctrl.get);
router.put('/', requireAdmin, ctrl.save);

module.exports = router;
