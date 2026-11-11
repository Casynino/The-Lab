'use strict';

// ── A report refused by CallMeBot for its link still arrives (11 Nov 2026) ───────────────────────────
// CallMeBot's firewall answered 403 to the first daily report carrying a www.zelab.site link; it was
// retried five times and never arrived. Pinned: on a 403 the same message goes again at once without
// its links, telling the owner where the document is kept; other failures are not touched.

const test = require('node:test');
const assert = require('node:assert/strict');

function load() {
  const f = require.resolve('../src/config/prisma');
  require.cache[f] = { id: f, filename: f, loaded: true, exports: {} };
  delete require.cache[require.resolve('../src/services/whatsappNotify.service')];
  return require('../src/services/whatsappNotify.service');
}
const creds = { phone: '+255700000000', apikey: 'k' };
const textOf = (url) => new URL(url).searchParams.get('text');

test('a 403 on a message with a link: sent again without the link', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const text = textOf(url);
    sent.push(text);
    return /https?:\/\//.test(text)
      ? new Response('<h1>Forbidden</h1>', { status: 403 })
      : new Response('Message queued. You will receive it in a few seconds.', { status: 200 });
  });
  const wa = load();
  const r = await wa.sendRaw('*Daily report*\nhttps://www.zelab.site/api/public/report/abc.pdf?sig=1\nThe Lab', creds);
  assert.equal(r.sent, true);
  assert.equal(r.linkRemoved, true);
  assert.equal(sent.length, 2);
  assert.ok(!/https?:\/\//.test(sent[1]), 'the second message has no link');
  assert.match(sent[1], /Profile → Reports/);
});

test('a message without a link, or another failure, is not resent here', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('Forbidden', { status: 403 }); });
  const wa = load();
  const r = await wa.sendRaw('No link in this one', creds);
  assert.equal(r.sent, false);
  assert.equal(calls, 1);

  let calls2 = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls2 += 1; return new Response('down', { status: 500 }); });
  const r2 = await load().sendRaw('Link https://www.zelab.site/x but a 500', creds);
  assert.equal(r2.sent, false);
  assert.equal(calls2, 1);
});

test('a delivered message is sent once, link and all', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url) => { sent.push(textOf(url)); return new Response('Message queued', { status: 200 }); });
  const r = await load().sendRaw('Weekly https://www.zelab.site/r.pdf', creds);
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /https:\/\/www\.zelab\.site/);
});
