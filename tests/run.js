'use strict';

// Runs tests/driver.html in headless Chromium (Playwright) and turns the
// harness beacons into a pass/fail exit code.
//
//   npm run verify     # syntax gate + this runner
//   node tests/run.js  # runner only
//
// The app itself has no dependencies; this file is dev-only tooling.

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServers } = require('./serve');

const ARTIFACTS = path.join(__dirname, '..', 'test-results');

const DRIVER_TIMEOUT_MS = 240000;
const MIN_CHECKS = 70;
const PHASES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout waiting for ' + what);
}

function parseBeacon(raw) {
  let text = raw;
  try { text = decodeURIComponent(raw); } catch (err) { /* keep raw */ }
  if (text.startsWith('DONE-')) return { kind: 'done', text };
  if (text.startsWith('PHASE-')) return { kind: 'phase', text };
  if (text.endsWith('-PASS')) return { kind: 'check', ok: true, name: text.slice(0, -5), detail: '' };
  const i = text.indexOf('-FAIL--');
  if (i !== -1) return { kind: 'check', ok: false, name: text.slice(0, i), detail: text.slice(i + 7) };
  return { kind: 'unknown', text };
}

async function runDriver(browser, appOrigin) {
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  // Injected into every frame before its own scripts: records JS errors and
  // CSP violations inside the app iframe, which the driver cannot observe
  // from its parent page otherwise.
  await context.addInitScript(() => {
    const kai = { errors: [], csp: [] };
    window.__kai = kai;
    window.addEventListener('error', (e) => kai.errors.push(String((e && e.message) || e)));
    window.addEventListener('unhandledrejection', (e) => kai.errors.push('unhandledrejection: ' + (e && e.reason)));
    document.addEventListener('securitypolicyviolation', (e) => {
      kai.csp.push(String(e.violatedDirective) + ' ' + String(e.blockedURI));
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const beacons = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Chrome logs informational CSP notes as console errors; they are not
    // app failures.
    if (/Content-Security-Policy|'script-src' was not explicitly set/.test(text)) return;
    pageErrors.push('console: ' + text);
  });
  page.on('request', (req) => {
    let u;
    try { u = new URL(req.url()); } catch (err) { return; }
    const p = '/tests/beacon/';
    if (u.pathname.startsWith(p)) beacons.push(u.pathname.slice(p.length));
  });

  await page.goto(appOrigin + '/tests/driver.html', { waitUntil: 'domcontentloaded' });
  const done = await waitFor(
    () => beacons.map(parseBeacon).find((b) => b.kind === 'done'),
    DRIVER_TIMEOUT_MS,
    'the harness to finish'
  );

  const seen = new Set();
  const phases = new Set();
  const hardList = [];
  let hardFails = 0;
  let softWarns = 0;
  for (const raw of beacons) {
    const b = parseBeacon(raw);
    if (b.kind === 'phase') {
      phases.add(b.text.replace(/^PHASE-/, '').replace(/-PASS$/, ''));
      continue;
    }
    if (b.kind !== 'check' || seen.has(b.name)) continue;
    seen.add(b.name);
    record(b.name, b.ok, b.detail);
    if (!b.ok) {
      if (b.name.startsWith('soft-')) softWarns++;
      else { hardFails++; hardList.push(b.name); }
    }
  }

  const m = /^DONE-(ALLPASS|FAILURES-\d+)-(\d+)$/.exec(done.text);
  const total = m ? Number(m[2]) : 0;
  record('driver-completed', !!m && m[1] === 'ALLPASS', done.text);
  record('driver-check-count', total >= MIN_CHECKS, 'checks: ' + total + ' (min ' + MIN_CHECKS + ')');
  for (const p of PHASES) {
    if (!phases.has(p)) record('phase-' + p + '-reported', false, 'phase beacon missing');
  }
  if (pageErrors.length) {
    record('no-page-errors', false, pageErrors.join(' | ').slice(0, 400));
    hardList.push('no-page-errors');
  } else {
    record('no-page-errors', true, 'no page errors');
  }

  if (hardList.length) {
    try {
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await page.screenshot({ path: path.join(ARTIFACTS, 'driver-failure.png'), fullPage: true });
      fs.writeFileSync(
        path.join(ARTIFACTS, 'beacons.json'),
        JSON.stringify({
          failures: hardList,
          pageErrors,
          beacons: beacons.map(parseBeacon),
        }, null, 2)
      );
      console.log('failure artifacts in ' + ARTIFACTS);
    } catch (err) {
      console.log('could not write failure artifacts: ' + err.message);
    }
  }

  await context.close();
  return { hardFails, softWarns, pageErrors };
}

// The app must hide itself (or be navigated out) when a cross-origin page
// frames it; same-origin framing stays usable and is covered in the driver.
async function runFrameGuard(browser, appOrigin, altOrigin) {
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(altOrigin + '/tests/frames.html?src=' + encodeURIComponent(appOrigin + '/index.html'));
  try {
    const frame = await waitFor(
      () => page.frames().find((fr) => fr.url().startsWith(appOrigin + '/index.html')),
      8000,
      'cross-origin app frame'
    );
    await page.waitForTimeout(700);
    const state = await frame.evaluate(() => ({
      hidden: document.documentElement.style.visibility === 'hidden',
      url: location.href,
    })).catch((err) => ({ hidden: null, url: 'detached: ' + err.message }));
    const navigated = page.url().startsWith(appOrigin + '/index.html');
    const ok = navigated || state.hidden === true;
    record('frame-crossorigin', ok,
      navigated ? 'busted out of the frame' : 'visibility=' + state.hidden + ' url=' + state.url);
  } catch (err) {
    record('frame-crossorigin', false, err.message);
  }
  await context.close();
}

// Service worker: registers, controls the page after a reload, precaches,
// and names the cache from the manifest version (they must never drift).
async function runServiceWorker(browser, appOrigin) {
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await page.goto(appOrigin + '/index.html');
    const ready = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((r) => ({
        scope: r.scope,
        script: (r.active && r.active.scriptURL) || '',
      })),
      new Promise((res) => setTimeout(() => res({ scope: '', script: '', timeout: true }), 15000)),
    ]));
    record('sw-register', !ready.timeout && /\/sw\.js$/.test(ready.script), JSON.stringify(ready));

    await page.reload();
    const controlled = await page.evaluate(() => !!(navigator.serviceWorker.controller));
    record('sw-controls-page', controlled, 'controller after reload: ' + controlled);

    const info = await page.evaluate(async () => {
      const manifest = await fetch('manifest.webmanifest').then((r) => r.json());
      return { version: manifest.version, keys: await caches.keys() };
    });
    record('sw-cache-version', info.keys.includes('kaioken-' + info.version),
      'version ' + info.version + ' caches ' + JSON.stringify(info.keys));
  } catch (err) {
    record('sw-register', false, err.message);
  }
  await context.close();
}

