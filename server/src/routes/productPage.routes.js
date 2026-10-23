'use strict';

// GET /p and GET /p2 — the pages behind the QR codes printed on the cartons.
//
// One mount per box, because one carton should describe the box it is printed
// on: /p is the 70 x 36 pack, /p2 the 76 x 44. Which products a page shows is
// decided by the service, from the mount path.
//
// These are the only routes in the app open to the whole internet without a
// signature. They take NO input: no path parameter, no query string, no body.
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
    // req.baseUrl is the mount ('/p' or '/p2') — the only thing that varies,
    // and it comes from the route table, never from the request.
    const path = String(req.baseUrl || '/p').replace(/^\/+/, '') || 'p';
    const content = page.forPath(await page.getContent(), path);
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
    return res.send(page.renderHtml(content, { host, path }));
  }),
);

module.exports = router;
