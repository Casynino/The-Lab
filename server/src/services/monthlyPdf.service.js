'use strict';

// The monthly report PDF. The drawing lives in reportPdf.service.js (one design
// for daily, weekly and monthly); this name stays for older callers.

const { monthlyPdf } = require('./reportPdf.service');

module.exports = { monthlyStatementPdf: monthlyPdf };
