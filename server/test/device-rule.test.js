'use strict';

// ── Sales reps on phones only; the owner and staff on any device ─────────────
// Nino, 11 Nov 2026. Real User-Agents and the browser's own client hint decide; the app's screen check can
// only narrow. Pinned: every common phone passes, every computer and tablet is refused for a rep, an admin
// and staff are never refused, and a rep refusal carries the DEVICE_RESTRICTED reason the app shows.

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDevice, assertDeviceAllowed, RESTRICTED_MESSAGE } = require('../src/utils/device');
const ApiError = require('../src/utils/ApiError');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneWhatsApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.12',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-A057F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  huawei: 'Mozilla/5.0 (Linux; Android 10; HarmonyOS; NOH-NX9; HMSCore 6.13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 HuaweiBrowser/14.0 Mobile Safari/537.36',
  harmonyNext: 'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36 ArkWeb/4.1 Mobile',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  ipadOsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  chromeDesktopSite: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};
const h = (ua, extra = {}) => ({ 'user-agent': ua, ...extra });

test('every common phone is a phone', () => {
  for (const k of ['iphone', 'iphoneWhatsApp', 'androidChrome', 'samsung', 'huawei', 'harmonyNext', 'firefoxAndroid']) {
    assert.equal(classifyDevice(h(UA[k])).isPhone, true, k);
  }
  // Chromium phones also say so in the client hint
  assert.equal(classifyDevice(h(UA.androidChrome, { 'sec-ch-ua-mobile': '?1', 'x-client-form': 'phone' })).isPhone, true);
});

test('computers and tablets are not phones', () => {
  for (const k of ['androidTablet', 'ipadOld', 'ipadOsMac', 'windows', 'linux']) {
    assert.equal(classifyDevice(h(UA[k])).isPhone, false, k);
  }
  assert.equal(classifyDevice(h(UA.ipadOld)).kind, 'tablet');
  assert.equal(classifyDevice(h(UA.androidTablet)).kind, 'tablet');
  assert.equal(classifyDevice(h(UA.windows)).kind, 'desktop');
});

test('the browser hint outranks the User-Agent text', () => {
  // a phone User-Agent typed into a desktop Chrome: Chrome still says ?0
  assert.equal(classifyDevice(h(UA.androidChrome, { 'sec-ch-ua-mobile': '?0' })).isPhone, false);
  // a phone in "Desktop site" mode is treated as a computer (the message says how to fix it)
  assert.equal(classifyDevice(h(UA.chromeDesktopSite, { 'sec-ch-ua-mobile': '?0' })).isPhone, false);
});

test("the app's own screen check can only narrow", () => {
  assert.equal(classifyDevice(h(UA.iphone, { 'x-client-form': 'tablet' })).isPhone, false);
  assert.equal(classifyDevice(h(UA.iphone, { 'x-client-form': 'desktop' })).isPhone, false);
  assert.equal(classifyDevice(h(UA.windows, { 'x-client-form': 'phone' })).isPhone, false);
});

test('a rep off a phone is refused with the reason the app shows; admin and staff never are', () => {
  assert.throws(() => assertDeviceAllowed('SALES_REP', h(UA.windows), ApiError), (e) => {
    assert.equal(e.statusCode, 403);
    assert.equal(e.message, RESTRICTED_MESSAGE);
    assert.equal(e.details.reason, 'DEVICE_RESTRICTED');
    return true;
  });
  assert.throws(() => assertDeviceAllowed('SALES_REP', h(UA.ipadOld), ApiError));
  assert.throws(() => assertDeviceAllowed('SALES_REP', h(UA.androidTablet), ApiError));
  assert.throws(() => assertDeviceAllowed('SALES_REP', {}, ApiError)); // no User-Agent at all
  assert.doesNotThrow(() => assertDeviceAllowed('SALES_REP', h(UA.iphone), ApiError));
  for (const role of ['ADMIN', 'WAREHOUSE_STAFF']) {
    for (const k of ['windows', 'ipadOsMac', 'androidTablet', 'iphone']) {
      assert.doesNotThrow(() => assertDeviceAllowed(role, h(UA[k]), ApiError), `${role} ${k}`);
    }
  }
});
