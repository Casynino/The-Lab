'use strict';

// The label editor, behind a login. Writes the words that appear on the public
// page at /p — see services/productPage.service.js for why the page reads this
// settings row and never the Product table.

const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const audit = require('../services/audit.service');
const page = require('../services/productPage.service');
const env = require('../config/env');

const get = asyncHandler(async (req, res) => {
  const content = await page.getContent();
  // The URL that will be printed. Host is taken from the request so a preview
  // on localhost shows localhost and production shows production.
  const host = req.get('host') || String(env.appUrl).replace(/^https?:\/\//, '');
  return ok(res, { content, defaults: page.DEFAULTS, url: `https://${host}/p` });
});

const save = asyncHandler(async (req, res) => {
  const content = await page.saveContent(req.body, req.user.id);
  await audit.record(req, {
    action: 'UPSERT',
    entityType: 'Setting',
    entityId: page.SETTING_KEY,
    newValues: { name: content.name, products: content.products.length },
  });
  return ok(res, content);
});

module.exports = { get, save };
