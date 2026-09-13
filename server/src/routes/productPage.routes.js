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

    // The CDN is the real cost control here, not a rate limiter: content that
    // changes twice a year is served from the edge, so a busy scanning day
    // costs about one invocation per region per day instead of one per scan.
    // stale-while-revalidate also means a database outage serves a slightly
    // old page rather than a dead link on somebody's shelf.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(page.renderHtml(content, { host }));
  }),
);

module.exports = router;
