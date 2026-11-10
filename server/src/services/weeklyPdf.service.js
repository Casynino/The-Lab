'use strict';

// The weekly report PDF. The drawing lives in reportPdf.service.js (one design
// for daily, weekly and monthly); this name stays because the signed
// /api/public/weekly-statement.pdf link and older callers still import it.

const { weeklyPdf } = require('./reportPdf.service');

module.exports = { weeklyStatementPdf: weeklyPdf };
