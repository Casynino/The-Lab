'use strict';

// GET /p — the page behind the QR code printed on the carton.
//
// This is the only route in the app that is open to the whole internet without
// a signature. It takes NO input: no path parameter, no query string, no body.
// There is no id to increment and nothing to enumerate, which is a stronger
// guarantee than a signature would give — a signature printed on a hundred
// thousand cartons is public by construction.

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const page = require('../services/productPage.service');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const content = await page.getContent();
    const host = req.get('host') || null;

    // Its own policy, stricter than the global helmet() one, rather than
    // loosening helmet for everybody else. There is no script-src at all.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    );

    // The CDN is the real cost control here, not a rate limiter: a busy
    // scanning day costs a handful of invocations per region per hour rather
    // than one per scan. Ten minutes rather than a day, because the label
    // editor writes straight to this page — a day-long edge cache means an
    // admin saves a correction and cannot see it, which is how a wrong figure
    // survives. stale-while-revalidate still covers a database outage: an
    // old page beats a dead link on somebody's shelf.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(page.renderHtml(content, { host }));
  }),
);

module.exports = router;
