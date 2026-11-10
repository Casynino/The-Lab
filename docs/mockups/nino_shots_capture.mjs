// The browser half of nino_shots.py: drive a clean copy of Chrome in REAL time.
//
//   node docs/mockups/nino_shots_capture.mjs <outDir> '<[{"slug","url","settle"}]>'
//
// Why not Chrome's own --screenshot flag: it runs the page on a made-up clock,
// and a page that opens with an intro (ORA counts to 100 behind a neon logo,
// HA Group fades its words in, Reckless Lab shows a gate) is photographed
// mid-intro — a picture of the loader, not of the site. Here the page runs at
// its own speed, the load event is waited for, then `settle` more seconds are
// given before the shot. Its own throw-away profile, so nothing of Nino's own
// browsing is touched.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const [outDir, listJson] = process.argv.slice(2);
const sites = JSON.parse(listJson);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'nino-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--mute-audio', `--user-agent=${UA}`,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await connect());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0;
const waiting = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  else if (msg.method) events.push(msg.method);
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++nextId;
  waiting.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
for (const { slug, url, settle, w = 1440, h = 900, mobile = false, dpr = 1, full = false } of sites) {
  // each site may ask for its own window: a phone size, a taller picture of the whole page
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  events.length = 0;
  await send('Page.navigate', { url });
  for (let i = 0; i < 120 && !events.includes('Page.loadEventFired'); i++) await sleep(250); // up to 30 s to load
  await sleep((settle ?? 8) * 1000);
  const opts = { format: 'png', fromSurface: true };
  if (full) {
    const lm = await send('Page.getLayoutMetrics');
    const ch = Math.ceil(lm.result.cssContentSize.height);
    Object.assign(opts, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: ch, scale: 1 } });
  }
  const shot = await send('Page.captureScreenshot', opts);
  if (shot.result?.data) {
    writeFileSync(join(outDir, `${slug}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log(`  ${slug}: captured (${events.includes('Page.loadEventFired') ? 'loaded' : 'load event never fired'})`);
  } else {
    console.log(`  ${slug}: FAILED ${JSON.stringify(shot.error ?? {})}`);
  }
}

ws.close();
chrome.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir: the OS will clear it */ }
process.exit(0);
