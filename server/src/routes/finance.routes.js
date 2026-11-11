'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRoles, ROLES } = require('../middleware/authorize');
const ctrl = require('../controllers/finance.controller');
const validate = require('../middleware/validate');
const v = require('../validators/finance.validator');

const router = express.Router();

// Finance is staff/admin only (The Doctor's money) — reps have no access.
router.use(authenticate, requireRoles(ROLES.WAREHOUSE_STAFF));

router.get('/overview', ctrl.overview);
router.post('/sync', ctrl.sync); // rebuild ledger from existing records (idempotent)
router.get('/cashflow', ctrl.cashflow);
router.get('/report', ctrl.report);
router.get('/suppliers', ctrl.suppliers);
router.get('/suppliers/:id', ctrl.supplierDetail);
router.post('/supplier-payments', validate(v.financeSupplierPayment), ctrl.paySupplier);
router.post('/suppliers/:id/pay', validate(v.financeSupplierBalancePayment), ctrl.paySupplierBalance); // pay down overall balance (installments)
// Goods sent back. Admin only: it reduces a bill without any money moving.
router.post('/suppliers/:id/credits', requireRoles(ROLES.ADMIN), validate(v.financeSupplierCredit), ctrl.creditSupplier);
router.get('/accounts', ctrl.accounts);
router.post('/accounts', validate(v.financeAccountCreate), ctrl.createAccount);
router.put('/accounts/:id', validate(v.financeAccountUpdate), ctrl.updateAccount);
router.get('/categories', ctrl.categories);
router.post('/categories', validate(v.financeCategoryCreate), ctrl.createCategory);
router.get('/transactions', ctrl.transactions);
router.post('/income', validate(v.financeMoney), ctrl.recordIncome);
router.post('/expenses', validate(v.financeMoney), ctrl.recordExpense);
router.post('/owner-money', validate(v.financeOwnerMoney), ctrl.recordOwnerMoney); // owner's own cash in / profit taken out
router.post('/adjustments', requireRoles(ROLES.ADMIN), validate(v.financeAdjustment), ctrl.recordAdjustment); // balance corrections (admin only)
router.post('/transfers', requireRoles(ROLES.ADMIN), validate(v.financeTransfer), ctrl.transferBetween); // move money between accounts (admin only)
router.put('/transactions/:id', validate(v.financeTxnUpdate), ctrl.updateTransaction);
router.delete('/transactions/:id', ctrl.deleteTransaction);
router.get('/report-archive', ctrl.reportArchive); // generated weekly/monthly PDFs
router.get('/report-archive/:id/pdf', ctrl.reportArchivePdf);

module.exports = router;
