(() => {
  'use strict';

  /* ---------- local database (IndexedDB) ---------- */
  const DB_NAME = 'gymlog';
  const DB_VERSION = 2;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('routines')) {
          db.createObjectStore('routines', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function withStore(name, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const req = fn(tx.objectStore(name));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  const store = {
    all: () => withStore('routines', 'readonly', (s) => s.getAll()),
    put: (r) => withStore('routines', 'readwrite', (s) => s.put(r)),
    del: (id) => withStore('routines', 'readwrite', (s) => s.delete(id)),
    getSetting: (key, fallback) =>
      withStore('settings', 'readonly', (s) => s.get(key))
        .then((row) => (row && row.value !== undefined ? row.value : fallback)),
    setSetting: (key, value) =>
      withStore('settings', 'readwrite', (s) => s.put({ key: key, value: value })),
  };

  /* ---------- helpers ---------- */
  const $app = document.getElementById('app');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const uid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const numOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const parts = String(iso).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !n)) return String(iso);
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function fmtClock(ms) { // 04:12 or 1:04:12
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function fmtShort(ms) { // "58m" or "1h 04m"
    const total = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
  }

  function fmtFull(ms) { // "58m 12s" or "1h 04m 12s"
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    if (m) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
  }

  /* ---------- icons ---------- */
  const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const I = {
    plus: '<svg ' + A + '><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg ' + A + '><path d="M15 18l-6-6 6-6"/></svg>',
    chev: '<svg ' + A + '><path d="M9 18l6-6-6-6"/></svg>',
    trash: '<svg ' + A + '><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    check: '<svg ' + A + '><path d="M20 6L9 17l-5-5"/></svg>',
    gear: '<svg ' + A + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    x: '<svg ' + A + '><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chart: '<svg ' + A + '><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    copy: '<svg ' + A + '><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  };

  /* ---------- autocomplete suggestions ---------- */
  const ROUTINE_NAMES = ['Push Day', 'Pull Day', 'Leg Day', 'Upper Body', 'Lower Body', 'Full Body'];

  function suggestMatches(q, names) {
    const n = String(q || '').trim().toLowerCase();
    if (!n) return [];
    const starts = [];
    const contains = [];
    names.forEach((nm) => {
      const ln = nm.toLowerCase();
      if (ln === n) return;
      if (ln.indexOf(n) === 0) starts.push(nm);
      else if (ln.indexOf(n) !== -1) contains.push(nm);
    });
    return starts.concat(contains).slice(0, 6);
  }

  function updateSuggestions(box, input, names, onPick) {
    if (!box) return;
    const matches = suggestMatches(input.value, names);
    box.innerHTML = matches.map((nm) =>
      '<button class="sug" type="button" data-name="' + esc(nm) + '">' + esc(nm) + '</button>'
    ).join('');
    box.hidden = matches.length === 0;
    box.querySelectorAll('.sug').forEach((b) => {
      b.onclick = () => {
        onPick(b.dataset.name);
        box.hidden = true;
      };
    });
  }

  // iOS ignores <datalist>, so suggestions are rendered in the app instead:
  // a list under the field while typing, tappable to fill.
  function bindAutocomplete(input, box, names, onPick) {
    if (!input || !box) return;
    const refresh = () => updateSuggestions(box, input, names, onPick);
    input.addEventListener('input', refresh);
    input.addEventListener('focus', refresh);
    input.addEventListener('blur', () => {
      setTimeout(() => { box.hidden = true; }, 150);
    });
  }

  /* ---------- state ---------- */
  let routines = [];
  let view = { name: 'home' }; // home | new | routine | settings | stats
  let timerInt = null;
  const settings = { rest: 120, theme: 'dark' };

  const THEMES = {
    dark: { label: 'Dark', bg: '#0f1316', card: '#161c23', accent: '#34d399', meta: '#0f1316' },
    oled: { label: 'OLED', bg: '#000000', card: '#0d1113', accent: '#34d399', meta: '#000000' },
    mono: { label: 'Mono', bg: '#0b0d0f', card: '#121517', accent: '#e8eaed', meta: '#0b0d0f' },
    nord: { label: 'Nord', bg: '#242933', card: '#2e3440', accent: '#88c0d0', meta: '#242933' },
    ocean: { label: 'Ocean', bg: '#0c151f', card: '#12202e', accent: '#38bdf8', meta: '#0c151f' },
    forest: { label: 'Forest', bg: '#0e1510', card: '#14201a', accent: '#a3e635', meta: '#0e1510' },
    violet: { label: 'Violet', bg: '#131120', card: '#1a1a2b', accent: '#a78bfa', meta: '#131120' },
    ember: { label: 'Ember', bg: '#17120d', card: '#211a12', accent: '#fb923c', meta: '#17120d' },
    ruby: { label: 'Ruby', bg: '#151012', card: '#1d1518', accent: '#fb7185', meta: '#151012' },
    light: { label: 'Light', bg: '#f4f6f8', card: '#ffffff', accent: '#0d9488', meta: '#f4f6f8' },
    paper: { label: 'Paper', bg: '#f7f2ea', card: '#fffdf8', accent: '#b45309', meta: '#f7f2ea' },
  };

  function applyTheme(id) {
    if (!THEMES[id]) id = 'dark';
    settings.theme = id;
    document.documentElement.dataset.theme = id;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEMES[id].meta);
  }
  const saveTimers = new Map();
  const collapsedMonths = new Set();

  function stopTimer() {
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
  }

  function getRoutine(id) { return routines.find((r) => r.id === id); }

  function persist(r) {
    store.put(r).catch((e) => console.error('Kaioken: save failed', e));
  }

  // Saves soon after typing stops, or immediately for structural changes.
  function scheduleSave(r, immediate) {
    const pending = saveTimers.get(r.id);
    if (pending) clearTimeout(pending);
    if (immediate) {
      saveTimers.delete(r.id);
      persist(r);
      return;
    }
    saveTimers.set(r.id, setTimeout(() => {
      saveTimers.delete(r.id);
      persist(r);
    }, 400));
  }

  function go(name, extra) {
    view = extra ? Object.assign({ name }, extra) : { name };
    render();
  }

  function render() {
    stopTimer();
    document.querySelectorAll('#actionbar').forEach((n) => n.remove());
    document.body.classList.remove('has-bar');
    document.body.classList.remove('has-bar2');
    closeSheet();
    switch (view.name) {
      case 'new': renderNew(); break;
      case 'routine': renderRoutine(); break;
      case 'settings': renderSettings(); break;
      case 'stats': renderStats(); break;
      default: renderHome(); break;
    }
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* ---------- rest timer ---------- */
  let restInt = null;
  let restGoTimer = null;
  let restEndAt = 0;
  let restTotal = 0;

  function stopRest() {
    if (restInt) { clearInterval(restInt); restInt = null; }
    if (restGoTimer) { clearTimeout(restGoTimer); restGoTimer = null; }
    restEndAt = 0;
    const bar = document.getElementById('restbar');
    if (bar) bar.remove();
    document.body.classList.remove('has-rest');
  }

  function startRest() {
    const secs = settings.rest;
    if (!secs) return;
    stopRest();
    restTotal = secs * 1000;
    restEndAt = Date.now() + restTotal;

    const bar = document.createElement('div');
    bar.id = 'restbar';
    bar.innerHTML =
      '<div class="rest-row">' +
      '<span class="rest-label">Rest</span>' +
      '<span id="rest-time"></span>' +
      '<button class="btn btn-icon" id="rest-skip" type="button" aria-label="Skip rest">' + I.x + '</button>' +
      '</div>' +
      '<div class="rest-track"><div id="rest-fill"></div></div>';
    document.body.appendChild(bar);
    document.getElementById('rest-skip').onclick = stopRest;
    document.body.classList.add('has-rest');
    tickRest();
    restInt = setInterval(tickRest, 250);
  }

  function tickRest() {
    const el = document.getElementById('rest-time');
    if (!el) { stopRest(); return; }
    const left = restEndAt - Date.now();
    if (left <= 0) {
      if (restInt) { clearInterval(restInt); restInt = null; }
      el.textContent = 'Go';
      document.getElementById('restbar').classList.add('go');
      restGoTimer = setTimeout(stopRest, 2500);
      return;
    }
    el.textContent = fmtClock(left);
    document.getElementById('rest-fill').style.width = (100 * left / restTotal) + '%';
  }

  /* ---------- long-press action sheet ---------- */
  // The gesture that opens the sheet (touch-and-hold / right-click) can
  // still emit a stray click when it ends - aimed at whatever is under the
  // release point, i.e. the backdrop or even an option button. So the sheet
  // ignores ALL input until a brand-new press (pointerdown/touchstart,
  // captured at document level near the bottom of this file) begins. The
  // stray release click has no new press before it, so it is always
  // ignored, no matter how late it arrives; the next real tap works.
  let sheetGestureLock = false;

  function closeSheet() {
    sheetGestureLock = false;
    document.querySelectorAll('#sheet-backdrop, #sheet').forEach((n) => n.remove());
  }

  function openSheet(r) {
    closeSheet();
    sheetGestureLock = true;
    const guard = (fn) => () => {
      if (sheetGestureLock) return;
      fn();
    };
    const backdrop = document.createElement('div');
    backdrop.id = 'sheet-backdrop';
    const sheet = document.createElement('div');
    sheet.id = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.innerHTML =
      '<div class="sheet-title">' + esc(r.name) + '</div>' +
      '<button class="btn btn-block" id="sheet-dup" type="button">' + I.copy + '<span>Repeat as New</span></button>' +
      '<button class="btn btn-block sheet-danger" id="sheet-del" type="button">' + I.trash + '<span>Delete</span></button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    document.getElementById('sheet-dup').onclick = guard(() => {
      closeSheet();
      const copy = duplicateRoutine(r);
      routines.push(copy);
      scheduleSave(copy, true);
      toast('Duplicated for today');
      go('routine', { id: copy.id });
    });
    document.getElementById('sheet-del').onclick = guard(() => {
      if (!confirm('Delete "' + r.name + '"? This cannot be undone.')) return;
      closeSheet();
      store.del(r.id).catch((e) => console.error('Kaioken:', e));
      routines = routines.filter((x) => x.id !== r.id);
      render();
    });
  }

  // Touch-and-hold (500ms) or right-click opens the action sheet. Small
  // finger drift while holding is tolerated; a real move cancels. The click
  // that follows a long-press is suppressed so it does not navigate.
  function attachLongPress(el, r) {
    let timer = null;
    let fired = false;
    let sx = 0;
    let sy = 0;
    const clear = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    el.addEventListener('touchstart', (e) => {
      fired = false;
      el._suppressClick = false;
      clear();
      const t = (e.touches && e.touches[0]) || {};
      sx = t.clientX || 0;
      sy = t.clientY || 0;
      timer = setTimeout(() => {
        fired = true;
        el._suppressClick = true;
        openSheet(r);
      }, 500);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      const t = (e.touches && e.touches[0]) || {};
      const dx = (t.clientX || sx) - sx;
      const dy = (t.clientY || sy) - sy;
      if (dx * dx + dy * dy > 144) clear();
    }, { passive: true });
    el.addEventListener('touchcancel', clear, { passive: true });
    el.addEventListener('touchend', (e) => {
      clear();
      if (fired && e && e.preventDefault) e.preventDefault();
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (fired) return;
      fired = true;
      clear();
      el._suppressClick = true;
      openSheet(r);
    });
    const base = el.onclick;
    el.onclick = (e) => {
      if (el._suppressClick) { el._suppressClick = false; return; }
      if (base) base(e);
    };
  }

  /* ---------- home ---------- */
  function installHint() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true;
    if (!isIOS || standalone) return '';
    return '<div class="banner">Tip: to add Kaioken to your Home Screen, tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.</div>';
  }

  function itemHTML(r, today) {
    let meta = fmtDate(r.date);
    if (r.exercises.length) {
      meta += ' \u00b7 ' + r.exercises.length + (r.exercises.length === 1 ? ' exercise' : ' exercises');
    }
    let right = I.chev;
    if (r.status === 'active') right = '<span class="chip chip-active">active</span>';
    else if (r.status === 'scheduled' && r.date === today) right = '<span class="chip chip-today">today</span>';
    else if (r.status === 'completed') {
      right = '<span class="chip chip-done">' + fmtShort((r.endedAt || 0) - (r.startedAt || 0)) + '</span>';
    }
    return '<button class="item' + (r.status === 'completed' ? ' hist' : '') + '" data-id="' + esc(r.id) + '">' +
      '<span class="item-main">' +
      '<span class="item-name">' + esc(r.name) + '</span>' +
      '<span class="item-meta">' + meta + '</span>' +
      '</span>' +
      '<span class="item-right">' + right + '</span>' +
      '</button>';
  }

  function sectionHTML(label, items, emptyMsg) {
    if (!items.length && !emptyMsg) return '';
    let h = '<div class="section-label">' + label + '</div>';
    h += items.length ? items.join('') : '<div class="empty">' + emptyMsg + '</div>';
    return h;
  }

  function monthKeyOf(r) {
    const d = routineDate(r);
    if (!d) return 'unknown';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthLabel(key) {
    if (key === 'unknown') return 'Undated';
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, 1)
      .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function renderHome() {
    const today = todayISO();
    const active = routines.filter((r) => r.status === 'active')
      .sort((a, b) => a.startedAt - b.startedAt);
    const scheduled = routines.filter((r) => r.status === 'scheduled')
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const history = routines.filter((r) => r.status === 'completed')
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

    let historyHTML;
    if (history.length) {
      const groups = [];
      const byKey = {};
      history.forEach((r) => {
        const k = monthKeyOf(r);
        if (!byKey[k]) { byKey[k] = []; groups.push(k); }
        byKey[k].push(r);
      });
      historyHTML = '<div class="section-label">History</div>' + groups.map((k) => {
        const open = !collapsedMonths.has(k);
        const items = byKey[k].map((r) => itemHTML(r, today)).join('');
        return '<button class="month-head' + (open ? ' open' : ' closed') +
          '" type="button" data-m="' + k + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="month-name">' + esc(monthLabel(k)) + '</span>' +
          '<span class="month-count">' + byKey[k].length +
          (byKey[k].length === 1 ? ' workout' : ' workouts') + '</span>' +
          '<span class="month-chev">' + I.chev + '</span>' +
          '</button>' +
          '<div class="month-items"' + (open ? '' : ' hidden') + '>' + items + '</div>';
      }).join('') +
        '<p class="hint">Hold a past workout (or right-click it) to repeat or delete it.</p>';
    } else {
      historyHTML = '<div class="section-label">History</div>' +
        '<div class="empty">No finished workouts yet. Create one and hit the gym.</div>';
    }

    $app.innerHTML =
      '<header class="topbar"><h1>Kaioken</h1>' +
      '<button class="btn btn-icon" id="act-stats" aria-label="Volume charts">' + I.chart + '</button>' +
      '<button class="btn btn-icon" id="act-settings" aria-label="Settings">' + I.gear + '</button></header>' +
      installHint() +
      '<button class="btn btn-primary btn-block btn-new" id="act-new">' + I.plus + '<span>New Routine</span></button>' +
      sectionHTML('Active', active.map((r) => itemHTML(r, today)), '') +
      sectionHTML('Scheduled', scheduled.map((r) => itemHTML(r, today)), '') +
      historyHTML;

    document.getElementById('act-new').onclick = () => go('new');
    document.getElementById('act-stats').onclick = () => { statsSelKey = null; go('stats'); };
    document.getElementById('act-settings').onclick = () => go('settings');
    $app.querySelectorAll('.month-head').forEach((el) => {
      el.onclick = () => {
        const k = el.dataset.m;
        if (collapsedMonths.has(k)) collapsedMonths.delete(k);
        else collapsedMonths.add(k);
        render();
      };
    });
    $app.querySelectorAll('.item').forEach((el) => {
      el.onclick = () => go('routine', { id: el.dataset.id });
    });
    $app.querySelectorAll('.item.hist').forEach((el) => {
      const r = getRoutine(el.dataset.id);
      if (r) attachLongPress(el, r);
    });
  }

  /* ---------- new routine ---------- */
  function renderNew() {
    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-cancel" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">New Routine</h1></header>' +
      '<div class="card">' +
      '<label class="field"><span>Name</span>' +
      '<input id="in-name" placeholder="e.g. Push Day" maxlength="40" autocomplete="off" autocapitalize="words">' +
      '<div class="sug-box" id="name-sug" hidden></div></label>' +
      '<label class="field"><span>Date</span>' +
      '<input id="in-date" type="date" value="' + todayISO() + '"></label>' +
      '<p class="hint">Leave today\u2019s date to do it now, or pick a future date to schedule it.</p>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="act-create" type="button">Create Routine</button>';

    document.getElementById('act-cancel').onclick = () => go('home');
    bindAutocomplete(
      document.getElementById('in-name'),
      document.getElementById('name-sug'),
      ROUTINE_NAMES,
      (nm) => { document.getElementById('in-name').value = nm; }
    );
    document.getElementById('act-create').onclick = () => {
      const name = document.getElementById('in-name').value.trim();
      let date = document.getElementById('in-date').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayISO();
      const r = {
        id: uid(),
        name: name || 'Workout',
        date: date,
        createdAt: Date.now(),
        startedAt: null,
        endedAt: null,
        status: 'scheduled',
        exercises: [],
      };
      routines.push(r);
      scheduleSave(r, true);
      go('routine', { id: r.id });
    };
  }

  /* ---------- routine detail ---------- */
  function statusCardHTML(r) {
    if (r.status === 'active') {
      return '<div class="card timer-card">' +
        '<div class="timer-label">Elapsed time</div>' +
        '<div class="timer" id="elapsed">' + fmtClock(Date.now() - r.startedAt) + '</div>' +
        '<div class="timer-sub">started at ' +
        new Date(r.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
        '</div></div>';
    }
    if (r.status === 'scheduled') {
      if (r.date > todayISO()) {
        return '<div class="card note">Scheduled for ' + esc(fmtDate(r.date)) +
          '. Add your exercises below, then tap Save. The timer starts when you begin the workout at the gym.</div>';
      }
      return '<div class="card note">Ready to go. The timer starts when you tap Start Workout.</div>';
    }
    const dur = (r.endedAt || 0) - (r.startedAt || 0);
    const sets = r.exercises.reduce((n, e) => n + e.sets.length, 0);
    return '<div class="card note">' +
      '<div class="sum-row"><span>Date</span><b>' + esc(fmtDate(r.date)) + '</b></div>' +
      '<div class="sum-row"><span>Duration</span><b>' + fmtFull(dur) + '</b></div>' +
      '<div class="sum-row"><span>Sets</span><b>' + sets + '</b></div>' +
      '<div class="sum-row"><span>Finished</span><b>' +
      new Date(r.endedAt || Date.now()).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) +
      '</b></div></div>';
  }

  function exerciseCardHTML(ex, editable, active) {
    if (!editable) {
      const lines = ex.sets.map((s, j) =>
        '<div class="set-line' + (s.done ? ' done' : '') + '">' +
        (s.done ? '<span class="done-check">' + I.check + '</span>' : '<span class="set-idx">' + (j + 1) + '</span>') +
        '<span>' + (s.reps == null ? '\u2013' : s.reps) + ' reps</span>' +
        '<span class="mult">\u00d7</span>' +
        '<span>' + (s.weight == null ? '\u2013' : s.weight) + ' ' + esc(ex.unit) + '</span>' +
        '</div>').join('');
      return '<div class="card ex-card">' +
        '<div class="ex-title">' + esc(ex.name || 'Exercise') +
        '<span class="cat-tag">' + esc(gymlogCategoryOf(ex.name)) + '</span>' +
        '<span class="unit-tag">' + esc(ex.unit) + '</span></div>' +
        (lines || '<div class="empty-inline">No sets logged.</div>') +
        '</div>';
    }

    const rows = ex.sets.map((s, j) => {
      let check;
      if (active) {
        check = '<button class="set-check' + (s.done ? ' on' : '') + '" type="button" aria-label="' +
          (s.done ? 'Mark set as not done' : 'Mark set as done') + '">' +
          (s.done ? I.check : String(j + 1)) + '</button>';
      } else {
        check = '<span class="set-check off">' + (j + 1) + '</span>';
      }
      return '<div class="set-row' + (s.done ? ' done' : '') + '" data-sid="' + esc(s.id) + '">' +
        check +
        '<input class="in-reps" type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="' + (s.reps == null ? '' : s.reps) + '">' +
        '<span class="mult">\u00d7</span>' +
        '<input class="in-weight" type="number" inputmode="decimal" min="0" step="0.25" placeholder="weight" value="' + (s.weight == null ? '' : s.weight) + '">' +
        '<span class="unit-tag">' + esc(ex.unit) + '</span>' +
        '<button class="btn btn-icon btn-del-set" type="button" aria-label="Remove set">' + I.x + '</button>' +
        '</div>';
    }).join('');

    return '<div class="card ex-card" data-eid="' + esc(ex.id) + '">' +
      '<div class="ex-head">' +
      '<input class="ex-name" placeholder="Exercise name" value="' + esc(ex.name) + '" maxlength="48" autocomplete="off" autocapitalize="words">' +
      '<button class="btn btn-icon btn-del-ex" type="button" aria-label="Remove exercise">' + I.trash + '</button>' +
      '</div>' +
      '<div class="sug-box" hidden></div>' +
      '<div class="ex-controls">' +
      '<div class="seg" role="group" aria-label="Weight unit">' +
      '<button type="button" class="' + (ex.unit === 'kg' ? 'on' : '') + '" data-u="kg">kg</button>' +
      '<button type="button" class="' + (ex.unit === 'lb' ? 'on' : '') + '" data-u="lb">lb</button>' +
      '</div>' +
      '<span class="ex-meta">' +
      '<span class="cat-tag">' + esc(gymlogCategoryOf(ex.name)) + '</span>' +
      '<span class="muted-small">' + ex.sets.length + (ex.sets.length === 1 ? ' set' : ' sets') + '</span>' +
      '</span>' +
      '</div>' +
      rows +
      '<button class="btn btn-ghost btn-block btn-add-set" type="button">+ Add Set</button>' +
      '</div>';
  }
  // Mark a set done / not done. Tapping a row toggles too, except on the
  // inputs and the delete button.
  function toggleSet(r, set) {
    set.done = !set.done;
    scheduleSave(r, true);
    render();
    if (set.done && r.status === 'active') {
      const anyLeft = r.exercises.some((e) => e.sets.some((s) => !s.done));
      if (anyLeft) startRest();
    }
  }

  // A fresh copy of a routine for the next session: same exercises, sets,
  // reps and weights, but nothing marked done and not yet started.
  function duplicateRoutine(r) {
    return {
      id: uid(),
      name: r.name,
      date: todayISO(),
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      status: 'scheduled',
      exercises: r.exercises.map((ex) => ({
        id: uid(),
        name: ex.name,
        unit: ex.unit,
        sets: ex.sets.map((s) => ({
          id: uid(),
          reps: s.reps,
          weight: s.weight,
          done: false,
        })),
      })),
    };
  }

  function renderRoutine() {
    const r = getRoutine(view.id);
    if (!r) { view = { name: 'home' }; return renderHome(); }
    const editable = r.status !== 'completed';
    const activeView = r.status === 'active';
    const exCards = r.exercises.map((ex) => exerciseCardHTML(ex, editable, activeView)).join('');

    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-back" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">' + esc(r.name) + '</h1>' +
      '<button class="btn btn-icon btn-danger" id="act-del" aria-label="Delete routine">' + I.trash + '</button>' +
      '</header>' +
      statusCardHTML(r) +
      '<div class="section-label">Exercises</div>' +
      (exCards || '<div class="empty">No exercises yet. Add your first one below.</div>') +
      (editable ? '<button class="btn btn-ghost btn-block" id="act-add-ex" type="button">+ Add Exercise</button>' : '') +
      '<div class="spacer"></div>';

    let barHTML = '';
    let twoButtonBar = false;
    if (r.status === 'scheduled') {
      if (r.date > todayISO()) {
        twoButtonBar = true;
        barHTML = '<button class="btn btn-primary btn-block" id="act-save" type="button">Save Routine</button>' +
          '<button class="btn btn-ghost btn-block btn-start-now" id="act-start" type="button">' + I.play + '<span>Start Now</span></button>';
      } else {
        barHTML = '<button class="btn btn-primary btn-block" id="act-start" type="button">' + I.play + '<span>Start Workout</span></button>';
      }
    } else if (r.status === 'active') {
      barHTML = '<button class="btn btn-primary btn-block btn-stop" id="act-finish" type="button">' + I.stop + '<span>Finish Workout</span></button>';
    }
    if (barHTML) {
      const bar = document.createElement('div');
      bar.id = 'actionbar';
      bar.innerHTML = barHTML;
      document.body.appendChild(bar);
      document.body.classList.add('has-bar');
      if (twoButtonBar) document.body.classList.add('has-bar2');
    }

    document.getElementById('act-back').onclick = () => go('home');
    document.getElementById('act-del').onclick = () => {
      if (!confirm('Delete this routine? This cannot be undone.')) return;
      stopRest();
      store.del(r.id).catch((e) => console.error(e));
      routines = routines.filter((x) => x.id !== r.id);
      stopTimer();
      go('home');
    };

    const saveBtn = document.getElementById('act-save');
    if (saveBtn) saveBtn.onclick = () => {
      scheduleSave(r, true);
      toast('Routine saved for ' + fmtDate(r.date));
      go('home');
    };

    const startBtn = document.getElementById('act-start');
    if (startBtn) startBtn.onclick = () => {
      r.status = 'active';
      r.startedAt = Date.now();
      scheduleSave(r, true);
      render();
    };

    const finBtn = document.getElementById('act-finish');
    if (finBtn) finBtn.onclick = () => {
      if (!confirm('Finish workout? Recorded duration: ' + fmtFull(Date.now() - r.startedAt) + '.')) return;
      stopRest();
      r.status = 'completed';
      r.endedAt = Date.now();
      scheduleSave(r, true);
      render();
    };

    const addEx = document.getElementById('act-add-ex');
    if (addEx) addEx.onclick = () => {
      r.exercises.push({
        id: uid(),
        name: '',
        unit: 'kg',
        sets: [{ id: uid(), reps: null, weight: null, done: false }],
      });
      scheduleSave(r, true);
      render();
      const names = $app.querySelectorAll('.ex-name');
      if (names.length) names[names.length - 1].focus();
    };

    $app.querySelectorAll('.ex-card[data-eid]').forEach((card) => {
      const ex = r.exercises.find((e) => e.id === card.dataset.eid);
      if (!ex) return;

      const nameIn = card.querySelector('.ex-name');
      bindAutocomplete(nameIn, card.querySelector('.sug-box'), GYMLOG_EX_NAMES, (nm) => {
        ex.name = nm;
        nameIn.value = nm;
        const tag = card.querySelector('.cat-tag');
        if (tag) tag.textContent = gymlogCategoryOf(nm);
        scheduleSave(r, true);
      });
      nameIn.addEventListener('input', () => {
        ex.name = nameIn.value;
        const tag = card.querySelector('.cat-tag');
        if (tag) tag.textContent = gymlogCategoryOf(ex.name);
        scheduleSave(r);
      });

      card.querySelectorAll('.seg button').forEach((b) => {
        b.onclick = () => {
          if (ex.unit === b.dataset.u) return;
          ex.unit = b.dataset.u;
          card.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
          card.querySelectorAll('.unit-tag').forEach((t) => (t.textContent = ex.unit));
          scheduleSave(r, true);
        };
      });

      card.querySelectorAll('.set-row').forEach((row) => {
        const set = ex.sets.find((s) => s.id === row.dataset.sid);
        if (!set) return;
        const repsIn = row.querySelector('.in-reps');
        const wtIn = row.querySelector('.in-weight');
        repsIn.addEventListener('input', () => {
          set.reps = numOrNull(repsIn.value);
          scheduleSave(r);
        });
        wtIn.addEventListener('input', () => {
          set.weight = numOrNull(wtIn.value);
          scheduleSave(r);
        });
        row.querySelector('.btn-del-set').onclick = () => {
          ex.sets = ex.sets.filter((s) => s.id !== set.id);
          scheduleSave(r, true);
          render();
        };
        if (activeView) {
          const checkBtn = row.querySelector('.set-check');
          if (checkBtn) checkBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleSet(r, set);
          };
          row.onclick = (e) => {
            if (e && e.target && e.target.closest && (
              e.target.closest('input') ||
              e.target.closest('.btn-del-set') ||
              e.target.closest('.set-check')
            )) return;
            toggleSet(r, set);
          };
        }
      });

      card.querySelector('.btn-del-ex').onclick = () => {
        if (ex.sets.length && !confirm('Remove "' + (ex.name || 'this exercise') + '" and its sets?')) return;
        r.exercises = r.exercises.filter((e) => e.id !== ex.id);
        scheduleSave(r, true);
        render();
      };

      card.querySelector('.btn-add-set').onclick = () => {
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({
          id: uid(),
          reps: last ? last.reps : null,
          weight: last ? last.weight : null,
          done: false,
        });
        scheduleSave(r, true);
        render();
      };
    });

    if (r.status === 'active') {
      timerInt = setInterval(() => {
        const el = document.getElementById('elapsed');
        if (!el) { stopTimer(); return; }
        el.textContent = fmtClock(Date.now() - r.startedAt);
      }, 500);
    }
  }

  /* ---------- stats ---------- */
  const LB_TO_KG = 0.45359237;
  let statsTab = 'progression'; // progression | heatmap | volume
  let statsSelKey = null;      // volume tab: selected week key
  let statsExSel = null;       // progression tab: selected exercise name
  let statsPointSel = null;    // progression tab: selected point index
  let statsCellSel = null;     // heatmap tab: { cat, key }

  function weekStart(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    return date;
  }

  function isoKey(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function fmtDay(iso) {
    const p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || !p[0]) return String(iso);
    return new Date(p[0], p[1] - 1, p[2])
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function fmtVol(v) {
    return Math.round(v).toLocaleString() + ' kg';
  }

  function fmtVolCompact(v) {
    if (v >= 10000) return Math.round(v / 1000) + 't';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  function fmt1(v) {
    return (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function routineDate(r) {
    if (r.endedAt) return new Date(r.endedAt);
    const p = String(r.date || '').split('-').map(Number);
    if (p.length === 3 && p[0]) return new Date(p[0], p[1] - 1, p[2]);
    return null;
  }

  function completedRoutines() {
    return routines.filter((r) => r.status === 'completed')
      .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  }

  function setVolumeKg(ex, s) {
    if (s.reps == null || s.weight == null) return 0;
    return s.reps * s.weight * (ex.unit === 'lb' ? LB_TO_KG : 1);
  }

  // All exercises with at least one valid set in completed routines,
  // grouped by lowercase name with their best set (by Epley est. 1RM) per session.
  function progressionData() {
    const byName = {};
    completedRoutines().forEach((r) => {
      r.exercises.forEach((ex) => {
        const nm = String(ex.name || '').trim();
        if (!nm) return;
        const key = nm.toLowerCase();
        const g = byName[key] = byName[key] || { name: nm, sessions: [] };
        g.name = nm;
        let best = null;
        ex.sets.forEach((s) => {
          if (s.reps == null || s.weight == null || s.reps <= 0 || s.weight <= 0) return;
          const e = s.weight * (1 + s.reps / 30);
          if (!best || e > best.e) {
            best = { reps: s.reps, weight: s.weight, unit: ex.unit, e: e, rdate: r.date };
          }
        });
        if (best) g.sessions.push(best);
      });
    });
    return byName;
  }

  function renderStats() {
    const tabs = [
      { id: 'progression', label: 'Progression' },
      { id: 'heatmap', label: 'Muscles' },
      { id: 'volume', label: 'Volume' },
    ];
    let body;
    if (statsTab === 'heatmap') body = statsHeatmapHTML();
    else if (statsTab === 'volume') body = statsVolumeHTML();
    else body = statsProgressionHTML();

    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-back" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">Stats</h1></header>' +
      '<div class="seg seg-tabs">' + tabs.map((t) =>
        '<button type="button" class="' + (statsTab === t.id ? 'on' : '') + '" data-t="' + t.id + '">' +
        t.label + '</button>').join('') + '</div>' +
      body;

    document.getElementById('act-back').onclick = () => go('home');
    $app.querySelectorAll('.seg-tabs button').forEach((b) => {
      b.onclick = () => {
        if (statsTab === b.dataset.t) return;
        statsTab = b.dataset.t;
        render();
      };
    });
    if (statsTab === 'heatmap') bindHeatmap();
    else if (statsTab === 'volume') bindVolume();
    else bindProgression();
  }

  /* ---- progression tab ---- */

  function statsProgressionHTML() {
    const byName = progressionData();
    const names = Object.keys(byName).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      return '<div class="card"><div class="empty">No completed workouts yet.</div></div>';
    }
    const selKey = String(statsExSel || '').toLowerCase();
    if (!selKey || !byName[selKey]) statsExSel = byName[names[0]].name;
    const g = byName[String(statsExSel).toLowerCase()];
    const sessions = g.sessions;
    const unit = sessions[sessions.length - 1].unit;
    const vals = sessions.map((s) => (s.unit === 'lb' ? s.e * LB_TO_KG : s.e));
    const disps = vals.map((v) => (unit === 'kg' ? v : v / LB_TO_KG));
    if (statsPointSel == null || statsPointSel < 0 || statsPointSel >= sessions.length) {
      statsPointSel = sessions.length - 1;
    }
    const sel = sessions[statsPointSel];

    const options = names.map((n) => {
      const d = byName[n];
      return '<option value="' + esc(d.name) + '"' + (d === g ? ' selected' : '') + '>' +
        esc(d.name) + ' \u00b7 ' + d.sessions.length +
        (d.sessions.length === 1 ? ' session' : ' sessions') + '</option>';
    }).join('');

    return '<div class="card">' +
      '<select id="sel-ex" class="sel-ex">' + options + '</select>' +
      progressionSVG(sessions, disps, unit) +
      '<div class="cell-detail">Est. 1RM <b>' + fmt1(disps[statsPointSel]) + ' ' + esc(unit) + '</b>' +
      ' \u00b7 top set ' + sel.reps + ' \u00d7 ' + sel.weight + ' ' + esc(sel.unit) +
      ' \u00b7 ' + esc(fmtDay(sel.rdate)) + '</div>' +
      '</div>' +
      '<p class="hint">Estimated 1RM (Epley: weight \u00d7 (1 + reps/30)) of your best set per session. Tap a point to see its top set. Shown in the unit of your latest entry; pounds are converted for display only.</p>';
  }

  function progressionSVG(sessions, disps, unit) {
    const W = 320, H = 150, padX = 12, top = 26, bot = 24;
    const n = sessions.length;
    const xs = [];
    for (let i = 0; i < n; i++) {
      xs.push(n === 1 ? W / 2 : padX + (W - 2 * padX) * (i / (n - 1)));
    }
    let min = Math.min.apply(null, disps);
    let max = Math.max.apply(null, disps);
    if (min === max) { min = Math.max(0, min - 1); max = max + 1; }
    const span = (max - min) * 0.08;
    const lo = min - span;
    const hi = max + span;
    const y = (v) => top + (H - top - bot) * (1 - (v - lo) / (hi - lo));
    const pts = sessions.map((s, i) => xs[i].toFixed(1) + ',' + y(disps[i]).toFixed(1));
    const base = (H - bot).toFixed(1);
    const dots = sessions.map((s, i) =>
      '<circle class="pt" data-i="' + i + '" cx="' + xs[i].toFixed(1) + '" cy="' + y(disps[i]).toFixed(1) +
      '" r="' + (i === n - 1 ? 4 : 3) + '" fill="' + (i === statsPointSel ? 'var(--text)' : 'var(--accent)') + '"/>'
    ).join('');
    const lastY = y(disps[n - 1]);
    const lx = Math.min(W - 30, Math.max(30, xs[n - 1])).toFixed(1);
    const ly = (lastY > 42 ? lastY - 12 : lastY + 18).toFixed(1);

    return '<svg class="linesvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progression over sessions">' +
      (n > 1
        ? '<polygon class="area" points="' + pts.join(' ') + ' ' + xs[n - 1].toFixed(1) + ',' + base + ' ' + xs[0].toFixed(1) + ',' + base + '"/>' +
          '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '') +
      dots +
      '<text class="lbl" x="' + lx + '" y="' + ly + '" text-anchor="middle">' +
      fmt1(disps[n - 1]) + ' ' + esc(unit) + '</text>' +
      '<text class="axis" x="' + padX + '" y="' + (H - 8) + '">' + esc(fmtDay(sessions[0].rdate)) + '</text>' +
      '<text class="axis" x="' + (W - padX) + '" y="' + (H - 8) + '" text-anchor="end">' +
      esc(fmtDay(sessions[n - 1].rdate)) + '</text>' +
      '</svg>';
  }

  function bindProgression() {
    const selEl = document.getElementById('sel-ex');
    if (selEl) selEl.onchange = () => {
      statsExSel = selEl.value;
      statsPointSel = null;
      render();
    };
    $app.querySelectorAll('.pt').forEach((el) => {
      el.onclick = () => { statsPointSel = Number(el.dataset.i); render(); };
    });
  }

  /* ---- heatmap tab ---- */

  function statsHeatmapHTML() {
    const N = 12;
    const start = weekStart(new Date());
    const weeks = [];
    for (let i = N - 1; i >= 0; i--) {
      const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7);
      weeks.push({ key: isoKey(ws), start: ws });
    }
    const byKey = {};
    weeks.forEach((w) => { byKey[w.key] = w; });

    const grid = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const w = byKey[isoKey(weekStart(d))];
      if (!w) return;
      r.exercises.forEach((ex) => {
        const cat = gymlogCategoryOf(ex.name);
        ex.sets.forEach((s) => {
          const v = setVolumeKg(ex, s);
          if (v <= 0) return;
          grid[cat] = grid[cat] || {};
          grid[cat][w.key] = (grid[cat][w.key] || 0) + v;
        });
      });
    });

    const cats = GYMLOG_CATS.filter((c) => grid[c] && weeks.some((w) => grid[c][w.key]));
    if (!cats.length) {
      return '<div class="card"><div class="empty">No completed workouts in the last 12 weeks.</div></div>';
    }
    let maxCell = 0;
    cats.forEach((c) => weeks.forEach((w) => {
      maxCell = Math.max(maxCell, (grid[c] && grid[c][w.key]) || 0);
    }));

    const rows = cats.map((cat) => {
      const cells = weeks.map((w) => {
        const v = (grid[cat] && grid[cat][w.key]) || 0;
        const sel = statsCellSel && statsCellSel.cat === cat && statsCellSel.key === w.key;
        if (v <= 0) {
          return '<button class="hcell' + (sel ? ' sel' : '') + '" type="button" data-cat="' + esc(cat) +
            '" data-w="' + w.key + '" aria-label="' + esc(cat) + ', week of ' + fmtDay(w.key) + ': no volume"></button>';
        }
        const lvl = Math.max(1, Math.min(4, Math.ceil((v / maxCell) * 4)));
        const op = [0, 0.25, 0.5, 0.75, 1][lvl];
        return '<button class="hcell' + (sel ? ' sel' : '') + '" type="button" data-cat="' + esc(cat) +
          '" data-w="' + w.key + '" style="background:' + GYMLOG_CAT_COLORS[cat] + ';opacity:' + op + '"' +
          ' aria-label="' + esc(cat) + ', week of ' + fmtDay(w.key) + ': ' + fmtVol(v) + '"></button>';
      }).join('');
      return '<div class="hrow"><span class="hlabel">' + esc(cat) + '</span>' +
        '<div class="hcells">' + cells + '</div></div>';
    }).join('');

    let detail = 'Tap a cell to see that muscle and week.';
    if (statsCellSel) {
      const cat = statsCellSel.cat;
      const v = (grid[cat] && grid[cat][statsCellSel.key]) || 0;
      const w = byKey[statsCellSel.key];
      const range = w
        ? fmtDay(w.key) + ' \u2013 ' + fmtDay(isoKey(new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + 6)))
        : '';
      detail = esc(cat) + ' \u00b7 week of ' + range +
        ' \u00b7 <b>' + (v > 0 ? fmtVol(v) : 'no volume') + '</b>';
    }

    return '<div class="card">' + rows + '</div>' +
      '<div class="card"><div class="cell-detail">' + detail + '</div></div>' +
      '<p class="hint">Training volume by muscle group over the last 12 weeks (Monday-start). Darker means more volume (kg-normalized).</p>';
  }

  function bindHeatmap() {
    $app.querySelectorAll('.hcell').forEach((el) => {
      el.onclick = () => {
        statsCellSel = { cat: el.dataset.cat, key: el.dataset.w };
        render();
      };
    });
  }

  /* ---- volume tab ---- */

  function statsVolumeHTML() {
    const N = 8;
    const start = weekStart(new Date());
    const cols = [];
    for (let i = N - 1; i >= 0; i--) {
      const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7);
      cols.push({ key: isoKey(ws), start: ws, cats: {} });
    }
    const byKey = {};
    cols.forEach((c) => { byKey[c.key] = c; });

    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const col = byKey[isoKey(weekStart(d))];
      if (!col) return;
      r.exercises.forEach((ex) => {
        const cat = gymlogCategoryOf(ex.name);
        ex.sets.forEach((s) => {
          const v = setVolumeKg(ex, s);
          if (v <= 0) return;
          col.cats[cat] = (col.cats[cat] || 0) + v;
        });
      });
    });

    let totalAll = 0;
    cols.forEach((c) => {
      c.total = 0;
      Object.keys(c.cats).forEach((k) => { c.total += c.cats[k]; });
      totalAll += c.total;
    });
    const max = Math.max.apply(null, cols.map((c) => c.total).concat([1]));

    const lastWithVolume = cols.slice().reverse().find((c) => c.total > 0);
    if (!statsSelKey || !byKey[statsSelKey]) {
      statsSelKey = lastWithVolume ? lastWithVolume.key : cols[cols.length - 1].key;
    }
    const sel = byKey[statsSelKey];
    const selEnd = new Date(sel.start.getFullYear(), sel.start.getMonth(), sel.start.getDate() + 6);

    const chartHTML = cols.map((c) => {
      const segs = GYMLOG_CATS.slice().reverse()
        .filter((cat) => c.cats[cat] > 0)
        .map((cat) => '<div class="segm" style="height:' +
          ((c.cats[cat] / max) * 100).toFixed(3) + '%;background:' +
          GYMLOG_CAT_COLORS[cat] + '"></div>')
        .join('');
      const label = c.start.getDate() + '/' + (c.start.getMonth() + 1);
      return '<button class="col' + (c.key === sel.key ? ' sel' : '') + '" data-w="' + c.key +
        '" type="button" aria-label="Week of ' + fmtDay(c.key) + '">' +
        '<span class="col-total">' + (c.total > 0 ? fmtVolCompact(c.total) : '') + '</span>' +
        (c.total > 0 ? '<span class="segs">' + segs + '</span>' : '<span class="segs empty"></span>') +
        '<span class="col-label">' + label + '</span>' +
        '</button>';
    }).join('');

    const rows = GYMLOG_CATS.filter((cat) => sel.cats[cat] > 0).map((cat) => {
      const share = sel.total ? Math.round((sel.cats[cat] / sel.total) * 100) : 0;
      return '<div class="bd-row">' +
        '<span class="bd-dot" style="background:' + GYMLOG_CAT_COLORS[cat] + '"></span>' +
        '<span class="bd-cat">' + esc(cat) + '</span>' +
        '<span class="bd-share">' + share + '%</span>' +
        '<span class="bd-vol">' + fmtVol(sel.cats[cat]) + '</span>' +
        '</div>';
    }).join('');

    return '<div class="card note">' +
      '<div class="sum-row"><span>8-week total</span><b>' + fmtVol(totalAll) + '</b></div>' +
      '<div class="sum-row"><span>Weekly average</span><b>' + fmtVol(totalAll / N) + '</b></div>' +
      '</div>' +
      '<div class="card chart-card">' +
      '<div class="chart">' + chartHTML + '</div>' +
      '</div>' +
      '<div class="card">' +
      '<div class="section-label slim">Week of ' + fmtDay(sel.key) + ' \u2013 ' + fmtDay(isoKey(selEnd)) + '</div>' +
      (rows || '<div class="empty-inline">No volume this week.</div>') +
      '</div>' +
      '<p class="hint">Volume = reps \u00d7 weight per set, completed routines only. Totals are normalized to kg for comparison (1 kg = 2.2046 lb); your logged entries are unchanged.</p>';
  }

  function bindVolume() {
    $app.querySelectorAll('.col').forEach((el) => {
      el.onclick = () => { statsSelKey = el.dataset.w; render(); };
    });
  }

  /* ---------- backup / restore ---------- */
  function toNum(v) {
    if (v === '' || v == null || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function sanitizeRoutine(r) {
    r.name = (typeof r.name === 'string' && r.name.trim())
      ? r.name.trim().slice(0, 60) : 'Workout';
    r.date = (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      ? r.date : todayISO();
    r.status = (r.status === 'active' || r.status === 'completed')
      ? r.status : 'scheduled';
    r.createdAt = toNum(r.createdAt) || Date.now();
    r.startedAt = toNum(r.startedAt);
    r.endedAt = toNum(r.endedAt);
    r.exercises = Array.isArray(r.exercises) ? r.exercises : [];
    r.exercises.forEach((e) => {
      e.id = (typeof e.id === 'string' && e.id) ? e.id : uid();
      e.name = typeof e.name === 'string' ? e.name.slice(0, 60) : '';
      e.unit = e.unit === 'lb' ? 'lb' : 'kg';
      e.sets = Array.isArray(e.sets) ? e.sets : [];
      e.sets.forEach((s) => {
        s.id = (typeof s.id === 'string' && s.id) ? s.id : uid();
        s.reps = toNum(s.reps);
        s.weight = toNum(s.weight);
        s.done = s.done === true;
      });
    });
    return r;
  }

  function renderSettings() {
    const restOptions = [
      { secs: 60, label: '1 min' },
      { secs: 90, label: '1.5 min' },
      { secs: 120, label: '2 min' },
    ];
    const exportText = JSON.stringify(
      { app: 'kaioken', version: 1, exportedAt: new Date().toISOString(), routines: routines },
      null, 2
    );
    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-back" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">Settings</h1></header>' +
      '<div class="card">' +
      '<div class="field"><span>Theme</span>' +
      '<div class="theme-grid">' +
      Object.keys(THEMES).map((id) => {
        const t = THEMES[id];
        const on = settings.theme === id;
        return '<button class="theme-btn' + (on ? ' on' : '') + '" type="button" data-th="' + id + '">' +
          '<span class="swatches">' +
          '<span class="sw" style="background:' + t.bg + '"></span>' +
          '<span class="sw" style="background:' + t.card + '"></span>' +
          '<span class="sw" style="background:' + t.accent + '"></span>' +
          '</span>' +
          '<span class="theme-name">' + t.label + '</span>' +
          '<span class="sw-check">' + I.check + '</span>' +
          '</button>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<p class="hint">Applies instantly. The home-screen icon and launch screen keep the default dark look.</p>' +
      '</div>' +
      '<div class="card">' +
      '<label class="field"><span>Rest time between sets</span>' +
      '<div class="seg seg-rest">' +
      restOptions.map((o) =>
        '<button type="button" data-s="' + o.secs + '" class="' +
        (settings.rest === o.secs ? 'on' : '') + '">' + o.label + '</button>'
      ).join('') +
      '</div></label>' +
      '<p class="hint">Starts automatically when you mark a set as done during a workout. You can skip it any time.</p>' +
      '</div>' +
      '<div class="card">' +
      '<p class="hint">Your routines are stored only on this device. Export regularly and keep a copy somewhere safe (Notes, email, cloud storage). Paste a backup below to restore it or move it to a new phone.</p>' +
      '<label class="field"><span>Export (copy this text)</span>' +
      '<textarea id="ta-export" rows="10" spellcheck="false">' + esc(exportText) + '</textarea></label>' +
      '<button class="btn btn-ghost btn-block" id="act-copy" type="button">Copy to Clipboard</button>' +
      '</div>' +
      '<div class="card">' +
      '<label class="field"><span>Import (paste a backup)</span>' +
      '<textarea id="ta-import" rows="4" spellcheck="false" placeholder="Paste backup JSON here"></textarea></label>' +
      '<button class="btn btn-primary btn-block" id="act-import" type="button">Import</button>' +
      '</div>';

    document.getElementById('act-back').onclick = () => go('home');

    $app.querySelectorAll('.theme-btn').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.th;
        if (settings.theme === id) return;
        applyTheme(id);
        $app.querySelectorAll('.theme-btn').forEach((x) => x.classList.toggle('on', x === b));
        store.setSetting('theme', id)
          .catch((e) => console.error('Kaioken: setting save failed', e));
      };
    });

    $app.querySelectorAll('.seg-rest button').forEach((b) => {
      b.onclick = () => {
        settings.rest = Number(b.dataset.s);
        $app.querySelectorAll('.seg-rest button').forEach((x) => x.classList.toggle('on', x === b));
        store.setSetting('rest', settings.rest)
          .catch((e) => console.error('Kaioken: setting save failed', e));
      };
    });

    document.getElementById('act-copy').onclick = () => {
      const ta = document.getElementById('ta-export');
      ta.focus();
      ta.select();
      const fallback = () => {
        try {
          document.execCommand('copy');
          toast('Copied');
        } catch (e) {
          toast('Select the text and copy it manually');
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(
          () => toast('Copied to clipboard'),
          fallback
        );
      } else {
        fallback();
      }
    };

    document.getElementById('act-import').onclick = async () => {
      let data;
      try {
        data = JSON.parse(document.getElementById('ta-import').value);
      } catch (e) {
        alert('That does not look like valid JSON.');
        return;
      }
      const incoming = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.routines)) ? data.routines : null;
      const list = (incoming || [])
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .map(sanitizeRoutine);
      if (!list.length) {
        alert('No routines found in the backup.');
        return;
      }
      let added = 0;
      let updated = 0;
      for (const ir of list) {
        const idx = routines.findIndex((x) => x.id === ir.id);
        if (idx >= 0) {
          routines[idx] = ir;
          updated++;
        } else {
          routines.push(ir);
          added++;
        }
        await store.put(ir);
      }
      toast('Imported ' + added + ' new, updated ' + updated);
      go('home');
    };
  }

  /* ---------- init ---------- */
  // A new press anywhere unlocks the action sheet: the gesture that opened
  // it may still emit a stray click when it ends, which must be ignored.
  document.addEventListener('pointerdown', () => { sheetGestureLock = false; }, true);
  document.addEventListener('touchstart', () => { sheetGestureLock = false; }, true);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  openDB()
    .then(() => store.getSetting('rest', 120))
    .then((rest) => {
      settings.rest = (typeof rest === 'number' && rest > 0) ? rest : 120;
    })
    .then(() => store.getSetting('theme', 'dark'))
    .then((t) => { applyTheme(THEMES[t] ? t : 'dark'); })
    .then(() => store.all())
    .then((rows) => { routines = rows || []; })
    .then(render)
    .catch((err) => {
      $app.innerHTML = '<div class="card note">Could not open the local database: ' +
        esc(err && err.message) + '</div>';
    });
})();