async function main() {
  const servers = await startServers(2);
  const appOrigin = servers.origin(0);
  const altOrigin = servers.origin(1);
  const browser = await chromium.launch({ headless: process.env.KAIOKEN_HEADED !== '1' });

  let failed = 0;
  let warned = 0;
  try {
    console.log('app origin   ' + appOrigin);
    const driver = await runDriver(browser, appOrigin);
    failed += driver.hardFails;
    warned += driver.softWarns;

    await runFrameGuard(browser, appOrigin, altOrigin);
    await runServiceWorker(browser, appOrigin);
  } finally {
    await browser.close();
    await servers.close();
  }

  const fails = results.filter((r) => !r.ok && !r.name.startsWith('soft-'));
  const softs = results.filter((r) => !r.ok && r.name.startsWith('soft-'));
  for (const r of fails) console.log('FAIL  ' + r.name + (r.detail ? '  -- ' + r.detail : ''));
  for (const r of softs) console.log('WARN  ' + r.name + (r.detail ? '  -- ' + r.detail : ''));
  console.log(
    '\n' + (results.length - fails.length - softs.length) + '/' + results.length + ' checks passed' +
    (softs.length ? ', ' + softs.length + ' soft warning' + (softs.length === 1 ? '' : 's') : '')
  );
  if (fails.length) {
    console.log(failed + ' failure' + (failed === 1 ? '' : 's'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('runner crashed: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
