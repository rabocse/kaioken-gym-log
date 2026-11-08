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
const { chromium, webkit } = require('playwright');
const { startServers } = require('./serve');

const ARTIFACTS = path.join(__dirname, '..', 'test-results');

const DRIVER_TIMEOUT_MS = 240000;
const MIN_CHECKS = 70;
const PHASES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];

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

// P0 QA-01: the backup importer is the app's only untrusted-input surface.
// This runs in a fresh context so the hostile routine never pollutes the main
// driver's dataset. Payload and assertions mirror the audit POC: markup in
// every free-text field, markup/NaN strings in every numeric field, an
// invalid date and an <svg onload> exercise name.
async function runMaliciousImport(browser, appOrigin) {
  const MARK = 'MK7x9';
  const payload = {
    app: 'kaioken',
    version: 1,
    routines: [{
      id: 'poc-r1',
      name: MARK + '<img src=x onerror="window.__xssName=1">',
      date: '<img src=y onerror=window.__xssDate=1>',
      status: 'completed',
      bodyWeight: '<script>window.__xssBw=1</script>',
      neck: '"><svg onload=window.__xssNeck=1>',
      waist: '</b><b>injected',
      hip: 'javascript:alert(1)',
      exercises: [{
        id: 'poc-e1',
        name: '<svg onload="window.__xssEx=1">',
        unit: 'lb',
        sets: [
          { id: 'poc-s1', reps: '<img src=x onerror="window.__xssReps=1">', weight: '" onmouseover="alert(1)', done: true },
          { id: 'poc-s2', reps: 5, weight: 100, done: true },
        ],
      }],
    }],
  };
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Content-Security-Policy|'script-src' was not explicitly set/.test(text)) return;
    errors.push('console: ' + text);
  });
  try {
    await page.goto(appOrigin + '/index.html', { timeout: 15000 });
    await page.waitForSelector('#act-settings', { timeout: 15000 });
    await page.click('#act-settings');
    await page.waitForSelector('#act-gen', { timeout: 10000 });
    await page.fill('#ta-import', JSON.stringify(payload));
    await page.click('#act-import');
    await page.waitForSelector('#sheet-ok', { timeout: 6000 });
    await page.click('#sheet-ok');
    await page.waitForSelector('#act-new', { timeout: 10000 });
    await page.waitForTimeout(400);

    const home = await page.evaluate((mark) => {
      const nameEl = Array.from(document.querySelectorAll('.item-name'))
        .find((el) => el.textContent.includes(mark));
      return {
        itemFound: !!nameEl,
        nameRenderedAsText: nameEl ? nameEl.textContent.includes('<img') : null,
        nameParsedAsElement: nameEl ? !!nameEl.querySelector('img') : null,
        anyHandlerAttr: !!document.querySelector('[onerror], [onload], [onmouseover], [onclick]'),
        injectedImg: !!document.querySelector('img[src="x"], img[src="y"]'),
        inlineScript: !!document.querySelectorAll('script:not([src])').length,
      };
    }, MARK);
    record('import-xss-home', home.itemFound && home.nameRenderedAsText === true &&
      home.nameParsedAsElement === false && !home.anyHandlerAttr && !home.injectedImg &&
      !home.inlineScript, JSON.stringify(home));

    await page.click('[data-id="poc-r1"]');
    await page.waitForSelector('.ex-card', { timeout: 10000 });
    await page.waitForTimeout(300);
    const detail = await page.evaluate(() => {
      const exTitle = document.querySelector('.ex-title');
      const lines = Array.from(document.querySelectorAll('.set-line'));
      return {
        title: exTitle ? exTitle.textContent : '',
        exNameAsText: exTitle ? exTitle.textContent.includes('<svg onload') : null,
        svgWithHandler: !!document.querySelector('svg[onload]'),
        lineCount: lines.length,
        lineInjected: lines.some((r) => /onerror|onload|__xss|<script/i.test(r.innerHTML)),
        firstLine: lines.length ? lines[0].textContent.trim() : '',
        injectedBold: !!document.querySelector('#app b b, #app .sum-row b b'),
        flags: {
          name: window.__xssName, ex: window.__xssEx, bw: window.__xssBw,
          neck: window.__xssNeck, reps: window.__xssReps, date: window.__xssDate,
        },
      };
    });
    const flagsSet = Object.values(detail.flags || {}).some((v) => v !== undefined);
    record('import-xss-detail', detail.exNameAsText === true && !detail.svgWithHandler &&
      detail.lineCount === 2 && !detail.lineInjected && !detail.injectedBold &&
      detail.firstLine.includes('\u2013'), JSON.stringify(detail).slice(0, 320));
    record('import-xss-no-exec', !flagsSet, JSON.stringify(detail.flags));
    record('import-xss-no-errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  } catch (err) {
    record('import-xss-home', false, err.message);
    record('import-xss-detail', false, 'import failed before assertions');
    record('import-xss-no-exec', false, 'import failed before assertions');
    record('import-xss-no-errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  }
  await context.close();
}

// P1 QA-04: the storage failure paths used to be dead code to the harness.
// (a) a failed DB open must render the guidance card, not a blank screen;
// (b) a failed settings write must raise the save-warning banner.
async function runStorageFailure(browser, appOrigin) {
  {
    const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      indexedDB.open = function () { throw new Error('forced-open-failure'); };
    });
    const page = await context.newPage();
    try {
      await page.goto(appOrigin + '/index.html', { timeout: 15000 });
      const note = await page.waitForSelector('#app .card.note', { timeout: 15000 });
      const text = (await note.textContent()) || '';
      record('storage-open-failure', /Could not open the local database/.test(text), text.slice(0, 120));
    } catch (err) {
      record('storage-open-failure', false, err.message);
    }
    await context.close();
  }
  {
    const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await page.goto(appOrigin + '/index.html', { timeout: 15000 });
      await page.waitForSelector('#act-settings', { timeout: 15000 });
      await page.evaluate(() => {
        const put = function () { throw new Error('forced-write-failure'); };
        try {
          IDBObjectStore.prototype.put = put;
        } catch (err) {
          Object.defineProperty(IDBObjectStore.prototype, 'put', { value: put, configurable: true });
        }
      });
      await page.click('#act-settings');
      await page.waitForSelector('.theme-btn[data-th="light"]', { timeout: 10000 });
      await page.click('.theme-btn[data-th="light"]');
      const warn = await page.waitForSelector('#save-warn', { timeout: 5000 }).catch(() => null);
      const text = warn ? ((await warn.textContent()) || '') : '';
      record('storage-save-warn', /Saving failed/.test(text), text.slice(0, 120));
    } catch (err) {
      record('storage-save-warn', false, err.message);
    }
    await context.close();
  }
}

