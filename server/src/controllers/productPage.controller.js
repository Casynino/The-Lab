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
  // Strict read: if the row cannot be read, fail loudly rather than hand the
  // editor defaults that the next Save would write over the real content.
  const content = await page.readContent();
  // The URL that will be printed. Host is taken from the request so a preview
  // on localhost shows localhost and production shows production.
  const host = req.get('host') || String(env.appUrl).replace(/^https?:\/\//, '');
  // One entry per printed code, so the editor can draw them all without
  // knowing which sizes exist.
  const pages = page.pagePaths(content).map((pg) => ({ ...pg, url: `https://${host}/${pg.path}` }));
  // The pictures this release published, so the editor can show each box's
  // own and offer the rest. Addresses are never typed in the editor — it
  // sends back names from this list, which is what keeps a Save from being
  // able to point the page at a file that does not exist.
  return ok(res, {
    content,
    defaults: page.DEFAULTS,
    url: `https://${host}/p`,
    pages,
    pictures: page.pictureCatalog(),
    defaultPictures: page.defaultPictures(),
  });
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