// P1 QA-02: WebKit smoke. Playwright ships the engine, but the binary is a
// heavy install, so this only runs when the CI job opts in with
// KAIOKEN_WEBKIT=1. Checks are "soft-" prefixed: a WebKit runner hiccup is
// surfaced as a warning rather than failing the Chromium gate.
async function runWebkitSmoke(webkit, appOrigin) {
  let browser;
  try {
    browser = await webkit.launch({ headless: true });
  } catch (err) {
    record('soft-webkit-launch', false, err.message.slice(0, 200));
    return;
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  try {
    await page.goto(appOrigin + '/index.html', { timeout: 20000 });
    await page.waitForSelector('#act-new', { timeout: 20000 });
    record('soft-webkit-boot', true, 'home rendered');
    await page.click('#act-stats');
    await page.waitForSelector('.seg-tabs', { timeout: 10000 });
    await page.click('.seg-tabs button[data-t="heatmap"]');
    const radar = await page.waitForSelector('.radarsvg', { timeout: 10000 }).catch(() => null);
    record('soft-webkit-radar', !!radar, radar ? 'radar rendered' : 'radar missing');
    record('soft-webkit-errors', errors.length === 0, errors.join(' | ').slice(0, 200));
  } catch (err) {
    record('soft-webkit-boot', false, err.message.slice(0, 200));
  }
  await context.close();
  await browser.close();
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

    await runMaliciousImport(browser, appOrigin);
    await runStorageFailure(browser, appOrigin);
    if (process.env.KAIOKEN_WEBKIT === '1') await runWebkitSmoke(webkit, appOrigin);

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
