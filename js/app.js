(() => {
  'use strict';

  const APP_VERSION = '1.10.0';

  /* ---------- session clock (#50) ---------- */
  // The wall clock can jump under an NTP correction or a timezone change,
  // which would distort a workout's duration mid-session. Anchor a
  // monotonic clock to the wall clock at boot: stored timestamps stay
  // wall-clock-comparable, but elapsed time is immune to jumps while the
  // page stays open. Across a reload, the wall clock is authoritative again.
  const bootWall = Date.now();
  const bootPerf = performance.now();
  const monoNow = () => bootWall + (performance.now() - bootPerf);

  /* ---------- clickjacking backstop (#45) ---------- */
  // frame-ancestors cannot be expressed in a <meta> CSP and GitHub Pages
  // cannot set response headers, so any origin could embed the app and
  // socially-engineer destructive taps. Same-origin embedding is allowed
  // (it is no attack surface: a same-origin host already owns the page,
  // and the test harness and dev previews rely on it); anything else gets
  // navigated out of the frame, and when the browser blocks that
  // navigation the document is hidden so the framed copy stays inert.
  (function frameGuard() {
    const sameOrigin = () => {
      try { return new URL(top.location.href).origin === self.location.origin; }
      catch (err) { return false; }
    };
    if (self === top || sameOrigin()) return;
    try { top.location = self.location.href; } catch (err) { /* nav blocked: hide below */ }
    setTimeout(() => {
      if (!sameOrigin()) document.documentElement.style.visibility = 'hidden';
    }, 0);
  })();

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
      req.onsuccess = () => {
        const db = req.result;
        // Another context upgraded the database: this connection turns
        // stale and every later write on it fails - drop the cached
        // promise so the next store operation reopens a fresh one.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      // A suspended tab (iOS Safari backgrounds tabs before their JS can
      // run onversionchange) holding an older connection blocks the
      // upgrade forever: without this the init chain never settles and
      // the app hangs on a blank screen with no instruction (#36). The
      // init catch renders the guidance instead.
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('Another Kaioken tab is holding an older database open. Close it and reload.'));
      };
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

  // Locale-tolerant number parsing: accepts "22.5" and "22,5" (comma
  // locales). Ambiguous input is rejected instead of silently misparsed:
  // mixed separators ("1.234,5"), thousands-style groups ("1,234" would
  // become 1.234) and negatives ("−100 × −5" would count as +500 volume)
  // all come back null, i.e. treated as an empty field.
  const numOrNull = (v) => {
    if (v === '' || v == null) return null;
    const t = String(v).trim();
    // Anchor the shape before converting (#41): parseFloat would happily
    // take "1e3" (1000), "0x10" (0) or "10kg" (10).
    if (!/^\d+([.,]\d+)?$/.test(t)) return null;
    const seps = (t.match(/[.,]/g) || []).length;
    if (seps === 1 && /^\d+,\d{3}$/.test(t)) return null;
    const n = parseFloat(t.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  // A real calendar date in YYYY-MM-DD form: the Date constructor rolls
  // impossible dates over (2024-02-31 becomes Mar 2), which left display,
  // storage and grouping disagreeing after autofill/paste/import (#40).
  // The round-trip check catches every rolled-over date.
  const validDate = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const p = s.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
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
    flame: '<svg ' + A + '><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
    thermo: '<svg ' + A + '><path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0z"/></svg>',
    gear: '<svg ' + A + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    x: '<svg ' + A + '><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chart: '<svg ' + A + '><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    copy: '<svg ' + A + '><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
    edit: '<svg ' + A + '><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    up: '<svg ' + A + '><path d="M18 15l-6-6-6 6"/></svg>',
    down: '<svg ' + A + '><path d="M6 9l6 6 6-6"/></svg>',
    dots: '<svg ' + A + '><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
    share: '<svg ' + A + '><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
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

  // Canonical catalog name for a typed value (case-insensitive exact match),
  // or null - exercise names are restricted to catalog entries, so typos
  // like "bice" can never be written to the log. Existing history keeps its
  // saved names.
  function catalogNameOf(v) {
    const n = String(v || '').trim().toLowerCase();
    if (!n) return null;
    for (let i = 0; i < GYMLOG_EX_NAMES.length; i++) {
      if (GYMLOG_EX_NAMES[i].toLowerCase() === n) return GYMLOG_EX_NAMES[i];
    }
    return null;
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
  let programs = []; // (#62) stored whole-array in the settings store
  let storagePersisted = null;
  let view = { name: 'home' }; // home | new | routine | program | settings | stats
  let timerInt = null;
  const settings = { rest: 120, theme: 'dark', bgStyle: 'off', photo: '', photoFit: 'fill', suppsLast: false, bwUnit: 'kg', homeChart: null, homeOrder: null, goals: null };

  const THEMES = {
    dark: { label: 'Dark', bg: '#0f1316', card: '#161c23', accent: '#34d399', meta: '#0f1316' },
    kaioken: { label: 'Kaioken', bg: '#0f1316', card: '#161c23', accent: '#38bdf8', meta: '#0f1316' },
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
    syncHeat();
  }

  // Kaioken heat theme: the accent runs cold when you have not trained
  // this week and heats up (Kaio-ken x1..x20) as you complete workouts.
  // Derived from the routines data - nothing extra is stored.
  const HEAT_LEVELS = [
    { label: 'Kaio-ken \u00d71', accent: '#38bdf8', ink: '#08222f', soft: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.4)', text: '#bae6fd', area: 'rgba(56, 189, 248, 0.16)' },
    { label: 'Kaio-ken \u00d72', accent: '#2dd4bf', ink: '#04231f', soft: 'rgba(45, 212, 191, 0.12)', border: 'rgba(45, 212, 191, 0.4)', text: '#99f6e4', area: 'rgba(45, 212, 191, 0.16)' },
    { label: 'Kaio-ken \u00d73', accent: '#fbbf24', ink: '#271a03', soft: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.4)', text: '#fde68a', area: 'rgba(251, 191, 36, 0.16)' },
    { label: 'Kaio-ken \u00d74', accent: '#fb923c', ink: '#2a1305', soft: 'rgba(251, 146, 60, 0.12)', border: 'rgba(251, 146, 60, 0.4)', text: '#fed7aa', area: 'rgba(251, 146, 60, 0.16)' },
    { label: 'Kaio-ken \u00d720', accent: '#f87171', ink: '#2a0a0a', soft: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.42)', text: '#fecaca', area: 'rgba(248, 113, 113, 0.16)' },
  ];
  const HEAT_VARS = ['--accent', '--accent-ink', '--accent-soft', '--accent-border', '--accent-text', '--accent-area'];

  function computeHeat() {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    let count = 0;
    routines.forEach((r) => {
      if (r.status !== 'completed') return;
      const d = routineDate(r);
      if (d && d.getTime() >= weekAgo) count++;
    });
    return Math.min(4, count);
  }

  function applyHeatLevel(i) {
    const lv = HEAT_LEVELS[i];
    if (!lv) return;
    const s = document.documentElement.style;
    s.setProperty('--accent', lv.accent);
    s.setProperty('--accent-ink', lv.ink);
    s.setProperty('--accent-soft', lv.soft);
    s.setProperty('--accent-border', lv.border);
    s.setProperty('--accent-text', lv.text);
    s.setProperty('--accent-area', lv.area);
  }

  function clearHeat() {
    const s = document.documentElement.style;
    HEAT_VARS.forEach((p) => s.removeProperty(p));
  }

  function syncHeat() {
    if (settings.theme === 'kaioken') applyHeatLevel(computeHeat());
    else clearHeat();
  }

  // Background styles: 'off' | 'texture' (generated jpg layer) | 'photo'
  // (one of the user's own photos, downscaled and stored on-device).
  // 'bg' (boolean) is the legacy setting from before styles existed.
  const BG_STYLES = ['off', 'texture', 'photo'];

  // Only genuine photo data URLs ever reach the CSS url() token: anything
  // else (a future writer, imported settings, a debug path) is rejected
  // instead of being injected into the stylesheet.
  // Only the data URLs loadPhotoFile itself can emit pass: the canvas
  // always re-encodes to JPEG (#46). Anything wider (svg+xml matched the
  // old [a-z+]+ shape) is stored as '' - defense in depth before a future
  // import path ever makes this gate load-bearing.
  const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

  function applyPhoto(dataUrl) {
    settings.photo = (typeof dataUrl === 'string' && PHOTO_RE.test(dataUrl)) ? dataUrl : '';
    const s = document.documentElement.style;
    if (settings.photo) {
      s.setProperty('--bg-photo', 'url("' + settings.photo + '")');
    } else {
      s.removeProperty('--bg-photo');
    }
  }

  // Fallback decoder for engines without createImageBitmap.
  function decodeViaImg(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = String(reader.result || '');
      };
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  // Downscale with a canvas and store as a data URL, so the photo lives
  // only on this device (IndexedDB) and works offline. Decoding goes
  // through createImageBitmap with EXIF orientation applied, so iPhone
  // portraits render upright; every failure surfaces as a toast instead
  // of being swallowed.
  async function loadPhotoFile(file) {
    if (!file) return;
    if (!file.type || String(file.type).indexOf('image/') !== 0) {
      toast('That does not look like an image');
      return;
    }
    let bmp;
    try {
      bmp = window.createImageBitmap
        ? await createImageBitmap(file, { imageOrientation: 'from-image' })
        : await decodeViaImg(file);
    } catch (e) {
      toast('Could not load that image');
      return;
    }
    const max = 1290;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (!dataUrl || dataUrl.length < 32) {
      toast('Could not load that image');
      return;
    }
    store.setSetting('photo', dataUrl)
      .catch((e) => console.error('Kaioken: setting save failed', e));
    applyPhoto(dataUrl);
    applyBgStyle('photo');
    render();
  }

  function pickPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      loadPhotoFile(file);
    };
    input.click();
  }

  function applyBgStyle(v, autoPick) {
    if (BG_STYLES.indexOf(v) === -1) v = 'off';
    settings.bgStyle = v;
    document.documentElement.dataset.bg = v;
    if (autoPick && v === 'photo' && !settings.photo) pickPhoto();
  }

  function applyPhotoFit(v) {
    settings.photoFit = v === 'fit' ? 'fit' : 'fill';
    document.documentElement.dataset.photoFit = settings.photoFit;
  }
  const saveTimers = new Map();
  const collapsedMonths = new Set();

  // Workout focus: in an active routine the exercises fold down to their
  // headers so only the one you are performing stays open. All start folded
  // - unfold the one you are on; finishing its sets folds it and unfolds
  // the next. View state only, never stored.
  let activeOpenEx = null;
  let lastFoldCtx = '';

  function stopTimer() {
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
  }

  function getRoutine(id) { return routines.find((r) => r.id === id); }

  // A save queued for a routine that was deleted from memory meanwhile must
  // never be written back - the delete's store.del has already landed.
  function persist(r) {
    if (routines.indexOf(r) === -1) return;
    store.put(r)
      .then(() => hideSaveWarn())
      .catch((e) => {
        console.error('Kaioken: save failed', e);
        showSaveWarn();
      });
  }

  // A failed write must not stay a console-only secret: the user keeps
  // typing into a session that would not survive a reload. The banner
  // clears itself on the next successful save.
  function showSaveWarn() {
    if (document.getElementById('save-warn')) return;
    const el = document.createElement('div');
    el.id = 'save-warn';
    el.setAttribute('role', 'alert');
    el.innerHTML = 'Saving failed \u2014 your edits are not being stored. ' +
      '<button type="button" id="save-warn-reload">Reload the app</button>';
    document.body.appendChild(el);
    document.getElementById('save-warn-reload').onclick = () => location.reload();
  }

  function hideSaveWarn() {
    const el = document.getElementById('save-warn');
    if (el) el.remove();
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

  // Deleting a routine drops its pending debounced save too, or the queued
  // persist() would fire after store.del() and resurrect the routine.
  function cancelPendingSave(id) {
    const t = saveTimers.get(id);
    if (t) { clearTimeout(t); saveTimers.delete(id); }
  }

  // iOS can kill a backgrounded PWA without firing pending debounce timers:
  // flush queued saves the moment the app is hidden or closed, so the last
  // edits survive instead of dying with the timer.
  function flushPendingSaves() {
    saveTimers.forEach((t, id) => {
      clearTimeout(t);
      saveTimers.delete(id);
      const r = getRoutine(id);
      if (r) persist(r);
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') flushPendingSaves();
  });
  window.addEventListener('pagehide', flushPendingSaves);

  function go(name, extra) {
    const next = extra ? Object.assign({ name }, extra) : { name };
    const same = view.name === next.name && view.id === next.id;
    view = next;
    if (!same) {
      try { history.pushState({ view: view }, ''); } catch (err) {}
    }
    render();
  }

  // Heat cells, volume segments, breakdown dots and theme swatches carry
  // their colors and sizes as data attributes and get painted here via
  // the CSSOM after every render (#45): the CSP has no 'unsafe-inline'
  // in style-src, and script-set style properties are outside its scope
  // while style="" attributes in markup are not.
  function paintGeneratedStyles(root) {
    root.querySelectorAll('.hcell[data-op]').forEach((el) => {
      const c = GYMLOG_CAT_COLORS[el.dataset.cat];
      if (!c) return;
      el.style.background = c;
      el.style.opacity = el.dataset.op;
    });
    root.querySelectorAll('.hcells[data-cols]').forEach((el) => {
      el.style.gridTemplateColumns = 'repeat(' + el.dataset.cols + ', 1fr)';
    });
    root.querySelectorAll('.segm[data-h]').forEach((el) => {
      const c = GYMLOG_CAT_COLORS[el.dataset.cat];
      if (!c) return;
      el.style.height = el.dataset.h + '%';
      el.style.background = c;
    });
    root.querySelectorAll('.goal-fill[data-w]').forEach((el) => {
      el.style.width = el.dataset.w + '%';
    });
    root.querySelectorAll('.bd-dot[data-cat]').forEach((el) => {
      const c = GYMLOG_CAT_COLORS[el.dataset.cat];
      if (c) el.style.background = c;
    });
    root.querySelectorAll('.sw[data-swatch]').forEach((el) => {
      const t = THEMES[el.dataset.th];
      if (!t) return;
      el.style.background = el.dataset.swatch === 'accent' && el.dataset.th === 'kaioken'
        ? HEAT_LEVELS[computeHeat()].accent
        : t[el.dataset.swatch];
    });
  }

  function render() {
    stopTimer();
    bestEpleyCache.clear();
    document.querySelectorAll('#actionbar').forEach((n) => n.remove());
    document.body.classList.remove('has-bar');
    document.body.classList.remove('has-bar2');
    closeSheet();
    syncHeat();
    switch (view.name) {
      case 'new': renderNew(); break;
      case 'routine': renderRoutine(); break;
      case 'program': renderProgram(); break;
      case 'settings': renderSettings(); break;
      case 'stats': renderStats(); break;
      default: renderHome(); break;
    }
    paintGeneratedStyles($app);
  }

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
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
    restEndAt = monoNow() + restTotal;

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
    const left = restEndAt - monoNow();
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

  let sheetFocusBack = null;

  let sheetVV = null;

  function closeSheet() {
    sheetGestureLock = false;
    if ($app && $app.inert) $app.inert = false;
    if (sheetVV && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', sheetVV.onVV);
      window.visualViewport.removeEventListener('scroll', sheetVV.onVV);
      sheetVV.cancel();
      sheetVV = null;
    }
    document.querySelectorAll('#sheet-backdrop, #sheet').forEach((n) => n.remove());
    // dialogs return focus to whatever opened them, so keyboard users are
    // not dropped back at the top of the page
    if (sheetFocusBack && sheetFocusBack.focus) {
      try { sheetFocusBack.focus(); } catch (err) {}
      sheetFocusBack = null;
    }
  }

  // Every sheet mounts through here: the first control receives focus so
  // the sheet is operable from a keyboard without a pointer event.
  function mountSheet(backdrop, sheet) {
    sheetFocusBack = document.activeElement || null;
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    if ($app && 'inert' in $app) $app.inert = true;
    const first = sheet.querySelector('button, input');
    if (first && first.focus) first.focus();
    if (window.visualViewport) {
      let tid = 0;
      const apply = () => {
        tid = 0;
        const vv = window.visualViewport;
        const overlap = sheet.getBoundingClientRect().bottom - (vv.height + vv.offsetTop);
        if (overlap > 1) {
          sheet.style.transform = 'translateY(' + (-Math.ceil(overlap)) + 'px)';
          sheet.style.maxHeight = Math.max(200, Math.floor(vv.height - 16)) + 'px';
        } else {
          sheet.style.transform = '';
          sheet.style.maxHeight = '';
        }
      };
      const onVV = () => {
        if (tid) cancelAnimationFrame(tid);
        tid = requestAnimationFrame(apply);
      };
      const cancel = () => {
        if (tid) { cancelAnimationFrame(tid); tid = 0; }
      };
      window.visualViewport.addEventListener('resize', onVV);
      window.visualViewport.addEventListener('scroll', onVV);
      sheetVV = { onVV: onVV, cancel: cancel };
    }
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
      (r.status === 'completed' && shareableRoutine(r)
        ? '<button class="btn btn-block" id="sheet-share" type="button">' + I.share + '<span>Share highlight</span></button>'
        : '') +
      '<button class="btn btn-block" id="sheet-ren" type="button">' + I.edit + '<span>Rename</span></button>' +
      '<button class="btn btn-block" id="sheet-dup" type="button">' + I.copy + '<span>Repeat as New</span></button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-addprog" type="button">' + I.copy + '<span>Add to Program</span></button>' +
      '<button class="btn btn-block sheet-danger" id="sheet-del" type="button">' + I.trash + '<span>Delete</span></button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    const shareBtn = document.getElementById('sheet-share');
    if (shareBtn) shareBtn.onclick = guard(() => { shareHighlight(r); });
    document.getElementById('sheet-addprog').onclick = guard(() => {
      openProgramPicker(r);
    });
    document.getElementById('sheet-ren').onclick = guard(() => {
      openPromptSheet({
        title: 'Rename routine',
        label: 'Name',
        value: r.name,
        okLabel: 'Rename',
        onOk: (nm) => {
          const name = String(nm).trim().slice(0, 60);
          if (!name || name === r.name) return;
          r.name = name;
          scheduleSave(r, true);
          render();
        },
      });
    });
    document.getElementById('sheet-dup').onclick = guard(() => {
      closeSheet();
      const copy = duplicateRoutine(r);
      routines.push(copy);
      scheduleSave(copy, true);
      toast('Duplicated for today');
      go('routine', { id: copy.id });
    });
    document.getElementById('sheet-del').onclick = guard(() => {
      openConfirmSheet({
        title: 'Delete workout',
        message: 'Delete "' + r.name + '"? This cannot be undone.',
        confirmLabel: 'Delete',
        onConfirm: () => {
          // Deleting the routine this rest timer belongs to must stop it,
          // like finish and abandon already do (#38) - the bar lives on
          // document.body and deliberately survives render().
          stopRest();
          cancelPendingSave(r.id);
          store.del(r.id).catch((e) => console.error('Kaioken:', e));
          routines = routines.filter((x) => x.id !== r.id);
          render();
        },
      });
    });
  }

  // In-app confirmation/prompt/alert sheets. The native alert/confirm/
  // prompt dialogs have a long history of silently no-op'ing in iOS
  // Home-Screen (standalone) web apps, so every destructive action and
  // piece of feedback goes through the app's own, reliable sheet system.
  function openConfirmSheet(opts) {
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
      '<div class="sheet-title">' + esc(opts.title) + '</div>' +
      (opts.message ? '<div class="fin-sub">' + esc(opts.message) + '</div>' : '') +
      '<button class="btn btn-block ' + (opts.danger === false ? 'btn-primary' : 'sheet-danger') +
      '" id="sheet-ok" type="button">' +
      esc(opts.confirmLabel || 'Confirm') + '</button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    document.getElementById('sheet-ok').onclick = guard(() => {
      closeSheet();
      // Sheet actions run fire-and-forget: an async onConfirm (import,
      // delete, abandon) that rejects must not become an unhandled
      // rejection the user never hears about (#33).
      Promise.resolve()
        .then(opts.onConfirm)
        .catch((err) => {
          console.error('Kaioken: sheet action failed', err);
          openAlertSheet({
            title: 'Action failed',
            message: 'Something went wrong and the action did not complete. Reload the app and check the latest state before retrying.',
          });
        });
    });
  }

  function openPromptSheet(opts) {
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
      '<div class="sheet-title">' + esc(opts.title) + '</div>' +
      '<label class="field"><span>' + esc(opts.label || 'Name') + '</span>' +
      '<input id="sheet-input" maxlength="60" autocomplete="off" value="' + esc(opts.value || '') + '">' +
      '</label>' +
      '<button class="btn btn-block btn-primary" id="sheet-ok" type="button">' +
      esc(opts.okLabel || 'OK') + '</button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);
    const input = document.getElementById('sheet-input');
    const ok = guard(() => {
      const v = input.value;
      closeSheet();
      opts.onOk(v);
    });
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    document.getElementById('sheet-ok').onclick = ok;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ok(); }
    });
    input.focus();
    input.select();
  }

  function openAlertSheet(opts) {
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
      '<div class="sheet-title">' + esc(opts.title) + '</div>' +
      (opts.message ? '<div class="fin-sub">' + esc(opts.message) + '</div>' : '') +
      '<button class="btn btn-block btn-primary" id="sheet-ok" type="button">' +
      esc(opts.okLabel || 'OK') + '</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-ok').onclick = guard(closeSheet);
  }

  // Finish check-in: before a workout is recorded as completed, a sheet
  // asks for creatine/protein (yes/no switch, remembering the last answer)
  // and today's body weight (optional; the kg/lb choice is remembered).
  // Both are saved on the routine with the finish time.
  function openFinishSheet(r) {
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
    const finWarnN = r.exercises.reduce((n, ex) =>
      n + ex.sets.filter((s) => !s.done &&
        (s.reps != null || s.weight != null || s.mins != null || s.dist != null)).length, 0);
    sheet.innerHTML =
      '<div class="sheet-title">Finish workout?</div>' +
      '<div class="fin-sub">Recorded duration ' + fmtFull(monoNow() - r.startedAt) + '</div>' +
      (finWarnN
        ? '<div class="fin-sub fin-warn">' + finWarnN +
        (finWarnN === 1 ? ' set is' : ' sets are') + ' not marked done \u2014 finish anyway?</div>'
        : '') +
      '<div class="fin-row">' +
      '<span>Creatine / protein today?</span>' +
      '<label class="switch"><input type="checkbox" id="fin-supps"' +
      (settings.suppsLast ? ' checked' : '') + '><span class="sw-track"></span></label>' +
      '</div>' +
      '<div class="fin-row">' +
      '<span>Body weight</span>' +
      '<span class="fin-bw">' +
      '<input id="fin-bw" type="text" inputmode="decimal" autocomplete="off" placeholder="optional">' +
      '<span class="seg seg-bw">' +
      '<button type="button" class="' + (settings.bwUnit === 'lb' ? '' : 'on') + '" data-bw="kg">kg</button>' +
      '<button type="button" class="' + (settings.bwUnit === 'lb' ? 'on' : '') + '" data-bw="lb">lb</button>' +
      '</span>' +
      '</span>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="fin-ok" type="button">Finish Workout</button>' +
      '<button class="btn btn-ghost btn-block" id="fin-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);

    let bwUnit = settings.bwUnit === 'lb' ? 'lb' : 'kg';
    const bwIn = document.getElementById('fin-bw');
    sheet.querySelectorAll('.seg-bw button').forEach((b) => {
      b.onclick = guard(() => {
        if (bwUnit === b.dataset.bw) return;
        bwUnit = b.dataset.bw;
        sheet.querySelectorAll('.seg-bw button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    bwIn.addEventListener('blur', () => {
      const n = numOrNull(bwIn.value);
      bwIn.value = n == null ? '' : String(n);
    });
    backdrop.onclick = guard(closeSheet);
    document.getElementById('fin-cancel').onclick = guard(closeSheet);
    document.getElementById('fin-ok').onclick = guard(() => {
      const supps = document.getElementById('fin-supps').checked;
      const bw = numOrNull(bwIn.value);
      closeSheet();
      settings.suppsLast = supps;
      settings.bwUnit = bwUnit;
      store.setSetting('suppsLast', supps)
        .catch((e) => console.error('Kaioken: setting save failed', e));
      store.setSetting('bwUnit', bwUnit)
        .catch((e) => console.error('Kaioken: setting save failed', e));
      const heatBefore = computeHeat();
      stopRest();
      r.status = 'completed';
      r.endedAt = monoNow();
      r.date = todayISO();
      r.supps = supps;
      r.bodyWeight = bw;
      r.bwUnit = bwUnit;
      scheduleSave(r, true);
      render();
      const heatAfter = computeHeat();
      if (heatAfter > heatBefore && settings.theme === 'kaioken') {
        toast(HEAT_LEVELS[heatAfter].label + '!');
      }
    });
  }

  // Touch-and-hold (500ms) or right-click opens the action sheet. Small
  // finger drift while holding is tolerated; a real move cancels. The click
  // that follows a long-press is suppressed so it does not navigate.
  function attachLongPress(el, onSheet) {
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
        onSheet();
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
      onSheet();
    });
    const base = el.onclick;
    el.onclick = (e) => {
      if (el._suppressClick) { el._suppressClick = false; return; }
      if (base) base(e);
    };
  }

  /* ---------- programs (#62) ---------- */
  // A program is a named bundle of routine templates: routine-shaped
  // entries (name + exercises with sets) minus the scheduling fields.
  // They live as one array value in the settings store - the database
  // schema stays at version 2, so a deployed 1.11.0 can be rolled back
  // with a plain git revert with zero data hazard.
  function getProgram(id) {
    return programs.find((p) => p.id === id) || null;
  }

  function savePrograms() {
    store.setSetting('programs', programs)
      .catch((e) => console.error('Kaioken: program save failed', e));
  }

  // Deep-copy exercises with fresh ids, nothing marked done: the shared
  // shape behind "start a template today" and "copy a routine into a
  // program".
  function copyExercises(exs) {
    return (exs || []).map((ex) => ({
      id: uid(),
      name: ex.name,
      unit: ex.unit === 'lb' ? 'lb' : 'kg',
      dunit: ex.dunit === 'mi' ? 'mi' : 'km',
      sets: (ex.sets || []).map((st) => ({
        id: uid(),
        reps: toNum(st.reps),
        weight: toNum(st.weight),
        mins: toNum(st.mins),
        dist: toNum(st.dist),
        done: false,
        warmup: st.warmup === true,
      })),
    }));
  }

  function upsertTemplate(p, tpl) {
    const existing = p.routines.find((x) => x.name === tpl.name);
    if (existing) existing.exercises = tpl.exercises;
    else p.routines.push(tpl);
  }

  // Materialize a template as today's scheduled routine. The routine is
  // tagged with the program id so the home card can show "2/4 this week";
  // Repeat-as-New copies stay untagged (they are manual copies).
  function routineFromTemplate(p, t) {
    const r = {
      id: uid(),
      programId: p.id,
      name: t.name,
      date: todayISO(),
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      status: 'scheduled',
      exercises: copyExercises(t.exercises),
    };
    routines.push(r);
    scheduleSave(r, true);
    return r;
  }

  function programWeekDone(p) {
    const w = goalWindow('week');
    return completedInRange(w[0], w[1]).filter((r) => r.programId === p.id).length;
  }

  // Generic pick-list sheet (mirrors the other sheet builders: same
  // backdrop, gesture lock and keyboard trap).
  function openListSheet(opts) {
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
      '<div class="sheet-title">' + esc(opts.title) + '</div>' +
      (opts.items.length
        ? opts.items.map((it) =>
          '<button class="btn btn-block' + (it.danger ? ' sheet-danger' : '') + '" type="button" data-pick="' + esc(it.id) + '">' +
          '<span>' + esc(it.label) +
          (it.sub ? ' <span class="muted-small">' + esc(it.sub) + '</span>' : '') +
          '</span></button>').join('')
        : '<div class="empty-inline">' + esc(opts.empty || 'Nothing to pick yet.') + '</div>') +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    sheet.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = guard(() => {
        const it = opts.items.find((x) => x.id === b.dataset.pick);
        closeSheet();
        if (it) opts.onPick(it);
      });
    });
  }

  function openProgramSheet(p) {
    openListSheet({
      title: p.name,
      items: [
        { id: 'ren', label: 'Rename' },
        { id: 'dup', label: 'Duplicate' },
        { id: 'del', label: 'Delete', danger: true },
      ],
      onPick: (it) => {
        if (it.id === 'ren') {
          openPromptSheet({
            title: 'Rename program',
            label: 'Name',
            value: p.name,
            onOk: (v) => {
              const nm = String(v || '').trim().slice(0, 60);
              if (!nm) return;
              p.name = nm;
              savePrograms();
              render();
            },
          });
        } else if (it.id === 'dup') {
          programs.push({
            id: uid(),
            name: (p.name + ' copy').slice(0, 60),
            createdAt: Date.now(),
            routines: p.routines.map((t) => ({
              id: uid(),
              name: t.name,
              exercises: copyExercises(t.exercises),
            })),
          });
          savePrograms();
          render();
        } else if (it.id === 'del') {
          confirmDeleteProgram(p);
        }
      },
    });
  }

  function confirmDeleteProgram(p) {
    openConfirmSheet({
      title: 'Delete program',
      message: 'Delete "' + p.name + '"? Workouts already logged from it are kept.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        programs = programs.filter((x) => x.id !== p.id);
        savePrograms();
        if (view.name === 'program' && view.id === p.id) go('home');
        else render();
      },
    });
  }

  function openTemplateSheet(p, t) {
    const items = [
      { id: 'up', label: 'Move up' },
      { id: 'down', label: 'Move down' },
      { id: 'ren', label: 'Rename' },
      { id: 'del', label: 'Remove from program', danger: true },
    ];
    openListSheet({
      title: t.name,
      items: items,
      onPick: (it) => {
        const idx = p.routines.indexOf(t);
        if (it.id === 'up' && idx > 0) {
          p.routines.splice(idx, 1);
          p.routines.splice(idx - 1, 0, t);
          savePrograms();
          render();
        } else if (it.id === 'down' && idx >= 0 && idx < p.routines.length - 1) {
          p.routines.splice(idx, 1);
          p.routines.splice(idx + 1, 0, t);
          savePrograms();
          render();
        } else if (it.id === 'ren') {
          openPromptSheet({
            title: 'Rename routine',
            label: 'Name',
            value: t.name,
            onOk: (v) => {
              const nm = String(v || '').trim().slice(0, 60);
              if (!nm) return;
              t.name = nm;
              savePrograms();
              render();
            },
          });
        } else if (it.id === 'del') {
          p.routines = p.routines.filter((x) => x.id !== t.id);
          savePrograms();
          render();
        }
      },
    });
  }

  function openProgramPicker(r) {
    const items = programs.map((p) => ({
      id: p.id,
      label: p.name,
      sub: p.routines.length + (p.routines.length === 1 ? ' routine' : ' routines'),
    }));
    items.push({ id: '__new', label: 'New program\u2026' });
    openListSheet({
      title: 'Add "' + (r.name || 'routine') + '" to',
      items: items,
      onPick: (it) => {
        const addTo = (p) => {
          upsertTemplate(p, { id: uid(), name: r.name, exercises: copyExercises(r.exercises) });
          savePrograms();
          render();
          toast('"' + r.name + '" added to ' + p.name);
        };
        if (it.id === '__new') {
          openPromptSheet({
            title: 'New program',
            label: 'Name',
            okLabel: 'Create',
            onOk: (v) => {
              const nm = String(v || '').trim().slice(0, 60);
              if (!nm) return;
              const p = { id: uid(), name: nm, createdAt: Date.now(), routines: [] };
              programs.push(p);
              addTo(p);
            },
          });
        } else {
          const p = getProgram(it.id);
          if (p) addTo(p);
        }
      },
    });
  }

  function programsHTML() {
    if (!programs.length) return '';
    const items = programs.map((p) => {
      const done = programWeekDone(p);
      const next = p.routines.length
        ? p.routines[Math.min(done, p.routines.length - 1)]
        : null;
      const meta = p.routines.length + (p.routines.length === 1 ? ' routine' : ' routines') +
        (next ? ' \u00b7 next: ' + esc(next.name) : '');
      return '<button class="item" data-prog="' + esc(p.id) + '">' +
        '<span class="item-main">' +
        '<span class="item-name">' + esc(p.name) + '</span>' +
        '<span class="item-meta">' + meta + '</span>' +
        '</span>' +
        '<span class="item-right"><span class="chip chip-prog">' + done + '/' + p.routines.length + ' this week</span></span>' +
        '</button>';
    });
    return sectionHTML('Programs', items, '');
  }

  function renderProgram() {
    const p = getProgram(view.id);
    if (!p) { view = { name: 'home' }; return renderHome(); }
    const done = programWeekDone(p);
    const next = p.routines.length
      ? p.routines[Math.min(done, p.routines.length - 1)]
      : null;
    const tplItems = p.routines.map((t) => {
      const exN = (t.exercises || []).length;
      return '<button class="item prog-tpl" data-tid="' + esc(t.id) + '">' +
        '<span class="item-main">' +
        '<span class="item-name">' + esc(t.name) + '</span>' +
        '<span class="item-meta">' + exN + (exN === 1 ? ' exercise' : ' exercises') + '</span>' +
        '</span>' +
        '<span class="item-right">' + I.chev + '</span>' +
        '</button>';
    }).join('');
    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-back" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">' + esc(p.name) + '</h1>' +
      '<button class="btn btn-icon" id="act-more" aria-label="More actions">' + I.dots + '</button>' +
      '<button class="btn btn-icon btn-danger" id="act-del" aria-label="Delete program">' + I.trash + '</button>' +
      '</header>' +
      '<div class="card note">' +
      (p.routines.length
        ? 'Tap a routine to schedule it for today. This week: <b>' +
          Math.min(done, p.routines.length) + '/' + p.routines.length + '</b>' +
          (next ? '. Next up: <b>' + esc(next.name) + '</b>' : '') + '.'
        : 'No routines in this program yet. Copy one in from an existing routine below.') +
      '</div>' +
      '<div class="section-label">Routines</div>' +
      (tplItems || '<div class="empty">Nothing here yet.</div>') +
      '<button class="btn btn-ghost btn-block" id="act-copy-routine" type="button">' + I.copy + '<span>Copy from Routine</span></button>' +
      '<p class="hint">Long-press a routine to move it up or down, rename it or remove it. Starting one creates today’s scheduled workout - the timer starts when you tap Start Workout, like any routine.</p>' +
      '<div class="spacer"></div>';

    document.getElementById('act-back').onclick = () => go('home');
    document.getElementById('act-more').onclick = () => openProgramSheet(p);
    document.getElementById('act-del').onclick = () => confirmDeleteProgram(p);
    $app.querySelectorAll('.prog-tpl').forEach((el) => {
      const t = p.routines.find((x) => x.id === el.dataset.tid);
      if (!t) return;
      el.onclick = () => {
        const r = routineFromTemplate(p, t);
        toast('"' + t.name + '" scheduled for today');
        go('routine', { id: r.id });
      };
      attachLongPress(el, () => openTemplateSheet(p, t));
    });
    document.getElementById('act-copy-routine').onclick = () => {
      openListSheet({
        title: 'Copy from routine',
        empty: 'No routines yet - create one first.',
        items: routines.slice()
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .map((r) => ({
            id: r.id,
            label: r.name,
            sub: fmtDate(r.date),
          })),
        onPick: (it) => {
          const src = getRoutine(it.id);
          if (!src) return;
          upsertTemplate(p, { id: uid(), name: src.name, exercises: copyExercises(src.exercises) });
          savePrograms();
          render();
          toast('"' + src.name + '" added to ' + p.name);
        },
      });
    };
  }

  /* ---------- goals (#65) ---------- */
  // Calendar windows for goal progress: a Monday-start week (the same
  // buckets the volume charts use), the current month and the current
  // year. computeHeat's rolling 7 days is for the theme; goals are
  // "this week/month/year" targets, so they use calendar windows.
  function goalWindow(period) {
    const now = new Date();
    if (period === 'month') {
      return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
    }
    if (period === 'year') {
      return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
    }
    const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    ws.setDate(ws.getDate() - (ws.getDay() + 6) % 7);
    return [ws, new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 7)];
  }

  function completedInRange(start, end) {
    return completedRoutines().filter((r) => {
      const d = routineDate(r);
      return d && d >= start && d < end;
    });
  }

  // Creatine/protein adherence counts days, not workouts: two finished
  // workouts on one day with supps logged still count as one day.
  function suppsDaysInRange(list) {
    const days = new Set();
    list.forEach((r) => { if (r.supps === true) days.add(r.date); });
    return days.size;
  }

  // Body-weight goal: a target value, not a cumulative count. `current`
  // is the latest logged weigh-in, `start` the first one on/after the day
  // the target was last changed (so editing the target resets progress
  // without touching history). Progress is clamped to 0-100 and works for
  // both cutting and gaining (the signs cancel).
  function weightGoalInfo() {
    const g = settings.goals && settings.goals.weight;
    if (!g) return null;
    const toKg = (v, u) => v * (u === 'lb' ? LB_TO_KG : 1);
    let start = null;
    let current = null;
    completedRoutines().forEach((r) => {
      if (r.bodyWeight == null) return;
      const kg = toKg(r.bodyWeight, r.bwUnit);
      const ts = r.endedAt || r.createdAt || 0;
      if (!current || ts >= current.ts) current = { ts: ts, kg: kg };
      if (!g.since || r.date >= g.since) {
        if (!start || ts < start.ts) start = { ts: ts, kg: kg };
      }
    });
    const fromKg = (kg) => (g.unit === 'lb' ? kg / LB_TO_KG : kg);
    if (!current) return { g: g, empty: true };
    if (!start) start = current;
    const targetKg = toKg(g.target, g.unit);
    let pct = 0;
    if (Math.abs(current.kg - targetKg) < 0.05) pct = 100;
    else {
      const total = start.kg - targetKg;
      if (Math.abs(total) > 1e-9) {
        pct = Math.max(0, Math.min(100, Math.round(100 * (start.kg - current.kg) / total)));
      }
    }
    return { g: g, empty: false, start: start, current: current, targetKg: targetKg, pct: pct, fromKg: fromKg };
  }

  function goalRowHTML(label, value, pct, done) {
    return '<div class="goal-row' + (done ? ' done' : '') + '">' +
      '<span class="goal-top">' +
      '<span class="goal-label">' + esc(label) + '</span>' +
      '<span class="goal-val">' + esc(value) + '</span>' +
      '</span>' +
      '<span class="goal-track"><span class="goal-fill" data-w="' + pct + '"></span></span>' +
      '</div>';
  }

  function goalsHTML() {
    const g = settings.goals;
    if (!g) return '';
    const rows = [];
    const periods = [['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']];
    if (g.workouts) {
      periods.forEach((p) => {
        const t = g.workouts[p[0]];
        if (!(t > 0)) return;
        const w = goalWindow(p[0]);
        const n = completedInRange(w[0], w[1]).length;
        rows.push(goalRowHTML(p[1] + ' workouts', n + '/' + t,
          Math.min(100, Math.round(100 * n / t)), n >= t));
      });
    }
    if (g.supps) {
      periods.slice(0, 2).forEach((p) => {
        const t = g.supps[p[0]];
        if (!(t > 0)) return;
        const w = goalWindow(p[0]);
        const n = suppsDaysInRange(completedInRange(w[0], w[1]));
        rows.push(goalRowHTML(p[1] + ' creatine/protein', n + '/' + t,
          Math.min(100, Math.round(100 * n / t)), n >= t));
      });
    }
    const wg = weightGoalInfo();
    if (wg) {
      if (wg.empty) {
        rows.push('<div class="goal-row"><span class="goal-top">' +
          '<span class="goal-label">Body weight</span>' +
          '<span class="goal-val muted-small">log weight after a workout</span>' +
          '</span></div>');
      } else {
        const u = wg.g.unit;
        const val = wg.pct >= 100
          ? fmt1(wg.fromKg(wg.targetKg)) + ' ' + u + ' reached'
          : fmt1(wg.fromKg(wg.current.kg)) + ' \u2192 ' + fmt1(wg.fromKg(wg.targetKg)) + ' ' + u +
            ' \u00b7 ' + fmt1(wg.fromKg(Math.abs(wg.current.kg - wg.targetKg))) + ' to go';
        rows.push(goalRowHTML('Body weight', val, wg.pct, wg.pct >= 100));
      }
    }
    if (!rows.length) return '';
    return '<div class="section-label">Goals</div>' +
      '<div class="card goal-card">' + rows.join('') + '</div>';
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

  // Home calendar: a compact strip of the last 7 days - the same window the
  // Kaioken theme watches - with a dot on each day a workout was finished.
  // Tapping unfolds the full month, navigable back through history (view
  // state only, never stored).
  let calOpen = false;
  let calOffset = 0; // displayed month relative to this month

  function workoutDays() {
    const days = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const k = isoKey(d);
      days[k] = (days[k] || 0) + 1;
    });
    return days;
  }

  function weekStripHTML(days) {
    const now = new Date();
    const cells = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const k = isoKey(d);
      cells.push(
        '<div class="cal-cell' + (i === 0 ? ' today' : '') + (days[k] ? ' has' : '') + '">' +
        '<div class="cal-wd">' + esc(d.toLocaleDateString(undefined, { weekday: 'narrow' })) + '</div>' +
        '<div class="cal-num">' + d.getDate() + '</div>' +
        '<div class="cal-dot"></div>' +
        '</div>'
      );
    }
    return '<div class="cal-strip">' + cells.join('') + '</div>';
  }

  function monthGridHTML(days) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth() + calOffset, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
    const dim = new Date(y, m + 1, 0).getDate();
    const wdRow = [];
    for (let i = 0; i < 7; i++) {
      const wd = new Date(2024, 0, 1 + i); // 2024-01-01 was a Monday
      wdRow.push('<div>' + esc(wd.toLocaleDateString(undefined, { weekday: 'narrow' })) + '</div>');
    }
    const thisMonth = calOffset === 0;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-m-cell blank"></div>');
    for (let d = 1; d <= dim; d++) {
      const k = isoKey(new Date(y, m, d));
      cells.push('<div class="cal-m-cell' + (days[k] ? ' has' : '') +
        (thisMonth && d === now.getDate() ? ' today' : '') + '">' + d + '</div>');
    }
    return '<div class="cal-month">' +
      '<div class="cal-month-nav">' +
      '<button type="button" class="cal-nav-btn" id="cal-prev" aria-label="Previous month">' + I.chev + '</button>' +
      '<span class="cal-month-name">' +
      esc(base.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) +
      '</span>' +
      '<button type="button" class="cal-nav-btn" id="cal-next" aria-label="Next month"' +
      (thisMonth ? ' disabled' : '') + '>' + I.chev + '</button>' +
      '</div>' +
      '<div class="cal-wd-row">' + wdRow.join('') + '</div>' +
      '<div class="cal-month-grid">' + cells.join('') + '</div>' +
      '</div>';
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
        '<p class="hint">Hold any workout (or right-click it) to rename it, repeat it as new, or delete it.</p>';
    } else {
      historyHTML = '<div class="section-label">History</div>' +
        '<div class="empty">No finished workouts yet. Create one and hit the gym.</div>';
    }

    const calDays = workoutDays();
    const calHTML = '<div id="cal-toggle" class="card cal-card' + (calOpen ? ' open' : '') +
      '" tabindex="0" role="button" aria-expanded="' + (calOpen ? 'true' : 'false') +
      '" aria-label="Toggle workout calendar">' +
      weekStripHTML(calDays) +
      '<span class="cal-chev">' + I.chev + '</span>' +
      (calOpen ? monthGridHTML(calDays) : '') +
      '</div>';

    // Every home block is a hold-and-drag section: the calendar, the pinned
    // chart, the new-routine button, the active/scheduled lists and the
    // history block; the order persists in the settings store.
    const secs = {
      cal: calHTML,
      goals: goalsHTML(),
      chart: settings.homeChart ? homeChartHTML() : '',
      new: '<button class="btn btn-primary btn-block btn-new" id="act-new">' + I.plus + '<span>New Routine</span></button>' +
        '<button class="btn btn-ghost btn-block btn-new-prog" id="act-new-program" type="button">' + I.plus + '<span>New Program</span></button>',
      programs: programsHTML(),
      active: sectionHTML('Active', active.map((r) => itemHTML(r, today)), ''),
      scheduled: sectionHTML('Scheduled', scheduled.map((r) => itemHTML(r, today)), ''),
      history: historyHTML,
    };
    const order = homeOrderOrDefault().filter((id) => secs[id]);

    $app.innerHTML =
      '<header class="topbar"><h1>Kaioken</h1>' +
      (settings.theme === 'kaioken'
        ? '<span class="chip heat-chip">' + HEAT_LEVELS[computeHeat()].label + '</span>'
        : '') +
      '<button class="btn btn-icon" id="act-stats" aria-label="Volume charts">' + I.chart + '</button>' +
      '<button class="btn btn-icon" id="act-settings" aria-label="Settings">' + I.gear + '</button></header>' +
      installHint() +
      order.map((id) =>
        '<div class="home-sec" data-sec="' + id + '">' + secs[id] + '</div>').join('');

    const calEl = document.getElementById('cal-toggle');
    calEl.onclick = (ev) => {
      // the month area navigates; only the strip/chevron toggles the fold
      if (ev && ev.target && ev.target.closest && ev.target.closest('.cal-month')) return;
      calOpen = !calOpen;
      render();
    };
    calEl.onkeydown = (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if (ev && ev.target && ev.target.closest && ev.target.closest('.cal-month')) return;
      ev.preventDefault();
      calOpen = !calOpen;
      render();
    };
    const calPrev = document.getElementById('cal-prev');
    if (calPrev) calPrev.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      calOffset--;
      render();
    };
    const calNext = document.getElementById('cal-next');
    if (calNext) calNext.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      calOffset = Math.min(0, calOffset + 1);
      render();
    };
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
    $app.querySelectorAll('.item[data-id]').forEach((el) => {
      el.onclick = () => go('routine', { id: el.dataset.id });
    });
    // The long-press sheet (Rename / Repeat as New / Delete) is available
    // on every routine entry - history, active and scheduled alike.
    $app.querySelectorAll('.item[data-id]').forEach((el) => {
      const r = getRoutine(el.dataset.id);
      if (r) attachLongPress(el, () => openSheet(r));
    });
    // Program cards: tap to open, long-press for Rename / Duplicate /
    // Delete (#62).
    $app.querySelectorAll('.item[data-prog]').forEach((el) => {
      const p = getProgram(el.dataset.prog);
      if (!p) return;
      el.onclick = () => go('program', { id: p.id });
      attachLongPress(el, () => openProgramSheet(p));
    });
    const newProgBtn = document.getElementById('act-new-program');
    if (newProgBtn) newProgBtn.onclick = () => {
      openPromptSheet({
        title: 'New program',
        label: 'Name',
        okLabel: 'Create',
        onOk: (v) => {
          const nm = String(v || '').trim().slice(0, 60);
          if (!nm) return;
          const p = { id: uid(), name: nm, createdAt: Date.now(), routines: [] };
          programs.push(p);
          savePrograms();
          go('program', { id: p.id });
        },
      });
    };
    if (settings.homeChart) bindHomeChart();
    $app.querySelectorAll('.home-sec').forEach((sec) => {
      attachHoldDrag(sec, {
        siblings: '.home-sec',
        interactive: 'input, button, textarea, select, .sug, .sug-box, svg',
        onEnd: (els) => {
          settings.homeOrder = els.map((s) => s.dataset.sec).filter(Boolean);
          store.setSetting('homeOrder', settings.homeOrder)
            .catch((e) => console.error('Kaioken:', e));
        },
      });
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
      '<input id="in-name" placeholder="e.g. Push Day" maxlength="60" autocomplete="off" autocapitalize="words">' +
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
      if (!validDate(date)) date = todayISO();
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
  // An active routine replaces the date row with a compact sticky strip:
  // the elapsed clock plus the two actions that end the session. The date
  // is not editable mid-workout (the finished summary still shows it).
  function workoutStripHTML(r) {
    return '<div class="workout-strip">' +
      '<span class="timer" id="elapsed">' + fmtClock(monoNow() - r.startedAt) + '</span>' +
      '<button class="btn btn-strip btn-primary" id="act-finish" type="button">' + I.stop + '<span>Finish</span></button>' +
      '<button class="btn btn-strip btn-ghost" id="act-abandon" type="button">Abandon</button>' +
      '</div>';
  }

  function statusCardHTML(r) {
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
      '</b></div>' +
      '<div class="sum-row"><span>Creatine / protein</span><b>' +
      (r.supps === true ? 'yes' : r.supps === false ? 'no' : '\u2013') + '</b></div>' +
      '<div class="sum-row"><span>Body weight</span><b>' +
      (r.bodyWeight == null ? '\u2013' : r.bodyWeight + ' ' + esc(r.bwUnit || 'kg')) + '</b></div>' +
      '</div>';
  }

  // Cardio exercises (by catalog name) log time and distance per entry
  // instead of reps x weight. Derived from the name like the category, so
  // nothing extra is stored: rename to a cardio name and the rows switch.
  const isCardioEx = (ex) => gymlogCategoryOf(ex.name) === 'Cardio';

  // The unit is locked once any set has logged values: switching it would
  // retroactively re-label every logged number without converting it.
  function exUnitLocked(ex) {
    return ex.sets.some((s) =>
      isCardioEx(ex)
        ? (s.mins != null || s.dist != null)
        : (s.reps != null || s.weight != null));
  }

  // Personal record: a set whose estimated 1RM (Epley, normalized to kg)
  // beats every other set for that exercise name - your previous bests and
  // the other sets in this routine alike. Derived from the data, so nothing
  // is stored: the circle turns into a live flame the moment the typed
  // values would beat your record, and superseded sets lose it again.
  function epleyKg(ex, s) {
    if (s.reps == null || s.weight == null || s.reps <= 0 || s.weight <= 0) return 0;
    const w = s.weight * (ex.unit === 'lb' ? LB_TO_KG : 1);
    return w * (1 + s.reps / 30);
  }

  // Per-name best estimated 1RM cache, so keystrokes do not rescan the
  // full log: the entry keeps the best value with its set and the best
  // value over the other sets, which is all the excluded-set question
  // needs. Cleared on every render (structure changes) and dropped for one
  // name while that exercise's own values are being edited.
  const bestEpleyCache = new Map();

  function bestEpleyTop(name) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (!bestEpleyCache.has(key)) {
      let b1 = 0;
      let b2 = 0;
      let s1 = null;
      routines.forEach((r) => {
        // Personal records are performed work only (#37): typing planned
        // weights into a never-started (scheduled) routine used to raise
        // the baseline and strip the flame from real lifts, and a set is
        // only performed once it is marked done.
        if (r.status === 'scheduled') return;
        r.exercises.forEach((ex) => {
        if (String(ex.name || '').trim().toLowerCase() !== key) return;
        ex.sets.forEach((s) => {
          if (s.warmup) return;
          if (!s.done) return;
          const e = epleyKg(ex, s);
          if (e > b1) { b2 = b1; b1 = e; s1 = s; }
          // b2 is the best value strictly below the top: a set tying the
          // best must not promote the runner-up to the top value (#39),
          // or the tie strips the flame from every set including the
          // standing best.
          else if (e > b2 && e < b1 - 1e-9) { b2 = e; }
        });
        });
      });
      bestEpleyCache.set(key, { b1: b1, b2: b2, s1: s1 });
    }
    return bestEpleyCache.get(key);
  }

  function bestEpleyByName(name, excludeSet) {
    const top = bestEpleyTop(name);
    if (!top) return 0;
    return (excludeSet && excludeSet === top.s1) ? top.b2 : top.b1;
  }

  const isRecordSet = (ex, s) => {
    if (s.warmup) return false;
    const e = epleyKg(ex, s);
    if (e <= 0) return false;
    const top = bestEpleyTop(ex.name);
    if (!top || !top.b1) return false;
    // Ties at the top are records too (#39): repeating your best set
    // exactly used to extinguish the flame on every set, including the
    // standing best. A set is a record when it strictly beats the
    // standing best, or ties it while that top strictly beats everything
    // below it; the standing best itself is only ever compared against
    // the runner-up.
    if (s === top.s1) return e > top.b2 + 1e-9;
    if (e > top.b1 + 1e-9) return true;
    return Math.abs(e - top.b1) <= 1e-9 && top.b1 > top.b2 + 1e-9;
  };

  function workSetNumber(sets, idx) {
    if (sets[idx].warmup) return null;
    let n = 0;
    for (let i = 0; i <= idx; i++) if (!sets[i].warmup) n++;
    return n;
  }

  function fmtStat(value, unit) {
    if (value == null || value === 0) return '\u2013';
    let s;
    if (typeof value === 'number' && !Number.isInteger(value)) {
      s = value.toFixed(1).replace(/\.0$/, '');
    } else {
      s = String(value);
    }
    return unit ? s + ' ' + unit : s;
  }

  function exerciseStats(ex) {
    const complete = ex.sets.filter((s) =>
      !s.warmup && s.weight != null && s.reps != null && s.weight > 0 && s.reps > 0);
    const reps = complete.reduce((sum, s) => sum + (s.reps || 0), 0);
    const volume = complete.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
    const avg = reps > 0 ? volume / reps : 0;
    return { reps, volume, avg };
  }

  function exerciseStatsHTML(ex) {
    const { reps, volume, avg } = exerciseStats(ex);
    return '<div class="ex-stats">' +
      '<span>Volume <b>' + fmtStat(volume || null, ex.unit) + '</b></span>' +
      '<span>Reps <b>' + fmtStat(reps || null, '') + '</b></span>' +
      '<span>Avg <b>' + fmtStat(avg > 0 ? avg : null, ex.unit) + '</b></span>' +
      '</div>';
  }

  function exerciseCardHTML(ex, editable, active, movable) {
    const cardio = isCardioEx(ex);
    if (!editable) {
      const lines = ex.sets.map((s, j) => {
        const pr = isRecordSet(ex, s);
        const warmup = s.warmup === true;
        const workN = workSetNumber(ex.sets, j);
        const lead = (pr
          ? '<span class="done-check">' + I.flame + '</span>'
          : (s.done
            ? '<span class="done-check">' + I.check + '</span>'
            : (warmup
              ? '<span class="set-idx warm">' + I.thermo + '</span>'
              : '<span class="set-idx">' + workN + '</span>')));
        const body = cardio
          ? '<span>' + (s.mins == null ? '\u2013' : s.mins) + ' min</span>' +
            '<span class="mult">\u00b7</span>' +
            '<span>' + (s.dist == null ? '\u2013' : s.dist) + ' ' + esc(ex.dunit || 'km') + '</span>'
          : '<span>' + (s.weight == null ? '\u2013' : s.weight) + ' ' + esc(ex.unit) + '</span>' +
            '<span class="mult">\u00d7</span>' +
            '<span>' + (s.reps == null ? '\u2013' : s.reps) + ' reps</span>';
        return '<div class="set-line' + (s.done ? ' done' : '') + (pr ? ' pr' : '') + '">' + lead + body + '</div>';
      }).join('');
      return '<div class="card ex-card">' +
        '<div class="ex-title">' + esc(ex.name || 'Exercise') +
        '<span class="cat-tag">' + esc(gymlogCategoryOf(ex.name)) + '</span>' +
        '<span class="unit-tag">' + esc(cardio ? (ex.dunit || 'km') : ex.unit) + '</span></div>' +
        (lines || '<div class="empty-inline">No sets logged.</div>') +
        '</div>';
    }

    const rows = ex.sets.map((s, j) => {
      const pr = isRecordSet(ex, s);
      const warmup = s.warmup === true;
      const workN = workSetNumber(ex.sets, j);
      let check;
      if (active) {
        check = '<button class="set-check' + (s.done ? ' on' : '') + (pr ? ' pr' : '') + (warmup ? ' warm' : '') +
          '" type="button" aria-label="' +
          (warmup ? 'Warm-up set' : (s.done ? 'Mark set as not done' : 'Mark set as done')) + '">' +
          (pr ? I.flame : (s.done ? I.check : (warmup ? I.thermo : String(workN)))) + '</button>';
      } else {
        check = '<span class="set-check off' + (pr ? ' pr' : '') + (warmup ? ' warm' : '') + '">' +
          (pr ? I.flame : (s.done ? I.check : (warmup ? I.thermo : workN))) + '</span>';
      }
      const fields = cardio
        ? '<input class="in-mins" type="text" inputmode="decimal" autocomplete="off" placeholder="min" value="' + (s.mins == null ? '' : s.mins) + '">' +
          '<span class="unit-tag min-tag">min</span>' +
          '<input class="in-dist" type="text" inputmode="decimal" autocomplete="off" placeholder="dist" value="' + (s.dist == null ? '' : s.dist) + '">' +
          '<span class="unit-tag dunit-tag">' + esc(ex.dunit || 'km') + '</span>'
        : // iOS hides the decimal key for type="number" in many locales;
          // text + inputmode="decimal" always shows it.
          '<input class="in-weight" type="text" inputmode="decimal" autocomplete="off" placeholder="weight" value="' + (s.weight == null ? '' : s.weight) + '">' +
          '<span class="unit-tag">' + esc(ex.unit) + '</span>' +
          '<input class="in-reps" type="number" inputmode="numeric" min="0" step="1" placeholder="reps" value="' + (s.reps == null ? '' : s.reps) + '">' +
          '<span class="unit-tag reps-tag">reps</span>';
      return '<div class="set-row' + (cardio ? ' cardio' : '') + (s.done ? ' done' : '') + (pr ? ' pr' : '') + '" data-sid="' + esc(s.id) + '">' +
        check + fields +
        '<button class="btn btn-icon btn-del-set" type="button" aria-label="Remove set">' + I.x + '</button>' +
        '</div>';
    }).join('');

    const unitSeg = cardio
      ? '<div class="seg' + (exUnitLocked(ex) ? ' locked' : '') + '" role="group" aria-label="Distance unit">' +
        '<button type="button" class="' + (ex.dunit === 'mi' ? '' : 'on') + '" data-u="km">km</button>' +
        '<button type="button" class="' + (ex.dunit === 'mi' ? 'on' : '') + '" data-u="mi">mi</button>' +
        '</div>'
      : '<div class="seg' + (exUnitLocked(ex) ? ' locked' : '') + '" role="group" aria-label="Weight unit">' +
        '<button type="button" class="' + (ex.unit === 'kg' ? 'on' : '') + '" data-u="kg">kg</button>' +
        '<button type="button" class="' + (ex.unit === 'lb' ? 'on' : '') + '" data-u="lb">lb</button>' +
        '</div>';

    const doneN = ex.sets.reduce((n, s) => n + (s.done ? 1 : 0), 0);
    const folded = active && activeOpenEx !== ex.id;
    const meta = active
      ? doneN + '/' + ex.sets.length + (ex.sets.length === 1 ? ' set' : ' sets')
      : ex.sets.length + (ex.sets.length === 1 ? ' set' : ' sets');

    // Secondary actions live in the controls row, not beside the name: the
    // head is reserved for the name so a long catalog entry stays readable.
    // During a workout the delete x joins them too, leaving [fold][name].
    const moveBtns = movable
      ? '<button class="btn btn-icon btn-move btn-move-up" type="button" aria-label="Move exercise up">' + I.up + '</button>' +
        '<button class="btn btn-icon btn-move btn-move-down" type="button" aria-label="Move exercise down">' + I.down + '</button>'
      : '';
    const delBtn = '<button class="btn btn-icon btn-del-ex" type="button" aria-label="Remove exercise">' + I.x + '</button>';

    return '<div class="card ex-card' + (folded ? ' folded' : '') + '" data-eid="' + esc(ex.id) + '" data-cardio="' + (cardio ? '1' : '') + '">' +
      '<div class="ex-head">' +
      (active
        ? '<button class="btn btn-icon btn-fold" type="button" aria-label="' +
          (folded ? 'Unfold exercise' : 'Fold exercise') + '">' + I.chev + '</button>'
        : '') +
      '<input class="ex-name" placeholder="Exercise name" value="' + esc(ex.name) + '" maxlength="48" autocomplete="off" autocapitalize="words">' +
      (active ? '' : delBtn) +
      '</div>' +
      '<div class="sug-box" hidden></div>' +
      '<div class="ex-controls">' +
      '<button class="btn btn-ghost btn-warmup" type="button" aria-label="Add warm-up set">' + I.plus + '<span>Warm up</span></button>' +
      unitSeg +
      moveBtns +
      (active ? delBtn : '') +
      '<span class="ex-meta">' +
      '<span class="cat-tag">' + esc(gymlogCategoryOf(ex.name)) + '</span>' +
      '<span class="muted-small">' + meta + '</span>' +
      '</span>' +
      '</div>' +
      rows +
      (cardio ? '' : exerciseStatsHTML(ex)) +
      '<button class="btn btn-icon btn-add-set" type="button" aria-label="Add set">' + I.plus + '</button>' +
      '</div>';
  }
  // Mark a set done / not done. Tapping a row toggles too, except on the
  // inputs and the delete button. Marking a set done that beats your best
  // estimated 1RM for that exercise toasts a new personal record; finishing
  // an exercise's last set folds it and unfolds the next one.
  function toggleSet(r, ex, set) {
    set.done = !set.done;
    scheduleSave(r, true);
    if (set.done && r.status === 'active') {
      if (!ex.sets.some((s) => !s.done)) {
        const next = r.exercises.find((x) => x.sets.some((s) => !s.done));
        if (next) activeOpenEx = next.id;
      }
    }
    render();
    if (set.done && r.status === 'active' && !set.warmup) {
      const e = epleyKg(ex, set);
      if (e > 0 && e > bestEpleyByName(ex.name, set) + 1e-9) {
        toast('New PR: ' + set.weight + ' ' + ex.unit + ' × ' + set.reps);
      }
      const anyLeft = r.exercises.some((x) => x.sets.some((s) => !s.done));
      if (anyLeft) startRest();
    }
  }

  // Hold-and-drag reorder, shared by exercise cards and home sections:
  // press-and-hold (~0.5s, same gesture as the history long-press), then
  // drag - a ghost follows the finger while the hidden original marks the
  // drop slot. Release to drop; onEnd receives the final DOM order to
  // persist. Presses that start on interactive elements never begin a drag,
  // and a real move before the hold fires cancels it, so scrolling and
  // editing still work.
  let exDragActive = false;

  function attachHoldDrag(el, opts) {
    const HOLD_MS = 500;
    const DRIFT_SQ = 144; // 12px, same tolerance as the long-press sheet
    let holdTimer = null;
    let dragging = false;
    let pid = -1;
    let sx = 0;
    let sy = 0;
    let grabDY = 0;
    let ghost = null;

    const stopHold = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };

    const startDrag = (e) => {
      dragging = true;
      exDragActive = true;
      document.body.classList.add('ex-dragging');
      const rect = el.getBoundingClientRect();
      grabDY = e.clientY - rect.top;
      // clone BEFORE the original gets drag-src, or the ghost inherits
      // its visibility:hidden and the lifted element turns invisible
      ghost = el.cloneNode(true);
      el.classList.add('drag-src');
      ghost.classList.add('drag-ghost');
      ghost.style.width = rect.width + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = (e.clientY - grabDY) + 'px';
      // cloned inputs carry attributes, not live values - copy them over
      const srcIns = el.querySelectorAll('input');
      const ghoIns = ghost.querySelectorAll('input');
      for (let i = 0; i < srcIns.length && i < ghoIns.length; i++) {
        ghoIns[i].value = srcIns[i].value;
      }
      document.body.appendChild(ghost);
      try { el.setPointerCapture(pid); } catch (err) {}
    };

    const moveDrag = (e) => {
      if (!ghost) return;
      ghost.style.top = (e.clientY - grabDY) + 'px';
      const others = [];
      $app.querySelectorAll(opts.siblings).forEach((c) => {
        if (c !== el) others.push(c);
      });
      let idx = 0;
      for (let i = 0; i < others.length; i++) {
        const rc = others[i].getBoundingClientRect();
        if (e.clientY > rc.top + rc.height / 2) idx = i + 1;
      }
      const parent = el.parentNode;
      if (idx < others.length) {
        if (el.nextSibling !== others[idx]) parent.insertBefore(el, others[idx]);
      } else {
        const last = others[others.length - 1];
        if (last && el.previousSibling !== last) parent.insertBefore(el, last.nextSibling);
      }
    };

    const endDrag = () => {
      dragging = false;
      exDragActive = false;
      document.body.classList.remove('ex-dragging');
      stopHold();
      docUnbind();
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('drag-src');
      try { el.releasePointerCapture(pid); } catch (err) {}
      opts.onEnd(Array.prototype.slice.call($app.querySelectorAll(opts.siblings)));
      // the release can emit a stray click (e.g. a set toggle) - eat it,
      // but only briefly so the next real tap still works
      const kill = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        cleanupKill();
      };
      const cleanupKill = () => {
        document.removeEventListener('click', kill, true);
        clearTimeout(killT);
      };
      const killT = setTimeout(cleanupKill, 400);
      document.addEventListener('click', kill, true);
      render();
    };

    // The move/up/cancel listeners live on the document, bound only while a
    // hold (or drag) is in flight, so releases outside the element are
    // caught and nothing lingers after a render.
    const docMove = (e) => {
      if (e.pointerId !== pid) return;
      if (dragging) { moveDrag(e); return; }
      if (holdTimer == null) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (dx * dx + dy * dy > DRIFT_SQ) stopHold();
    };
    const docUp = (e) => {
      if (e.pointerId !== pid) return;
      stopHold();
      docUnbind();
      if (dragging) endDrag();
    };
    const docTouch = (e) => {
      if (dragging) e.preventDefault();
    };
    const docBind = () => {
      docUnbind();
      document.addEventListener('pointermove', docMove);
      document.addEventListener('pointerup', docUp);
      document.addEventListener('pointercancel', docUp);
      document.addEventListener('touchmove', docTouch, { passive: false });
    };
    const docUnbind = () => {
      document.removeEventListener('pointermove', docMove);
      document.removeEventListener('pointerup', docUp);
      document.removeEventListener('pointercancel', docUp);
      document.removeEventListener('touchmove', docTouch);
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || exDragActive) return;
      if (e.target && e.target.closest && e.target.closest(opts.interactive)) return;
      stopHold();
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      holdTimer = setTimeout(() => {
        holdTimer = null;
        startDrag(e);
      }, HOLD_MS);
      docBind();
    });
    el.addEventListener('contextmenu', (e) => {
      if (dragging || holdTimer) {
        if (e.preventDefault) e.preventDefault();
      }
    });
  }

  // Reorder exercises within a routine: the order is rebuilt from the DOM
  // and saved with the routine.
  function attachExDrag(card, r) {
    attachHoldDrag(card, {
      siblings: '.ex-card[data-eid]',
      interactive: 'input, button, textarea, select, .sug, .sug-box',
      onEnd: (els) => {
        const order = els.map((c) => c.dataset.eid);
        r.exercises = order
          .map((id) => r.exercises.find((x) => x.id === id))
          .filter(Boolean);
        scheduleSave(r, true);
      },
    });
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
        dunit: ex.dunit,
        sets: ex.sets.map((s) => ({
          id: uid(),
          reps: s.reps,
          weight: s.weight,
          mins: s.mins,
          dist: s.dist,
          done: false,
          warmup: s.warmup === true,
        })),
      })),
    };
  }

  function renderRoutine() {
    const r = getRoutine(view.id);
    if (!r) { view = { name: 'home' }; return renderHome(); }
    const editable = r.status !== 'completed';
    const activeView = r.status === 'active';
    // (Re)set the fold state when entering the routine or when the workout
    // starts: all folded by default, the user unfolds what they perform.
    if (activeView) {
      const ctx = r.id + ':' + r.status;
      if (lastFoldCtx !== ctx) {
        lastFoldCtx = ctx;
        activeOpenEx = null;
      } else if (activeOpenEx && !r.exercises.some((e) => e.id === activeOpenEx)) {
        activeOpenEx = null;
      }
    }
    const exCards = r.exercises.map((ex) =>
      exerciseCardHTML(ex, editable, activeView, editable && r.exercises.length > 1)).join('');

    $app.innerHTML =
      '<header class="topbar">' +
      '<button class="btn btn-icon" id="act-back" aria-label="Back">' + I.back + '</button>' +
      '<h1 class="topbar-title">' + esc(r.name) + '</h1>' +
      '<button class="btn btn-icon" id="act-more" aria-label="More actions">' + I.dots + '</button>' +
      '<button class="btn btn-icon btn-danger" id="act-del" aria-label="Delete routine">' + I.trash + '</button>' +
      '</header>' +
      (r.status === 'scheduled'
        ? '<label class="field rdate"><span>Date</span><input type="date" id="in-rdate" value="' + esc(r.date) + '"></label>'
        : '') +
      (r.status === 'active' ? workoutStripHTML(r) : statusCardHTML(r)) +
      (r.status === 'completed' && shareableRoutine(r)
        ? '<button class="btn btn-primary btn-block" id="act-share" type="button">' + I.share +
          '<span>Share highlight</span></button>'
        : '') +
      '<div class="section-label">Exercises</div>' +
      (exCards || '<div class="empty">No exercises yet. Add your first one below.</div>') +
      (editable ? '<button class="btn btn-ghost btn-block" id="act-add-ex" type="button">+ Add Exercise</button>' : '') +
      (editable && r.exercises.length > 1
        ? '<p class="hint">Hold an exercise and drag to put your exercises in order. Names come from the built-in catalog - type to search and tap a suggestion.</p>'
        : '') +
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
    }
    // Finish / Abandon live in the sticky top strip while a workout runs, so
    // an active routine has no bottom bar (and no large reserved padding).
    if (barHTML) {
      const bar = document.createElement('div');
      bar.id = 'actionbar';
      bar.innerHTML = barHTML;
      document.body.appendChild(bar);
      document.body.classList.add('has-bar');
      if (twoButtonBar) document.body.classList.add('has-bar2');
    }

    document.getElementById('act-back').onclick = () => go('home');
    document.getElementById('act-more').onclick = () => openSheet(r);
    const shareAct = document.getElementById('act-share');
    if (shareAct) shareAct.onclick = () => shareHighlight(r);
    const rdateEl = document.getElementById('in-rdate');
    if (rdateEl) {
      rdateEl.onchange = () => {
        const v = rdateEl.value;
        if (!validDate(v)) { toast('Pick a valid date'); render(); return; }
        if (v === r.date) return;
        r.date = v;
        scheduleSave(r, true);
        render();
      };
    }
    document.getElementById('act-del').onclick = () => {
      openConfirmSheet({
        title: 'Delete routine',
        message: 'Delete this routine? This cannot be undone.',
        confirmLabel: 'Delete',
        onConfirm: () => {
          stopRest();
          cancelPendingSave(r.id);
          store.del(r.id).catch((e) => console.error(e));
          routines = routines.filter((x) => x.id !== r.id);
          stopTimer();
          go('home');
        },
      });
    };

    const saveBtn = document.getElementById('act-save');
    if (saveBtn) saveBtn.onclick = () => {
      scheduleSave(r, true);
      toast('Routine saved for ' + fmtDate(r.date));
      go('home');
    };

    const startBtn = document.getElementById('act-start');
    if (startBtn) startBtn.onclick = () => {
      // Multiple concurrent actives are allowed but warned about: the
      // stale one keeps ticking and records an absurd duration.
      const other = routines.find((x) => x.id !== r.id && x.status === 'active');
      if (other) {
        openConfirmSheet({
          title: 'Another workout is active',
          message: '"' + other.name + '" is still active and keeps its timer. Start this one too?',
          confirmLabel: 'Start anyway',
          danger: false,
          onConfirm: () => {
            r.status = 'active';
            r.startedAt = monoNow();
            scheduleSave(r, true);
            render();
          },
        });
        return;
      }
      r.status = 'active';
      r.startedAt = monoNow();
      scheduleSave(r, true);
      render();
    };

    const abandonBtn = document.getElementById('act-abandon');
    if (abandonBtn) abandonBtn.onclick = () => {
      openConfirmSheet({
        title: 'Abandon workout',
        message: 'Stop tracking and put "' + r.name + '" back as scheduled? Nothing is logged as done.',
        confirmLabel: 'Abandon',
        onConfirm: () => {
          stopRest();
          cancelPendingSave(r.id);
          r.status = 'scheduled';
          r.startedAt = null;
          r.endedAt = null;
          r.exercises.forEach((ex) => ex.sets.forEach((s) => { s.done = false; }));
          bestEpleyCache.clear();
          scheduleSave(r, true);
          stopTimer();
          render();
        },
      });
    };

    const finBtn = document.getElementById('act-finish');
    if (finBtn) finBtn.onclick = () => {
      stopRest();
      openFinishSheet(r);
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
      if (editable && r.exercises.length > 1) attachExDrag(card, r);

      // Keyboard path for reordering: small up/down buttons next to the
      // delete x, disabled at the top/bottom.
      const upBtn = card.querySelector('.btn-move-up');
      const downBtn = card.querySelector('.btn-move-down');
      const exIdx = r.exercises.findIndex((e) => e.id === ex.id);
      if (upBtn) {
        upBtn.disabled = exIdx <= 0;
        upBtn.onclick = () => {
          if (exIdx <= 0) return;
          r.exercises.splice(exIdx, 1);
          r.exercises.splice(exIdx - 1, 0, ex);
          scheduleSave(r, true);
          render();
        };
      }
      if (downBtn) {
        downBtn.disabled = exIdx >= r.exercises.length - 1;
        downBtn.onclick = () => {
          if (exIdx >= r.exercises.length - 1) return;
          r.exercises.splice(exIdx, 1);
          r.exercises.splice(exIdx + 1, 0, ex);
          scheduleSave(r, true);
          render();
        };
      }

      const foldBtn = card.querySelector('.btn-fold');
      if (foldBtn) foldBtn.onclick = () => {
        activeOpenEx = (activeOpenEx === ex.id) ? null : ex.id;
        render();
      };

      const nameIn = card.querySelector('.ex-name');
      bindAutocomplete(nameIn, card.querySelector('.sug-box'), GYMLOG_EX_NAMES, (nm) => {
        ex.name = nm;
        nameIn.value = nm;
        const tag = card.querySelector('.cat-tag');
        if (tag) tag.textContent = gymlogCategoryOf(nm);
        scheduleSave(r, true);
        // picking a cardio name must swap the row layout, not just the tag
        if ((gymlogCategoryOf(nm) === 'Cardio') !== (card.dataset.cardio === '1')) render();
      });
      nameIn.addEventListener('input', () => {
        const canon = catalogNameOf(nameIn.value);
        if (canon) {
          ex.name = canon;
          nameIn.value = canon;
        }
        const tag = card.querySelector('.cat-tag');
        if (tag) tag.textContent = gymlogCategoryOf(ex.name);
        scheduleSave(r);
      });
      nameIn.addEventListener('blur', () => {
        // delayed so a tap on an autocomplete suggestion lands first
        setTimeout(() => {
          const t = nameIn.value.trim();
          const canon = catalogNameOf(t);
          if (canon) {
            ex.name = canon;
            nameIn.value = canon;
          } else if (t !== ex.name) {
            nameIn.value = ex.name;
            if (t) toast('Pick an exercise from the list');
          }
          if (isCardioEx(ex) !== (card.dataset.cardio === '1')) render();
        }, 150);
      });

      card.querySelectorAll('.seg button').forEach((b) => {
        b.onclick = () => {
          const cardioNow = isCardioEx(ex);
          const cur = cardioNow ? (ex.dunit || 'km') : ex.unit;
          if (cur === b.dataset.u) return;
          if (exUnitLocked(ex)) {
            toast('Unit is locked once sets are logged');
            return;
          }
          if (cardioNow) ex.dunit = b.dataset.u;
          else {
            ex.unit = b.dataset.u;
            // the unit changes every epley value for this name - rescan it
            bestEpleyCache.delete(String(ex.name || '').trim().toLowerCase());
          }
          card.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
          if (cardioNow) {
            card.querySelectorAll('.dunit-tag').forEach((t) => (t.textContent = ex.dunit));
          } else {
            card.querySelectorAll('.unit-tag').forEach((t) => (t.textContent = ex.unit));
          }
          scheduleSave(r, true);
        };
      });

      // Live PR indicator: re-evaluate every row of the card when one set's
      // values change, so a would-be-record circle turns into a flame while
      // typing - and loses it again as soon as it no longer beats the rest.
      const applyCardPR = () => {
        if (isCardioEx(ex)) return;
        // only this exercise's values changed - rescan just its name
        bestEpleyCache.delete(String(ex.name || '').trim().toLowerCase());
        const rows = Array.prototype.slice.call(card.querySelectorAll('.set-row'));
        rows.forEach((rw) => {
          const idx = rows.indexOf(rw);
          const st = ex.sets.find((x) => x.id === rw.dataset.sid);
          if (!st) return;
          const pr = isRecordSet(ex, st);
          const chk = rw.querySelector('.set-check');
          if (chk) {
            chk.classList.toggle('pr', pr);
            if (pr) chk.innerHTML = I.flame;
            else if (st.done) chk.innerHTML = I.check;
            else if (st.warmup) chk.innerHTML = I.thermo;
            else chk.innerHTML = String(workSetNumber(ex.sets, idx));
          }
          rw.classList.toggle('pr', pr);
        });
      };

      const updateExStats = () => {
        if (isCardioEx(ex)) return;
        const line = card.querySelector('.ex-stats');
        if (!line) return;
        const { reps, volume, avg } = exerciseStats(ex);
        const vals = line.querySelectorAll('b');
        if (vals.length === 3) {
          vals[0].textContent = fmtStat(volume || null, ex.unit);
          vals[1].textContent = fmtStat(reps || null, '');
          vals[2].textContent = fmtStat(avg > 0 ? avg : null, ex.unit);
        }
      };

      card.querySelectorAll('.set-row').forEach((row) => {
        const set = ex.sets.find((s) => s.id === row.dataset.sid);
        if (!set) return;
        if (isCardioEx(ex)) {
          const minsIn = row.querySelector('.in-mins');
          const distIn = row.querySelector('.in-dist');
          minsIn.addEventListener('input', () => {
            set.mins = numOrNull(minsIn.value);
            scheduleSave(r);
          });
          minsIn.addEventListener('blur', () => {
            const n = numOrNull(minsIn.value);
            minsIn.value = n == null ? '' : String(n);
          });
          distIn.addEventListener('input', () => {
            set.dist = numOrNull(distIn.value);
            scheduleSave(r);
          });
          distIn.addEventListener('blur', () => {
            const n = numOrNull(distIn.value);
            distIn.value = n == null ? '' : String(n);
          });
        } else {
          const repsIn = row.querySelector('.in-reps');
          const wtIn = row.querySelector('.in-weight');
          repsIn.addEventListener('input', () => {
            set.reps = numOrNull(repsIn.value);
            scheduleSave(r);
            applyCardPR();
            updateExStats();
          });
          wtIn.addEventListener('input', () => {
            set.weight = numOrNull(wtIn.value);
            scheduleSave(r);
            applyCardPR();
            updateExStats();
          });
          wtIn.addEventListener('blur', () => {
            const n = numOrNull(wtIn.value);
            wtIn.value = n == null ? '' : String(n);
          });
        }
        row.querySelector('.btn-del-set').onclick = () => {
          ex.sets = ex.sets.filter((s) => s.id !== set.id);
          scheduleSave(r, true);
          render();
        };
        if (activeView) {
          const checkBtn = row.querySelector('.set-check');
          if (checkBtn) checkBtn.onclick = (e) => {
            if (e && e.stopPropagation) e.stopPropagation();
            toggleSet(r, ex, set);
          };
          row.onclick = (e) => {
            if (e && e.target && e.target.closest && (
              e.target.closest('input') ||
              e.target.closest('.btn-del-set') ||
              e.target.closest('.set-check')
            )) return;
            toggleSet(r, ex, set);
          };
        }
      });
      updateExStats();

      card.querySelector('.btn-del-ex').onclick = () => {
        if (!ex.sets.length) {
          r.exercises = r.exercises.filter((e) => e.id !== ex.id);
          scheduleSave(r, true);
          render();
          return;
        }
        openConfirmSheet({
          title: 'Remove exercise',
          message: 'Remove "' + (ex.name || 'this exercise') + '" and its sets? This cannot be undone.',
          confirmLabel: 'Remove',
          onConfirm: () => {
            r.exercises = r.exercises.filter((e) => e.id !== ex.id);
            scheduleSave(r, true);
            render();
          },
        });
      };

      card.querySelector('.btn-add-set').onclick = () => {
        const last = ex.sets[ex.sets.length - 1];
        const next = { id: uid(), done: false };
        if (isCardioEx(ex)) {
          next.mins = last ? last.mins : null;
          next.dist = last ? last.dist : null;
        } else {
          next.reps = last ? last.reps : null;
          next.weight = last ? last.weight : null;
        }
        ex.sets.push(next);
        scheduleSave(r, true);
        render();
      };

      const warmupBtn = card.querySelector('.btn-warmup');
      if (warmupBtn) warmupBtn.onclick = () => {
        let lastWarm = -1;
        ex.sets.forEach((s, i) => { if (s.warmup) lastWarm = i; });
        const last = lastWarm >= 0 ? ex.sets[lastWarm] : null;
        const next = { id: uid(), done: false, warmup: true };
        if (isCardioEx(ex)) {
          next.mins = last ? last.mins : null;
          next.dist = last ? last.dist : null;
        } else {
          next.reps = last ? last.reps : null;
          next.weight = last ? last.weight : null;
        }
        ex.sets.splice(lastWarm + 1, 0, next);
        scheduleSave(r, true);
        render();
      };
    });

    if (r.status === 'active') {
      timerInt = setInterval(() => {
        const el = document.getElementById('elapsed');
        if (!el) { stopTimer(); return; }
        el.textContent = fmtClock(monoNow() - r.startedAt);
      }, 500);
    }
  }

  /* ---------- stats ---------- */
  const LB_TO_KG = 0.45359237;
  let statsTab = 'progression'; // progression | heatmap | volume
  let statsSelKey = null;      // volume tab: selected week/month key
  let statsExSel = null;       // progression tab: selected exercise name
  let statsPointSel = null;    // progression tab: selected point index
  let statsCellSel = null;     // heatmap tab: { cat, key }
  let statsRange = '1m';       // 1w | 2w | 3w | 1m | 3m | 6m | 1y | all
  let statsExType = 'line';         // progression: line | bar
  let statsExMode = 'continuous';   // progression line: discrete | continuous
  let statsVolType = 'line';        // volume: bar | line
  let statsVolMode = 'continuous';   // volume line: discrete | continuous
  let statsMusView = 'radar';       // muscles: heat | radar

  const STATS_RANGES = [
    { id: '1w', label: 'Last week' },
    { id: '2w', label: 'Last 2 weeks' },
    { id: '3w', label: 'Last 3 weeks' },
    { id: '1m', label: 'Last month' },
    { id: '3m', label: 'Last 3 months' },
    { id: '6m', label: 'Last 6 months' },
    { id: '1y', label: 'Last year' },
    { id: 'all', label: 'All time' },
  ];
  const EX_TYPES = [{ id: 'line', label: 'Line' }, { id: 'bar', label: 'Bar' }];
  const VOL_TYPES = [{ id: 'bar', label: 'Bar' }, { id: 'line', label: 'Line' }];
  const PLOT_MODES = [{ id: 'discrete', label: 'Discrete' }, { id: 'continuous', label: 'Continuous' }];
  const MUS_VIEWS = [{ id: 'heat', label: 'Heat' }, { id: 'radar', label: 'Radar' }];

  // Switching the range invalidates selections keyed to the old buckets.
  function setStatsRange(v) {
    if (statsRange === v) return;
    statsRange = v;
    statsSelKey = null;
    statsPointSel = null;
    statsCellSel = null;
  }

  // One compact options button per graph card - the overflow-menu pattern
  // recommended for space-constrained chart toolbars.
  function chartOptsBtn(id) {
    return '<button class="btn btn-icon chart-opts" id="' + id + '" type="button" aria-label="Chart options">' +
      I.chart + '</button>';
  }

  function rangeOptsGroup(range) {
    return {
      label: 'Range',
      items: STATS_RANGES.map((o) => ({ key: 'range:' + o.id, label: o.label, on: range === o.id })),
    };
  }

  // Bottom sheet of grouped choices with a check on the active option,
  // following the app's long-press action sheet pattern.
  function openOptsSheet(title, groups, apply) {
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
      '<div class="sheet-title">' + esc(title) + '</div>' +
      groups.map((g) =>
        '<div class="opts-head">' + esc(g.label) + '</div>' +
        g.items.map((it) =>
          '<button class="btn btn-block opts-item' + (it.on ? ' on' : '') + '" type="button" data-k="' +
          esc(it.key) + '">' +
          '<span class="opts-check">' + (it.on ? I.check : '') + '</span>' +
          '<span>' + esc(it.label) + '</span></button>'
        ).join('')
      ).join('') +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Cancel</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    sheet.querySelectorAll('.opts-item').forEach((b) => {
      b.onclick = guard(() => {
        closeSheet();
        apply(b.dataset.k);
      });
    });
  }

  function bindChartOpts(btnId, title, groups, apply) {
    const btn = document.getElementById(btnId);
    if (btn) btn.onclick = () => openOptsSheet(title, groups(), apply);
  }

  // Inclusive start date of the selected range; null means all time.
  function rangeStart(range) {
    if (range === 'all') return null;
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === '1w') d.setDate(d.getDate() - 7);
    else if (range === '2w') d.setDate(d.getDate() - 14);
    else if (range === '3w') d.setDate(d.getDate() - 21);
    else if (range === '1m') d.setMonth(d.getMonth() - 1);
    else if (range === '3m') d.setMonth(d.getMonth() - 3);
    else if (range === '6m') d.setMonth(d.getMonth() - 6);
    else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
    else d.setMonth(d.getMonth() - 3);
    return d;
  }

  // Column buckets for the volume chart and the heatmap: weeks for the
  // shorter ranges, months for the longer ones so the bars stay readable.
  function rangeBuckets(range) {
    const monthly = range === '6m' || range === '1y' || range === 'all';
    const now = new Date();
    const nowB = monthly
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : weekStart(now);
    let firstB;
    if (range === 'all') {
      const rs = completedRoutines();
      const d = rs.length ? routineDate(rs[0]) : nowB;
      firstB = monthly
        ? new Date(d.getFullYear(), d.getMonth(), 1)
        : weekStart(d);
    } else {
      const s = rangeStart(range);
      firstB = monthly
        ? new Date(s.getFullYear(), s.getMonth(), 1)
        : weekStart(s);
    }
    if (firstB > nowB) firstB = nowB;
    const buckets = [];
    const cur = new Date(firstB.getFullYear(), firstB.getMonth(), firstB.getDate());
    while (cur <= nowB) {
      buckets.push({ key: isoKey(cur), start: new Date(cur) });
      if (monthly) cur.setMonth(cur.getMonth() + 1);
      else cur.setDate(cur.getDate() + 7);
    }
    return { monthly: monthly, buckets: buckets };
  }

  // Key of the bucket (week or month) that contains date d.
  function bucketKeyFor(monthly, d) {
    return isoKey(monthly
      ? new Date(d.getFullYear(), d.getMonth(), 1)
      : weekStart(d));
  }

  // Start of the range immediately before the selected one, so the radar
  // can overlay a comparison; null for all time (nothing to compare to).
  function prevRangeStart(range, start) {
    if (range === 'all' || !start) return null;
    const d = new Date(start);
    if (range === '1w') d.setDate(d.getDate() - 7);
    else if (range === '2w') d.setDate(d.getDate() - 14);
    else if (range === '3w') d.setDate(d.getDate() - 21);
    else if (range === '1m') d.setMonth(d.getMonth() - 1);
    else if (range === '3m') d.setMonth(d.getMonth() - 3);
    else if (range === '6m') d.setMonth(d.getMonth() - 6);
    else if (range === '1y') d.setFullYear(d.getFullYear() - 1);
    else d.setMonth(d.getMonth() - 3);
    return d;
  }

  // Human label of a range id, for radar legends and hints.
  function rangeWord(range) {
    if (range === '1w') return 'week';
    if (range === '2w') return '2 weeks';
    if (range === '3w') return '3 weeks';
    if (range === '1m') return 'month';
    if (range === '6m') return '6 months';
    if (range === '1y') return 'year';
    if (range === 'all') return 'period';
    return '3 months';
  }

  // Total volume per muscle category in [from, to); null bound = unbounded.
  function volumeByCat(from, to) {
    const totals = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const t = d.getTime();
      if (from && t < from.getTime()) return;
      if (to && t >= to.getTime()) return;
      r.exercises.forEach((ex) => {
        const cat = gymlogCategoryOf(ex.name);
        ex.sets.forEach((s) => {
          const v = setVolumeKg(ex, s);
          if (v > 0) totals[cat] = (totals[cat] || 0) + v;
        });
      });
    });
    return totals;
  }

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

  // Round tick values for a chart axis (#66): a 1/2/5 x 10^n step that
  // covers [min, max] in roughly `count` intervals. Charts re-scale their
  // data against the returned lo/hi so points, bars and gridlines all
  // line up on the ticks. `floor` clamps the lower bound (volume axes
  // never dip below zero).
  function niceTicks(min, max, count, floor) {
    if (!isFinite(min) || !isFinite(max) || min === max) {
      const pad = Math.max(Math.abs(min || 0) * 0.1, 1);
      min = (min || 0) - pad;
      max = (max || 0) + pad;
    }
    const raw = (max - min) / Math.max(1, count - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    let lo = Math.floor(min / step + 1e-9) * step;
    if (floor != null && lo < floor) lo = floor;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-9; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return { lo: lo, hi: hi, step: step, ticks: ticks };
  }

  // Y axis markup shared by the SVG charts (#66): gridlines at every
  // tick, tick labels in the left gutter and the axis line itself. The
  // top tick carries the unit.
  function svgYAxis(ax, padX, top, base, W, y, fmt, unit) {
    const parts = ax.ticks.map((t, i) => {
      const yy = y(t).toFixed(1);
      return '<line class="ygrid" x1="' + padX + '" y1="' + yy + '" x2="' + (W - 6) +
        '" y2="' + yy + '"/>' +
        '<text class="axis ytick" x="' + (padX - 5) + '" y="' + (y(t) + 3.5).toFixed(1) +
        '" text-anchor="end">' + fmt(t) + (i === ax.ticks.length - 1 && unit ? ' ' + esc(unit) : '') + '</text>';
    }).join('');
    return parts +
      '<line class="yaxis-line" x1="' + padX + '" y1="' + top + '" x2="' + padX + '" y2="' + base + '"/>';
  }

  // One canonical workout date: r.date - the day the workout was scheduled
  // or performed (stamped with the finish day when a workout ends). endedAt
  // carries the duration, never the day, so display, the calendar, the
  // heatmap and the charts all agree.
  function routineDate(r) {
    const p = String(r.date || '').split('-').map(Number);
    if (p.length === 3 && p[0]) return new Date(p[0], p[1] - 1, p[2]);
    if (r.endedAt) return new Date(r.endedAt);
    return null;
  }

  function completedRoutines() {
    return routines.filter((r) => r.status === 'completed')
      .sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  }

  // Warm-up sets build no volume stats (same rule as the per-exercise live
  // stats and the progression chart) - setVolumeKg is the single choke point
  // behind the radar, the heatmap, the Volume tab and the home pin.
  function setVolumeKg(ex, s) {
    if (s.warmup) return 0;
    if (s.reps == null || s.weight == null) return 0;
    return s.reps * s.weight * (ex.unit === 'lb' ? LB_TO_KG : 1);
  }

  // All exercises with at least one valid working set in completed
  // routines, grouped by lowercase name with their top set (heaviest
  // weight, warm-ups excluded, normalized to kg) per session.
  function progressionData() {
    const byName = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      r.exercises.forEach((ex) => {
        const nm = String(ex.name || '').trim();
        if (!nm) return;
        const key = nm.toLowerCase();
        const g = byName[key] = byName[key] || { name: nm, sessions: [] };
        g.name = nm;
        let best = null;
        ex.sets.forEach((s) => {
          if (s.warmup) return;
          if (s.reps == null || s.weight == null || s.reps <= 0 || s.weight <= 0) return;
          const wkg = s.weight * (ex.unit === 'lb' ? LB_TO_KG : 1);
          if (!best || wkg > best.wkg) {
            best = { reps: s.reps, weight: s.weight, unit: ex.unit, wkg: wkg, rdate: r.date, ts: d ? d.getTime() : 0 };
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
    if (statsTab === 'heatmap') body = statsMusclesHTML();
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
    if (statsTab === 'heatmap') bindMuscles();
    else if (statsTab === 'volume') bindVolume();
    else bindProgression();
  }

  /* ---- progression tab ---- */

  function statsProgressionHTML() {
    const byName = progressionData();
    // Cardio exercises log minutes and distance instead of weight, so they
    // have no top set to plot: only exercises with at least one valid
    // working set are listed.
    const names = Object.keys(byName)
      .filter((k) => byName[k].sessions.length)
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      return '<div class="card"><div class="empty">' +
        (Object.keys(byName).length
          ? 'No weight exercises in your history yet.'
          : 'No completed workouts yet.') +
        '</div></div>';
    }
    const selKey = String(statsExSel || '').toLowerCase();
    if (!selKey || !byName[selKey] || !byName[selKey].sessions.length) {
      statsExSel = byName[names[0]].name;
    }
    const g = byName[String(statsExSel).toLowerCase()];
    const start = rangeStart(statsRange);
    const sessions = start
      ? g.sessions.filter((s) => s.ts >= start.getTime())
      : g.sessions;

    const options = names.map((n) => {
      const d = byName[n];
      return '<option value="' + esc(d.name) + '"' + (d === g ? ' selected' : '') + '>' +
        esc(d.name) + '</option>';
    }).join('');

    if (!sessions.length) {
      return '<div class="card">' +
        '<div class="ex-opts-row">' +
        '<select id="sel-ex" class="sel-ex">' + options + '</select>' +
        chartOptsBtn('btn-ex-opts') +
        '</div>' +
        '<div class="empty">No sessions in this range.</div>' +
        '</div>';
    }
    if (statsPointSel == null || statsPointSel < 0 || statsPointSel >= sessions.length) {
      statsPointSel = sessions.length - 1;
    }

    return '<div class="card">' +
      '<div class="ex-opts-row">' +
      '<select id="sel-ex" class="sel-ex">' + options + '</select>' +
      chartOptsBtn('btn-ex-opts') +
      '</div>' +
      progressionChartBody(sessions, statsExType, statsExMode, statsPointSel) +
      '</div>' +
      '<p class="hint">Heaviest working-set weight per session (warm-ups excluded), spaced by date. Tap a point or bar to see that session\u2019s top set. Shown in the unit of your latest entry; pounds are converted for display only.</p>';
  }

  // Progression chart + detail line for one exercise's sessions, shared by
  // the stats tab and the home pin; selIdx is the highlighted session.
  function progressionChartBody(sessions, type, mode, selIdx) {
    const unit = sessions[sessions.length - 1].unit;
    const disps = sessions.map((s) => (unit === 'kg' ? s.wkg : s.wkg / LB_TO_KG));
    if (selIdx == null || selIdx < 0 || selIdx >= sessions.length) {
      selIdx = sessions.length - 1;
    }
    const sel = sessions[selIdx];
    return progressionSVG(sessions, disps, unit, type, mode, selIdx) +
      '<div class="cell-detail">Top set <b>' + fmt1(disps[selIdx]) + ' ' + esc(unit) + '</b>' +
      ' \u00b7 ' + sel.reps + ' reps \u00b7 ' + esc(fmtDay(sel.rdate)) + '</div>';
  }

  function progressionSVG(sessions, disps, unit, type, mode, selIdx) {
    const W = 320, H = 150, padX = 42, top = 26, bot = 24;
    const n = sessions.length;
    const t0 = sessions[0].ts;
    const t1 = sessions[n - 1].ts;
    const xs = sessions.map((s) =>
      (n === 1 || t1 <= t0) ? (W + padX) / 2 : padX + (W - 2 * padX) * ((s.ts - t0) / (t1 - t0)));
    const ax = niceTicks(Math.min.apply(null, disps), Math.max.apply(null, disps), 3);
    const lo = ax.lo;
    const hi = ax.hi;
    const y = (v) => top + (H - top - bot) * (1 - (v - lo) / (hi - lo));
    const pts = sessions.map((s, i) => xs[i].toFixed(1) + ',' + y(disps[i]).toFixed(1));
    const base = (H - bot).toFixed(1);
    const dots = sessions.map((s, i) =>
      '<circle class="pt" data-i="' + i + '" cx="' + xs[i].toFixed(1) + '" cy="' + y(disps[i]).toFixed(1) +
      '" r="' + (i === n - 1 ? 4 : 3) + '" fill="' + (i === selIdx ? 'var(--text)' : 'var(--accent)') + '"/>'
    ).join('');
    let minGap = Infinity;
    for (let i = 1; i < n; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
    const bw = n > 1 ? Math.max(4, Math.min(24, minGap * 0.6)) : 24;
    const bars = sessions.map((s, i) =>
      '<rect class="pbar' + (i === selIdx ? ' sel' : '') + '" data-i="' + i + '" x="' +
      (xs[i] - bw / 2).toFixed(1) + '" y="' + y(disps[i]).toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + Math.max(0, H - bot - y(disps[i])).toFixed(1) + '" rx="2"/>'
    ).join('');
    const lastY = y(disps[n - 1]);
    const lx = Math.min(W - 34, Math.max(padX, xs[n - 1])).toFixed(1);
    const ly = (lastY > 42 ? lastY - 12 : lastY + 18).toFixed(1);
    const plot = type === 'bar' ? bars :
      (mode === 'continuous' && n > 1
        ? '<polygon class="area" points="' + pts.join(' ') + ' ' + xs[n - 1].toFixed(1) + ',' + base + ' ' + xs[0].toFixed(1) + ',' + base + '"/>' +
          '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '') + dots;

    return '<svg class="linesvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Top set weight over time, ' +
      fmt1(ax.lo) + ' to ' + fmt1(ax.hi) + ' ' + esc(unit) + '">' +
      svgYAxis(ax, padX, top, H - bot, W, y, fmt1, unit) +
      plot +
      '<text class="lbl" x="' + lx + '" y="' + ly + '" text-anchor="middle">' +
      fmt1(disps[n - 1]) + ' ' + esc(unit) + '</text>' +
      '<text class="axis" x="' + padX + '" y="' + (H - 8) + '">' + esc(fmtDay(sessions[0].rdate)) + '</text>' +
      '<text class="axis" x="' + (W - 6) + '" y="' + (H - 8) + '" text-anchor="end">' +
      esc(fmtDay(sessions[n - 1].rdate)) + '</text>' +
      '</svg>';
  }

  function exOptsGroups() {
    const gs = [{
      label: 'Chart',
      items: EX_TYPES.map((o) => ({ key: 'type:' + o.id, label: o.label, on: statsExType === o.id })),
    }];
    if (statsExType === 'line') {
      gs.push({
        label: 'Style',
        items: PLOT_MODES.map((o) => ({ key: 'mode:' + o.id, label: o.label, on: statsExMode === o.id })),
      });
    }
    gs.push(rangeOptsGroup(statsRange));
    gs.push({ label: 'Home', items: [{ key: 'pin', label: 'Pin to Home' }] });
    return gs;
  }

  function applyExOpt(k) {
    const kind = k.split(':')[0];
    const val = k.slice(kind.length + 1);
    if (kind === 'type') statsExType = val;
    else if (kind === 'mode') statsExMode = val;
    else if (kind === 'range') setStatsRange(val);
    else if (kind === 'pin') pinCurrentChart();
    render();
  }

  // Keyboard-operable chart points: Enter/Space trigger the same handler
  // as a tap, so charts stay reachable without a pointer.
  function keyActivatable(el) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (el.onclick) el.onclick();
      }
    });
  }

  function bindProgression() {
    const selEl = document.getElementById('sel-ex');
    if (selEl) selEl.onchange = () => {
      statsExSel = selEl.value;
      statsPointSel = null;
      render();
    };
    bindChartOpts('btn-ex-opts', 'Chart options', exOptsGroups, applyExOpt);
    $app.querySelectorAll('.pt, .pbar').forEach((el) => {
      el.onclick = () => { statsPointSel = Number(el.dataset.i); render(); };
      keyActivatable(el);
    });
  }

  /* ---- heatmap tab ---- */

  function statsMusclesHTML() {
    const bb = rangeBuckets(statsRange);
    const buckets = bb.buckets;
    const monthly = bb.monthly;
    const start = rangeStart(statsRange);
    const prevStart = prevRangeStart(statsRange, start);
    const cur = volumeByCat(start, null);
    const prev = prevStart ? volumeByCat(prevStart, start) : null;
    const any = GYMLOG_CATS.some((c) =>
      (cur[c] || 0) > 0 || (prev ? (prev[c] || 0) > 0 : false));
    if (!any) {
      return '<div class="card"><div class="empty">No completed workouts in this range.</div></div>';
    }
    const seg = '<div class="opts-row">' + chartOptsBtn('btn-mus-opts') + '</div>';
    if (statsMusView === 'radar') {
      return seg +
        '<div class="card">' + radarInnerHTML(cur, prev, statsRange) + '</div>' +
        '<p class="hint">Total volume by muscle group for the selected range (kg-normalized).' +
        (prev ? ' Solid = selected range, dashed = the ' + rangeWord(statsRange) + ' before it.' : '') + '</p>';
    }
    return seg +
      '<div class="card">' + heatRowsHTML(buckets, monthly, statsCellSel) + '</div>' +
      '<div class="card"><div class="cell-detail">' +
      heatDetailHTML(buckets, monthly, statsCellSel) + '</div></div>' +
      '<p class="hint">Training volume by muscle group per ' +
      (monthly ? 'month' : 'week (Monday-start)') +
      ' for the selected range. Darker means more volume (kg-normalized).</p>';
  }

  function heatRowsHTML(buckets, monthly, cellSel) {
    const byKey = {};
    buckets.forEach((w) => { byKey[w.key] = w; });

    const grid = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const w = byKey[bucketKeyFor(monthly, d)];
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

    const cats = GYMLOG_CATS.filter((c) => grid[c] && buckets.some((w) => grid[c][w.key]));
    if (!cats.length) return '<div class="empty">No completed workouts in this range.</div>';
    let maxCell = 0;
    cats.forEach((c) => buckets.forEach((w) => {
      maxCell = Math.max(maxCell, (grid[c] && grid[c][w.key]) || 0);
    }));

    return cats.map((cat) => {
      const cells = buckets.map((w) => {
        const v = (grid[cat] && grid[cat][w.key]) || 0;
        const sel = cellSel && cellSel.cat === cat && cellSel.key === w.key;
        const per = monthly ? 'month of ' : 'week of ';
        if (v <= 0) {
          return '<button class="hcell' + (sel ? ' sel' : '') + '" type="button" data-cat="' + esc(cat) +
            '" data-w="' + w.key + '" aria-label="' + esc(cat) + ', ' + per + fmtDay(w.key) + ': no volume"></button>';
        }
        const lvl = Math.max(1, Math.min(4, Math.ceil((v / maxCell) * 4)));
        const op = [0, 0.25, 0.5, 0.75, 1][lvl];
        return '<button class="hcell' + (sel ? ' sel' : '') + '" type="button" data-cat="' + esc(cat) +
          '" data-w="' + w.key + '" data-op="' + op + '"' +
          ' aria-label="' + esc(cat) + ', ' + per + fmtDay(w.key) + ': ' + fmtVol(v) + '"></button>';
      }).join('');
      return '<div class="hrow"><span class="hlabel">' + esc(cat) + '</span>' +
        '<div class="hcells" data-cols="' + buckets.length + '">' + cells + '</div></div>';
    }).join('');
  }

  function heatDetailHTML(buckets, monthly, cellSel) {
    const byKey = {};
    buckets.forEach((w) => { byKey[w.key] = w; });
    const grid = {};
    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const w = byKey[bucketKeyFor(monthly, d)];
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
    let detail = 'Tap a cell to see that muscle and ' + (monthly ? 'month' : 'week') + '.';
    if (cellSel) {
      const cat = cellSel.cat;
      const v = (grid[cat] && grid[cat][cellSel.key]) || 0;
      const w = byKey[cellSel.key];
      const range = w
        ? (monthly
          ? w.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : fmtDay(w.key) + ' \u2013 ' + fmtDay(isoKey(new Date(w.start.getFullYear(), w.start.getMonth(), w.start.getDate() + 6))))
        : '';
      detail = esc(cat) + ' \u00b7 ' + range +
        ' \u00b7 <b>' + (v > 0 ? fmtVol(v) : 'no volume') + '</b>';
    }
    return detail;
  }

  function radarInnerHTML(cur, prev, range) {
    const curLabel = (STATS_RANGES.filter((x) => x.id === range)[0] || {}).label || 'selected range';
    let max = 0;
    GYMLOG_CATS.forEach((c) => {
      max = Math.max(max, cur[c] || 0, prev ? prev[c] || 0 : 0);
    });
    return radarSVG(cur, prev) +
      '<div class="radar-scale">Rings 25 / 50 / 75 / 100% \u00b7 scale 0 \u2013 ' +
      fmtVolCompact(max) + ' kg</div>' +
      (prev
        ? '<div class="cell-detail rlegend"><span class="rkey rkey-cur"></span>' + curLabel +
          '<span class="rkey rkey-prev"></span>previous ' + rangeWord(range) + '</div>'
        : '');
  }

  function radarSVG(cur, prev) {
    const cats = GYMLOG_CATS.filter((c) =>
      (cur[c] || 0) > 0 || (prev ? (prev[c] || 0) > 0 : false));
    const n = cats.length;
    const W = 320, H = 270, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 30;
    let max = 0;
    cats.forEach((c) => {
      max = Math.max(max, cur[c] || 0, prev ? prev[c] || 0 : 0);
    });
    const ang = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
    const pt = (i, v) => {
      const r = R * (max ? v / max : 0);
      return (cx + r * Math.cos(ang(i))).toFixed(1) + ',' + (cy + r * Math.sin(ang(i))).toFixed(1);
    };
    const rings = [0.25, 0.5, 0.75, 1].map((f) =>
      '<circle class="rring" cx="' + cx + '" cy="' + cy + '" r="' + (R * f).toFixed(1) + '"/>').join('');
    const spokes = cats.map((c, i) =>
      '<line class="rspoke" x1="' + cx + '" y1="' + cy + '" x2="' +
      (cx + R * Math.cos(ang(i))).toFixed(1) + '" y2="' + (cy + R * Math.sin(ang(i))).toFixed(1) + '"/>').join('');
    const labels = cats.map((c, i) =>
      '<text class="rlbl' + ((cur[c] || 0) > 0 ? '' : ' off') + '" x="' +
      (cx + (R + 16) * Math.cos(ang(i))).toFixed(1) + '" y="' +
      (cy + (R + 16) * Math.sin(ang(i))).toFixed(1) + '" text-anchor="middle">' + esc(c) + '</text>').join('');
    return '<svg class="radarsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Volume by muscle group">' +
      rings + spokes +
      (prev && cats.some((c) => (prev[c] || 0) > 0)
        ? '<polygon class="rprev" points="' + cats.map((c, i) => pt(i, prev[c] || 0)).join(' ') + '"/>'
        : '') +
      '<polygon class="rcur" points="' + cats.map((c, i) => pt(i, cur[c] || 0)).join(' ') + '"/>' +
      labels +
      '</svg>';
  }

  function musOptsGroups() {
    return [
      { label: 'View', items: MUS_VIEWS.map((o) => ({ key: 'view:' + o.id, label: o.label, on: statsMusView === o.id })) },
      rangeOptsGroup(statsRange),
      { label: 'Home', items: [{ key: 'pin', label: 'Pin to Home' }] },
    ];
  }

  function applyMusOpt(k) {
    const kind = k.split(':')[0];
    const val = k.slice(kind.length + 1);
    if (kind === 'view') statsMusView = val;
    else if (kind === 'range') setStatsRange(val);
    else if (kind === 'pin') pinCurrentChart();
    render();
  }

  function bindMuscles() {
    bindChartOpts('btn-mus-opts', 'Chart options', musOptsGroups, applyMusOpt);
    $app.querySelectorAll('.hcell').forEach((el) => {
      el.onclick = () => {
        statsCellSel = { cat: el.dataset.cat, key: el.dataset.w };
        render();
      };
    });
  }

  /* ---- volume tab ---- */

  // Volume chart data for a range: buckets with per-category and total
  // volume, the chart max and the range total. Shared by the stats tab and
  // the home pin.
  function volumeBucketsData(range) {
    const bb = rangeBuckets(range);
    const buckets = bb.buckets;
    const monthly = bb.monthly;
    const byKey = {};
    buckets.forEach((c) => { c.cats = {}; byKey[c.key] = c; });

    completedRoutines().forEach((r) => {
      const d = routineDate(r);
      if (!d) return;
      const col = byKey[bucketKeyFor(monthly, d)];
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
    buckets.forEach((c) => {
      c.total = 0;
      Object.keys(c.cats).forEach((k) => { c.total += c.cats[k]; });
      totalAll += c.total;
    });
    return {
      buckets: buckets,
      monthly: monthly,
      byKey: byKey,
      max: Math.max.apply(null, buckets.map((c) => c.total).concat([1])),
      totalAll: totalAll,
    };
  }

  // Valid selected bucket key: falls back to the last bucket with volume.
  function volumeSelKey(data, selKey) {
    if (selKey && data.byKey[selKey]) return selKey;
    const lastWithVolume = data.buckets.slice().reverse().find((c) => c.total > 0);
    return lastWithVolume ? lastWithVolume.key : data.buckets[data.buckets.length - 1].key;
  }

  function volumeChartHTML(data, selKey, type, mode) {
    const sel = data.byKey[selKey];
    if (type === 'line') return volumeLineSVG(data.buckets, data.monthly, selKey, mode);
    // Bars scale against a round axis maximum (#66): the gutter mirrors
    // the .col layout (total slot + 150px plot + label slot) so its ticks
    // line up with the segment tops and bottoms by construction.
    const ax = niceTicks(0, data.max, 3, 0);
    const axisMax = ax.hi;
    const ycol =
      '<div class="ycol" aria-hidden="true">' +
      '<span class="col-total">&nbsp;</span>' +
      '<span class="yaxis">' +
      '<span>' + fmtVolCompact(axisMax) + '</span>' +
      '<span>' + fmtVolCompact(axisMax / 2) + '</span>' +
      '<span>0</span>' +
      '</span>' +
      '<span class="col-label">&nbsp;</span>' +
      '</div>';
    return '<div class="chart">' + ycol + data.buckets.map((c) => {
      const segs = GYMLOG_CATS.slice().reverse()
        .filter((cat) => c.cats[cat] > 0)
        .map((cat) => '<div class="segm" data-cat="' + esc(cat) +
          '" data-h="' + ((c.cats[cat] / axisMax) * 100).toFixed(3) + '"></div>')
        .join('');
      const label = data.monthly
        ? (c.start.getMonth() + 1) + '/' + String(c.start.getFullYear()).slice(-2)
        : c.start.getDate() + '/' + (c.start.getMonth() + 1);
      return '<button class="col' + (c.key === sel.key ? ' sel' : '') + '" data-w="' + c.key +
        '" type="button" aria-label="' + (data.monthly ? 'Month of ' : 'Week of ') + fmtDay(c.key) + '">' +
        '<span class="col-total">' + (c.total > 0 ? fmtVolCompact(c.total) : '') + '</span>' +
        (c.total > 0 ? '<span class="segs">' + segs + '</span>' : '<span class="segs empty"></span>') +
        '<span class="col-label">' + label + '</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function volumeBreakdownHTML(data, selKey) {
    const sel = data.byKey[selKey];
    const selEnd = data.monthly
      ? new Date(sel.start.getFullYear(), sel.start.getMonth() + 1, 0)
      : new Date(sel.start.getFullYear(), sel.start.getMonth(), sel.start.getDate() + 6);
    const rows = GYMLOG_CATS.filter((cat) => sel.cats[cat] > 0).map((cat) => {
      const share = sel.total ? Math.round((sel.cats[cat] / sel.total) * 100) : 0;
      return '<div class="bd-row">' +
        '<span class="bd-dot" data-cat="' + esc(cat) + '"></span>' +
        '<span class="bd-cat">' + esc(cat) + '</span>' +
        '<span class="bd-share">' + share + '%</span>' +
        '<span class="bd-vol">' + fmtVol(sel.cats[cat]) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="section-label slim">' +
      (data.monthly
        ? 'Month of ' + sel.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : 'Week of ' + fmtDay(sel.key) + ' \u2013 ' + fmtDay(isoKey(selEnd))) +
      '</div>' +
      (rows || '<div class="empty-inline">No volume in this ' + (data.monthly ? 'month' : 'week') + '.</div>');
  }

  function statsVolumeHTML() {
    const data = volumeBucketsData(statsRange);
    statsSelKey = volumeSelKey(data, statsSelKey);

    return '<div class="card note">' +
      '<div class="sum-row"><span>Range total</span><b>' + fmtVol(data.totalAll) + '</b></div>' +
      '<div class="sum-row"><span>' + (data.monthly ? 'Monthly' : 'Weekly') + ' average</span><b>' +
      fmtVol(data.totalAll / data.buckets.length) + '</b></div>' +
      '</div>' +
      '<div class="card chart-card">' +
      '<div class="opts-row">' + chartOptsBtn('btn-vol-opts') + '</div>' +
      volumeChartHTML(data, statsSelKey, statsVolType, statsVolMode) +
      '</div>' +
      '<div class="card">' + volumeBreakdownHTML(data, statsSelKey) + '</div>' +
      '<p class="hint">Volume = weight \u00d7 reps per set, completed routines only, bucketed per ' +
      (data.monthly ? 'month' : 'week') + '. Totals are normalized to kg for comparison (1 kg = 2.2046 lb); your logged entries are unchanged.</p>';
  }

  // Volume totals per bucket as an SVG trend line (line chart mode).
  function volumeLineSVG(buckets, monthly, selKey, mode) {
    const W = 320, H = 170, padX = 42, top = 18, bot = 24;
    const n = buckets.length;
    const ts = buckets.map((c) => c.start.getTime());
    const xs = buckets.map((c, i) =>
      (n === 1 || ts[n - 1] <= ts[0]) ? (W + padX) / 2 : padX + (W - 2 * padX) * ((ts[i] - ts[0]) / (ts[n - 1] - ts[0])));
    const vals = buckets.map((c) => c.total);
    const ax = niceTicks(Math.min.apply(null, vals), Math.max.apply(null, vals), 3, 0);
    const lo = ax.lo;
    const hi = ax.hi;
    const y = (v) => top + (H - top - bot) * (1 - (v - lo) / (hi - lo));
    const pts = buckets.map((c, i) => xs[i].toFixed(1) + ',' + y(c.total).toFixed(1));
    const base = (H - bot).toFixed(1);
    const dots = buckets.map((c, i) =>
      '<circle class="vpt" data-w="' + c.key + '" cx="' + xs[i].toFixed(1) + '" cy="' + y(c.total).toFixed(1) +
      '" r="' + (c.key === selKey ? 4.5 : 3.5) + '" fill="' +
      (c.key === selKey ? 'var(--text)' : 'var(--accent)') + '"/>'
    ).join('');
    const last = buckets[n - 1];
    const lbl = last.total > 0
      ? '<text class="lbl" x="' + Math.min(W - 34, Math.max(padX, xs[n - 1])).toFixed(1) + '" y="' +
        Math.max(y(last.total) - 10, 12).toFixed(1) + '" text-anchor="middle">' +
        fmtVolCompact(last.total) + '</text>'
      : '';
    const blabel = (c) => monthly
      ? c.start.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      : fmtDay(c.key);
    return '<svg class="linesvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Volume trend, ' +
      fmtVolCompact(ax.lo) + ' to ' + fmtVolCompact(ax.hi) + ' kg">' +
      svgYAxis(ax, padX, top, H - bot, W, y, fmtVolCompact, null) +
      (n > 1 && mode === 'continuous'
        ? '<polygon class="area" points="' + pts.join(' ') + ' ' + xs[n - 1].toFixed(1) + ',' + base + ' ' + xs[0].toFixed(1) + ',' + base + '"/>' +
          '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '') +
      dots + lbl +
      '<text class="axis" x="' + padX + '" y="' + (H - 8) + '">' + esc(blabel(buckets[0])) + '</text>' +
      '<text class="axis" x="' + (W - 6) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(blabel(last)) + '</text>' +
      '</svg>';
  }

  function volOptsGroups() {
    const gs = [{
      label: 'Chart',
      items: VOL_TYPES.map((o) => ({ key: 'type:' + o.id, label: o.label, on: statsVolType === o.id })),
    }];
    if (statsVolType === 'line') {
      gs.push({
        label: 'Style',
        items: PLOT_MODES.map((o) => ({ key: 'mode:' + o.id, label: o.label, on: statsVolMode === o.id })),
      });
    }
    gs.push(rangeOptsGroup(statsRange));
    gs.push({ label: 'Home', items: [{ key: 'pin', label: 'Pin to Home' }] });
    return gs;
  }

  function applyVolOpt(k) {
    const kind = k.split(':')[0];
    const val = k.slice(kind.length + 1);
    if (kind === 'type') statsVolType = val;
    else if (kind === 'mode') statsVolMode = val;
    else if (kind === 'range') setStatsRange(val);
    else if (kind === 'pin') pinCurrentChart();
    render();
  }

  function bindVolume() {
    bindChartOpts('btn-vol-opts', 'Chart options', volOptsGroups, applyVolOpt);
    $app.querySelectorAll('.col').forEach((el) => {
      el.onclick = () => { statsSelKey = el.dataset.w; render(); };
    });
    $app.querySelectorAll('.vpt').forEach((el) => {
      el.onclick = () => { statsSelKey = el.dataset.w; render(); };
      keyActivatable(el);
    });
  }

  /* ---------- share highlight (#67) ---------- */
  // A finished routine becomes a 1080x1350 (4:5) image card in the active
  // theme, shared through the Web Share API when it accepts files (the
  // file is built synchronously so the share call stays inside the tap
  // gesture - iOS drops async-built shares) and offered as a preview with
  // save/copy actions otherwise.

  const SHARE_W = 1080;
  const SHARE_H = 1350;
  const SHARE_FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // A highlight needs at least one working set with weight and reps.
  function shareableRoutine(r) {
    return r.exercises.some((ex) => ex.sets.some((s) =>
      !s.warmup && s.reps != null && s.weight != null));
  }

  // Headline numbers for the card and the text summary. Volume follows the
  // app's single choke point (setVolumeKg, warm-ups excluded); PRs count
  // performed sets only.
  function shareStats(r) {
    const dur = (r.endedAt || 0) - (r.startedAt || 0);
    let workSets = 0;
    let volume = 0;
    let prs = 0;
    r.exercises.forEach((ex) => {
      ex.sets.forEach((s) => {
        if (s.warmup || s.reps == null || s.weight == null) return;
        workSets++;
        volume += setVolumeKg(ex, s);
        if (s.done && isRecordSet(ex, s)) prs++;
      });
    });
    return { dur: dur, workSets: workSets, volume: volume, prs: prs };
  }

  // One row per exercise: heaviest working set (the same "top set" rule
  // as the progression chart) plus its working-set count.
  function shareRows(r) {
    return r.exercises.map((ex) => {
      let best = null;
      let work = 0;
      ex.sets.forEach((s) => {
        if (s.warmup) return;
        if (s.reps == null || s.weight == null) return;
        work++;
        const wkg = s.weight * (ex.unit === 'lb' ? LB_TO_KG : 1);
        if (!best || wkg > best.wkg) best = { wkg: wkg, reps: s.reps };
      });
      if (!best) return null;
      const pr = ex.sets.some((s) => s.done && isRecordSet(ex, s));
      return {
        name: ex.name,
        unit: ex.unit || 'kg',
        weight: ex.unit === 'lb' ? best.wkg / LB_TO_KG : best.wkg,
        reps: best.reps,
        sets: work,
        pr: pr,
      };
    }).filter(Boolean);
  }

  function shareText(r, st, rows) {
    const lines = [
      r.name + ' \u2014 ' + fmtDate(r.date),
      fmtFull(st.dur) + ' \u00b7 ' + st.workSets + (st.workSets === 1 ? ' set' : ' sets') +
        ' \u00b7 ' + fmtVol(st.volume),
    ];
    if (st.prs) lines.push(st.prs + (st.prs === 1 ? ' PR' : ' PRs'));
    if (rows.length) {
      lines.push(rows.slice(0, 8).map((e) =>
        e.name + ' ' + fmt1(e.weight) + e.unit + '\u00d7' + e.reps).join(', ') +
        (rows.length > 8 ? ' \u2026' : ''));
    }
    return lines.join('\n');
  }

  function renderShareCard(r, st, rows) {
    const cv = document.createElement('canvas');
    cv.width = SHARE_W;
    cv.height = SHARE_H;
    const ctx = cv.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const col = (name) => cs.getPropertyValue(name).trim();
    const bg = col('--bg') || '#0f1316';
    const card = col('--card') || '#161c23';
    const text = col('--text') || '#e7ecf3';
    const muted = col('--muted') || '#8d9aab';
    const border = col('--border') || '#26303b';
    const accent = col('--accent') || '#34d399';
    const M = 72;
    const W = SHARE_W;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 14);

    const fit = (str, font, maxW) => {
      ctx.font = font;
      if (ctx.measureText(str).width <= maxW) return str;
      let s = str;
      while (s.length > 1 && ctx.measureText(s + '\u2026').width > maxW) s = s.slice(0, -1);
      return s.trimEnd() + '\u2026';
    };

    let y = 152;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    try { ctx.letterSpacing = '8px'; } catch (err) {}
    ctx.font = '700 30px ' + SHARE_FONT;
    ctx.fillStyle = accent;
    ctx.fillText('KAIOKEN', M, y);
    try { ctx.letterSpacing = '0px'; } catch (err) {}

    // Routine name on up to two lines.
    ctx.font = '800 74px ' + SHARE_FONT;
    ctx.fillStyle = text;
    const nameWords = String(r.name || 'Workout').split(/\s+/);
    const line1Max = W - 2 * M;
    let l1 = '';
    let l2 = '';
    nameWords.forEach((w) => {
      const probe = (l1 ? l1 + ' ' : '') + w;
      if (!l1 && ctx.measureText(probe).width > line1Max && l1 === '' && !l2) {
        // single word longer than a line: hard-fit it
        l1 = fit(probe, '800 74px ' + SHARE_FONT, line1Max);
        return;
      }
      if (!l2) {
        if (ctx.measureText(probe).width <= line1Max) l1 = probe;
        else l2 = w;
      } else if (ctx.measureText(l2 + ' ' + w).width <= line1Max) {
        l2 = l2 + ' ' + w;
      }
    });
    if (l2) l2 = fit(l2, '800 74px ' + SHARE_FONT, line1Max);
    y += 92;
    ctx.fillText(l1, M, y);
    if (l2) { y += 88; ctx.fillText(l2, M, y); }

    y += 64;
    ctx.font = '400 34px ' + SHARE_FONT;
    ctx.fillStyle = muted;
    ctx.fillText(fmtDate(r.date) + '  \u00b7  ' + fmtFull(st.dur), M, y);

    y += 44;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();

    // Exercise rows: name left, top set right, PR chip after the name.
    const shown = rows.slice(0, 8);
    y += 78;
    shown.forEach((e) => {
      ctx.font = '600 36px ' + SHARE_FONT;
      ctx.fillStyle = text;
      const right = fmt1(e.weight) + ' ' + e.unit + ' \u00d7 ' + e.reps;
      ctx.font = '700 36px ' + SHARE_FONT;
      const rightW = ctx.measureText(right).width;
      const chipW = e.pr ? 84 : 0;
      ctx.font = '600 36px ' + SHARE_FONT;
      const name = fit(e.name, '600 36px ' + SHARE_FONT, W - 2 * M - rightW - 28 - chipW);
      ctx.fillText(name, M, y);
      if (e.pr) {
        const cx = M + ctx.measureText(name).width + 24;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx, y - 44, 66, 40, 10);
        else ctx.rect(cx, y - 44, 66, 40);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.font = '700 24px ' + SHARE_FONT;
        ctx.fillStyle = bg;
        ctx.fillText('PR', cx + 18, y - 16);
      }
      ctx.font = '700 36px ' + SHARE_FONT;
      ctx.fillStyle = text;
      ctx.textAlign = 'right';
      ctx.fillText(right, W - M, y);
      ctx.textAlign = 'left';
      y += 74;
    });
    if (rows.length > 8) {
      ctx.font = '400 32px ' + SHARE_FONT;
      ctx.fillStyle = muted;
      ctx.fillText('+' + (rows.length - 8) + ' more exercises', M, y);
      y += 60;
    }

    // Stats panel pinned above the footer.
    const panelH = 224;
    const panelY = SHARE_H - 96 - panelH;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(M, panelY, W - 2 * M, panelH, 28);
    else ctx.rect(M, panelY, W - 2 * M, panelH);
    ctx.fillStyle = card;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '800 60px ' + SHARE_FONT;
    ctx.fillStyle = accent;
    ctx.fillText(fmtVol(st.volume), W / 2, panelY + 96);
    ctx.font = '400 30px ' + SHARE_FONT;
    ctx.fillStyle = muted;
    const sub = st.workSets + (st.workSets === 1 ? ' set' : ' sets') +
      (st.prs ? '  \u00b7  ' + st.prs + (st.prs === 1 ? ' PR' : ' PRs') : '');
    ctx.fillText(sub, W / 2, panelY + 158);
    ctx.font = '400 26px ' + SHARE_FONT;
    ctx.fillStyle = muted;
    ctx.fillText('Kaioken', W / 2, SHARE_H - 40);
    ctx.textAlign = 'left';
    return cv;
  }

  // data: URL -> File, synchronously: navigator.share must be called in
  // the user gesture that built the file.
  function dataURLToFile(dataURL, name) {
    try {
      const b64 = String(dataURL).split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: 'image/png' });
    } catch (err) {
      return null;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Copied'))
        .catch(() => fallbackCopyText(text));
      return;
    }
    fallbackCopyText(text);
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove();
    toast(ok ? 'Copied' : 'Copy failed');
  }

  function openShareSheet(dataURL, text) {
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
      '<div class="sheet-title">Share highlight</div>' +
      '<div class="share-preview"><img src="' + dataURL + '" alt="Routine highlight card preview"></div>' +
      '<button class="btn btn-block" id="share-save" type="button">Save image</button>' +
      '<button class="btn btn-block" id="share-copy" type="button">Copy text</button>' +
      '<button class="btn btn-block btn-ghost" id="sheet-cancel" type="button">Close</button>';
    mountSheet(backdrop, sheet);
    backdrop.onclick = guard(closeSheet);
    document.getElementById('sheet-cancel').onclick = guard(closeSheet);
    document.getElementById('share-save').onclick = guard(() => {
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = 'kaioken-highlight.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Image saved');
    });
    document.getElementById('share-copy').onclick = guard(() => copyText(text));
  }

  function shareHighlight(r) {
    const st = shareStats(r);
    const rows = shareRows(r);
    const text = shareText(r, st, rows);
    let cv = null;
    try { cv = renderShareCard(r, st, rows); } catch (err) { cv = null; }
    if (!cv) {
      openAlertSheet({
        title: 'Share highlight',
        message: 'The highlight image could not be created.',
        confirmLabel: 'OK',
        onConfirm: () => {},
      });
      return;
    }
    const dataURL = cv.toDataURL('image/png');
    const file = dataURLToFile(dataURL, 'kaioken-highlight.png');
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: text })
        .then(() => toast('Shared'))
        .catch((err) => {
          if (err && err.name === 'AbortError') return;
          openShareSheet(dataURL, text);
        });
      return;
    }
    openShareSheet(dataURL, text);
  }

  /* ---- home chart pin ---- */

  // One pinned chart on Home, fully interactive: its options sheet edits and
  // persists the pin, and selections live in homeSel for this session only.
  let homeSel = { point: null, key: null, cell: null };

  // Home section order: the saved order wins, unknown ids are dropped and
  // sections that appeared later (or were never saved) keep their default
  // spot at the end.
  function homeOrderOrDefault() {
    const all = ['cal', 'goals', 'chart', 'new', 'programs', 'active', 'scheduled', 'history'];
    const saved = Array.isArray(settings.homeOrder) ? settings.homeOrder : [];
    const out = saved.filter((id) => all.indexOf(id) !== -1);
    all.forEach((id) => { if (out.indexOf(id) === -1) out.push(id); });
    return out;
  }

  // Snapshot the currently viewed chart as the home pin (one at a time).
  function pinCurrentChart() {
    settings.homeChart = {
      tab: statsTab, ex: statsExSel,
      exType: statsExType, exMode: statsExMode,
      volType: statsVolType, volMode: statsVolMode,
      view: statsMusView, range: statsRange,
    };
    homeSel = { point: null, key: null, cell: null };
    store.setSetting('homeChart', settings.homeChart)
      .catch((e) => console.error('Kaioken:', e));
    toast('Pinned to Home');
  }

  function homeChartHTML() {
    const cfg = settings.homeChart;
    if (!cfg) return '';
    const title = cfg.tab === 'progression' ? (cfg.ex || 'Progression')
      : cfg.tab === 'volume' ? 'Volume' : 'Muscles';
    return '<div class="card home-chart">' +
      '<div class="chart-head">' +
      '<button class="chart-title" id="home-chart-title" type="button">' + esc(title) + '</button>' +
      chartOptsBtn('btn-home-opts') +
      '</div>' +
      homeChartBodyHTML(cfg) +
      '</div>';
  }

  function homeChartBodyHTML(cfg) {
    if (cfg.tab === 'progression') {
      const byName = progressionData();
      const g = byName[String(cfg.ex || '').toLowerCase()];
      if (!g || !g.sessions.length) {
        return '<div class="empty">No sessions in this range.</div>';
      }
      const start = rangeStart(cfg.range);
      const sessions = start
        ? g.sessions.filter((s) => s.ts >= start.getTime())
        : g.sessions;
      if (!sessions.length) {
        return '<div class="empty">No sessions in this range.</div>';
      }
      return progressionChartBody(sessions, cfg.exType, cfg.exMode, homeSel.point);
    }
    if (cfg.tab === 'volume') {
      const data = volumeBucketsData(cfg.range);
      const selKey = volumeSelKey(data, homeSel.key);
      return volumeChartHTML(data, selKey, cfg.volType, cfg.volMode) +
        volumeBreakdownHTML(data, selKey);
    }
    const start = rangeStart(cfg.range);
    const prevStart = prevRangeStart(cfg.range, start);
    const cur = volumeByCat(start, null);
    const prev = prevStart ? volumeByCat(prevStart, start) : null;
    const any = GYMLOG_CATS.some((c) =>
      (cur[c] || 0) > 0 || (prev ? (prev[c] || 0) > 0 : false));
    if (!any) return '<div class="empty">No completed workouts in this range.</div>';
    if (cfg.view === 'radar') return radarInnerHTML(cur, prev, cfg.range);
    const bb = rangeBuckets(cfg.range);
    return heatRowsHTML(bb.buckets, bb.monthly, homeSel.cell) +
      '<div class="cell-detail">' +
      heatDetailHTML(bb.buckets, bb.monthly, homeSel.cell) + '</div>';
  }

  function homeOptsGroups() {
    const cfg = settings.homeChart;
    if (!cfg) return [];
    const gs = [];
    if (cfg.tab === 'muscles') {
      gs.push({ label: 'View', items: MUS_VIEWS.map((o) => ({ key: 'view:' + o.id, label: o.label, on: cfg.view === o.id })) });
    } else {
      const types = cfg.tab === 'progression' ? EX_TYPES : VOL_TYPES;
      const curType = cfg.tab === 'progression' ? cfg.exType : cfg.volType;
      gs.push({ label: 'Chart', items: types.map((o) => ({ key: 'type:' + o.id, label: o.label, on: curType === o.id })) });
      if (curType === 'line') {
        const curMode = cfg.tab === 'progression' ? cfg.exMode : cfg.volMode;
        gs.push({ label: 'Style', items: PLOT_MODES.map((o) => ({ key: 'mode:' + o.id, label: o.label, on: curMode === o.id })) });
      }
    }
    gs.push(rangeOptsGroup(cfg.range));
    gs.push({ label: 'Home', items: [{ key: 'unpin', label: 'Unpin from Home' }] });
    return gs;
  }

  function applyHomeOpt(k) {
    const cfg = settings.homeChart;
    if (!cfg) return;
    const kind = k.split(':')[0];
    const val = k.slice(kind.length + 1);
    if (kind === 'unpin') {
      settings.homeChart = null;
      homeSel = { point: null, key: null, cell: null };
      store.setSetting('homeChart', null)
        .catch((e) => console.error('Kaioken:', e));
      toast('Removed from Home');
      render();
      return;
    }
    if (kind === 'type') {
      if (cfg.tab === 'progression') cfg.exType = val;
      else cfg.volType = val;
    } else if (kind === 'mode') {
      if (cfg.tab === 'progression') cfg.exMode = val;
      else cfg.volMode = val;
    } else if (kind === 'view') cfg.view = val;
    else if (kind === 'range') {
      cfg.range = val;
      homeSel = { point: null, key: null, cell: null };
    }
    store.setSetting('homeChart', cfg).catch((e) => console.error('Kaioken:', e));
    render();
  }

  function bindHomeChart() {
    const cfg = settings.homeChart;
    if (!cfg) return;
    const titleBtn = document.getElementById('home-chart-title');
    if (titleBtn) titleBtn.onclick = () => {
      statsTab = cfg.tab === 'muscles' ? 'heatmap' : cfg.tab;
      if (cfg.ex) statsExSel = cfg.ex;
      if (cfg.exType) statsExType = cfg.exType;
      if (cfg.exMode) statsExMode = cfg.exMode;
      if (cfg.volType) statsVolType = cfg.volType;
      if (cfg.volMode) statsVolMode = cfg.volMode;
      if (cfg.view) statsMusView = cfg.view;
      statsRange = cfg.range || '1m';
      statsSelKey = null;
      statsPointSel = null;
      statsCellSel = null;
      go('stats');
    };
    bindChartOpts('btn-home-opts', 'Chart options', homeOptsGroups, applyHomeOpt);
    if (cfg.tab === 'progression') {
      $app.querySelectorAll('.home-chart .pt, .home-chart .pbar').forEach((el) => {
        el.onclick = () => { homeSel.point = Number(el.dataset.i); render(); };
        keyActivatable(el);
      });
    } else if (cfg.tab === 'volume') {
      $app.querySelectorAll('.home-chart .col, .home-chart .vpt').forEach((el) => {
        el.onclick = () => { homeSel.key = el.dataset.w; render(); };
        if (el.classList.contains('vpt')) keyActivatable(el);
      });
    } else {
      $app.querySelectorAll('.home-chart .hcell').forEach((el) => {
        el.onclick = () => {
          homeSel.cell = { cat: el.dataset.cat, key: el.dataset.w };
          render();
        };
      });
    }
  }

  /* ---------- backup / restore ---------- */
  function toNum(v) {
    if (v === '' || v == null) return null;
    // Numbers and numeric strings only: Number([5]) is 5, so an imported
    // "reps": [5] would otherwise silently become 5 (#35).
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Goals (#65): the saved shape is validated in one place so the
  // settings card, the app-init path and imported backups all agree.
  // Absent/zero/negative targets drop out; an all-empty object is null
  // (goals off).
  function sanitizeGoals(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    const out = {};
    const counts = (src, periods) => {
      if (!src || typeof src !== 'object') return;
      const o = {};
      let any = false;
      periods.forEach((k) => {
        const n = Math.floor(toNum(src[k]) || 0);
        if (n > 0) { o[k] = n; any = true; }
      });
      if (any) return o;
    };
    const wo = counts(g.workouts, ['week', 'month', 'year']);
    if (wo) out.workouts = wo;
    const su = counts(g.supps, ['week', 'month']);
    if (su) out.supps = su;
    const t = toNum(g.weight && g.weight.target);
    if (t != null && t > 0) {
      out.weight = {
        target: t,
        unit: g.weight.unit === 'lb' ? 'lb' : 'kg',
        since: validDate(g.weight.since) ? g.weight.since : todayISO(),
      };
    }
    return Object.keys(out).length ? out : null;
  }

  // The exercise/set validation shared by routines and program
  // templates (#62), extracted verbatim from sanitizeRoutine.
  function sanitizeExercises(arr) {
    const exercises = Array.isArray(arr) ? arr : [];
    exercises.forEach((e) => {
      e.id = (typeof e.id === 'string' && e.id) ? e.id : uid();
      e.name = typeof e.name === 'string' ? e.name.slice(0, 60) : '';
      e.unit = e.unit === 'lb' ? 'lb' : 'kg';
      e.dunit = e.dunit === 'mi' ? 'mi' : 'km';
      e.sets = Array.isArray(e.sets) ? e.sets : [];
      e.sets.forEach((st) => {
        st.id = (typeof st.id === 'string' && st.id) ? st.id : uid();
        st.reps = toNum(st.reps);
        st.weight = toNum(st.weight);
        st.mins = toNum(st.mins);
        st.dist = toNum(st.dist);
        st.done = st.done === true;
        st.warmup = st.warmup === true;
      });
    });
    return exercises;
  }

  function sanitizeProgram(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const out = {
      id: (typeof p.id === 'string' && p.id) ? p.id : uid(),
      name: (typeof p.name === 'string' && p.name.trim())
        ? p.name.trim().slice(0, 60) : 'Program',
      createdAt: toNum(p.createdAt) || Date.now(),
      routines: [],
    };
    if (Array.isArray(p.routines)) {
      p.routines.slice(0, 24).forEach((t) => {
        if (!t || typeof t !== 'object' || Array.isArray(t)) return;
        out.routines.push({
          id: (typeof t.id === 'string' && t.id) ? t.id : uid(),
          name: (typeof t.name === 'string' && t.name.trim())
            ? t.name.trim().slice(0, 60) : 'Routine',
          exercises: sanitizeExercises(t.exercises),
        });
      });
    }
    return out;
  }

  function sanitizeRoutine(r) {
    // The routine's own id is validated exactly like the nested exercise
    // and set ids: IndexedDB accepts numbers and (for puts) rejects
    // non-key objects, so a numeric id would render a dead entry (the
    // DOM round-trip makes it a string again) and an object id would
    // abort the import with a DataError (#32).
    r.id = (typeof r.id === 'string' && r.id) ? r.id : uid();
    r.name = (typeof r.name === 'string' && r.name.trim())
      ? r.name.trim().slice(0, 60) : 'Workout';
    r.date = validDate(r.date) ? r.date : todayISO();
    r.status = (r.status === 'active' || r.status === 'completed')
      ? r.status : 'scheduled';
    r.createdAt = toNum(r.createdAt) || Date.now();
    r.startedAt = toNum(r.startedAt);
    r.endedAt = toNum(r.endedAt);
    // A started workout needs a start time and a finished one an end
    // time, or the timer card renders NaN and charts plot off-canvas:
    // derive them from the creation time / the workout date.
    if (r.status === 'active' && !r.startedAt) {
      r.startedAt = toNum(r.createdAt) || Date.now();
    }
    if (r.status === 'completed' && !r.endedAt) {
      const p = String(r.date || '').split('-').map(Number);
      r.endedAt = (p.length === 3 && p[0])
        ? new Date(p[0], p[1] - 1, p[2], 12).getTime()
        : Date.now();
    }
    // A finished workout without a start time would render its duration
    // from the raw end timestamp (~56 years in hours, #34): pre-1.1.0 and
    // third-party backups commonly omit startedAt. Pin the start to the
    // end so the duration reads as zero instead.
    if (r.status === 'completed' && !r.startedAt) {
      r.startedAt = r.endedAt || Date.now();
    }
    r.supps = r.supps === true ? true : r.supps === false ? false : null;
    r.bodyWeight = toNum(r.bodyWeight);
    r.bwUnit = r.bwUnit === 'lb' ? 'lb' : 'kg';
    // Routines started from a program carry its id (#62): validated as an
    // opaque string so imports cannot smuggle objects into the record.
    r.programId = (typeof r.programId === 'string' && r.programId)
      ? r.programId.slice(0, 64) : null;
    r.exercises = sanitizeExercises(r.exercises);
    return r;
  }

  function photoCardHTML() {
    if (settings.photo) {
      return '<div class="card">' +
        '<div class="field"><span>Your photo</span>' +
        '<img class="photo-thumb" alt="Background photo preview" src="' + esc(settings.photo) + '">' +
        '</div>' +
        '<div class="seg seg-fit">' +
        '<button type="button" class="' + (settings.photoFit === 'fit' ? '' : 'on') + '" data-f="fill">Fill</button>' +
        '<button type="button" class="' + (settings.photoFit === 'fit' ? 'on' : '') + '" data-f="fit">Fit</button>' +
        '</div>' +
        '<div class="photo-actions">' +
        '<button class="btn btn-ghost btn-block" id="act-photo-choose" type="button">Choose Photo</button>' +
        '<button class="btn btn-ghost btn-block btn-photo-remove" id="act-photo-remove" type="button">Remove Photo</button>' +
        '</div>' +
        '</div>';
    }
    return '<div class="card">' +
      '<div class="field"><span>Your photo</span></div>' +
      '<p class="hint">No photo chosen yet.</p>' +
      '<button class="btn btn-primary btn-block" id="act-photo-choose" type="button">Choose Photo</button>' +
      '</div>';
  }

  // Restores settings from an imported backup envelope: each key is
  // validated exactly like the app-init path. The background photo is
  // never part of an export (megabytes of base64) and stays device-local.
  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    const put = (key, value) =>
      store.setSetting(key, value).catch((e) => console.error('Kaioken:', e));
    if (s.rest === 60 || s.rest === 90 || s.rest === 120) {
      settings.rest = s.rest;
      put('rest', s.rest);
    }
    if (THEMES[s.theme]) {
      applyTheme(s.theme);
      put('theme', s.theme);
    }
    if (BG_STYLES.indexOf(s.bgStyle) !== -1) {
      settings.bgStyle = s.bgStyle;
      applyBgStyle(s.bgStyle);
      put('bgStyle', s.bgStyle);
    }
    if (s.photoFit === 'fit' || s.photoFit === 'fill') {
      settings.photoFit = s.photoFit;
      applyPhotoFit(s.photoFit);
      put('photoFit', s.photoFit);
    }
    if (s.suppsLast === true || s.suppsLast === false) {
      settings.suppsLast = s.suppsLast;
      put('suppsLast', s.suppsLast);
    }
    if (s.bwUnit === 'kg' || s.bwUnit === 'lb') {
      settings.bwUnit = s.bwUnit;
      put('bwUnit', s.bwUnit);
    }
    // A pinned chart with an unknown tab renders through the fall-through
    // branch as the muscles chart and persists across reloads (#35):
    // accept only the tabs the app can actually display.
    if (s.homeChart && typeof s.homeChart === 'object' &&
        ['progression', 'volume', 'heatmap'].indexOf(s.homeChart.tab) !== -1) {
      settings.homeChart = s.homeChart;
      put('homeChart', s.homeChart);
    }
    if (Array.isArray(s.homeOrder)) {
      settings.homeOrder = s.homeOrder;
      put('homeOrder', s.homeOrder);
    }
    const goals = sanitizeGoals(s.goals);
    if (goals) {
      settings.goals = goals;
      goalUnit = null; // re-derive the weight-goal display unit on next render
      put('goals', goals);
    }
  }

  // The weight-goal display unit lives between renders (the card is
  // rebuilt on every render, the toggle must not reset it mid-edit).
  let goalUnit = null;

  function goalSettingsCardHTML() {
    const g = settings.goals || {};
    const gv = (o, k) => ((g[o] && g[o][k]) != null ? g[o][k] : '');
    if (!goalUnit) {
      goalUnit = (g.weight && g.weight.unit) || settings.bwUnit;
    }
    const gf = (id, label, mode, value) =>
      '<div class="goal-f"><span>' + label + '</span>' +
      '<input id="' + id + '" type="text" inputmode="' + mode + '" autocomplete="off" placeholder="off" value="' + esc(String(value)) + '"></div>';
    return '<div class="card">' +
      '<div class="field"><span>Goals</span></div>' +
      gf('gf-wo-week', 'Workouts / week', 'numeric', gv('workouts', 'week')) +
      gf('gf-wo-month', 'Workouts / month', 'numeric', gv('workouts', 'month')) +
      gf('gf-wo-year', 'Workouts / year', 'numeric', gv('workouts', 'year')) +
      gf('gf-su-week', 'Creatine / protein days / week', 'numeric', gv('supps', 'week')) +
      gf('gf-su-month', 'Creatine / protein days / month', 'numeric', gv('supps', 'month')) +
      '<div class="goal-f"><span>Body-weight target</span>' +
      '<span class="goal-bw">' +
      '<input id="gf-wt" type="text" inputmode="decimal" autocomplete="off" placeholder="off" value="' +
      esc(g.weight ? String(g.weight.target) : '') + '">' +
      '<span class="seg seg-gu">' +
      '<button type="button" class="' + (goalUnit === 'kg' ? 'on' : '') + '" data-gu="kg">kg</button>' +
      '<button type="button" class="' + (goalUnit === 'lb' ? 'on' : '') + '" data-gu="lb">lb</button>' +
      '</span>' +
      '</span>' +
      '</div>' +
      '<p class="hint">Empty or 0 turns a goal off. Workout and creatine/protein goals count calendar weeks (Monday-start), months and years of finished workouts - shown as progress bars on Home. The body-weight goal tracks your latest logged weight toward the target; progress counts from the day the target was last changed.</p>' +
      '</div>';
  }

  function renderSettings() {
    const restOptions = [
      { secs: 60, label: '1 min' },
      { secs: 90, label: '1.5 min' },
      { secs: 120, label: '2 min' },
    ];
    const buildExport = () => JSON.stringify(
      {
        app: 'kaioken',
        version: 1,
        exportedAt: new Date().toISOString(),
        routines: routines,
        programs: programs,
        settings: {
          rest: settings.rest,
          theme: settings.theme,
          bgStyle: settings.bgStyle,
          photoFit: settings.photoFit,
          suppsLast: settings.suppsLast,
          bwUnit: settings.bwUnit,
          homeChart: settings.homeChart,
          homeOrder: settings.homeOrder,
          goals: settings.goals,
        },
      },
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
          '<span class="sw" data-th="' + id + '" data-swatch="bg"></span>' +
          '<span class="sw" data-th="' + id + '" data-swatch="card"></span>' +
          '<span class="sw" data-th="' + id + '" data-swatch="accent"></span>' +
          '</span>' +
          '<span class="theme-name">' + t.label + '</span>' +
          '<span class="sw-check">' + I.check + '</span>' +
          '</button>';
      }).join('') +
      '</div>' +
      '</div>' +
      '<p class="hint">Applies instantly. Kaioken counts finished workouts from your last 7 days: 0 = \u00d71 (ice), 1 = \u00d72, 2 = \u00d73, 3 = \u00d74, 4+ = \u00d720 (red). Delete a finished workout to watch it cool down.</p>' +
      '</div>' +
      '<div class="card">' +
      '<div class="field"><span>Background style</span>' +
      '<div class="seg seg-bg">' +
      '<button type="button" class="' + (settings.bgStyle === 'off' ? 'on' : '') + '" data-b="off">Off</button>' +
      '<button type="button" class="' + (settings.bgStyle === 'texture' ? 'on' : '') + '" data-b="texture">Texture</button>' +
      '<button type="button" class="' + (settings.bgStyle === 'photo' ? 'on' : '') + '" data-b="photo">Photo</button>' +
      '</div>' +
      '</div>' +
      '<p class="hint">Texture: a subtle generated backdrop. Photo: one of your own photos, stored only on this device.</p>' +
      '</div>' +
      (settings.bgStyle === 'photo' ? photoCardHTML() : '') +
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
      goalSettingsCardHTML() +
      '<div class="card">' +
      '<p class="hint">Your routines and settings (except the background photo, which stays on this device) are stored only on this device. Export regularly and keep a copy somewhere safe (Notes, email, cloud storage). Paste a backup below to restore it or move it to a new phone.</p>' +
      '<p class="hint">' + (storagePersisted === true
        ? 'Persistent storage is on: the browser should not evict your data automatically. Keep exports anyway.'
        : storagePersisted === false
          ? 'Persistent storage was not granted: under storage pressure the browser may erase site data. Export regularly.'
          : 'Persistent storage is not reported by this browser. Export regularly.') + '</p>' +
      '<label class="field"><span>Export (copy this text)</span>' +
      '<textarea id="ta-export" rows="10" spellcheck="false" placeholder="Tap Generate to build the backup text"></textarea></label>' +
      '<button class="btn btn-ghost btn-block" id="act-gen" type="button">Generate Export</button>' +
      '<button class="btn btn-ghost btn-block" id="act-copy" type="button">Copy to Clipboard</button>' +
      '</div>' +
      '<div class="card">' +
      '<label class="field"><span>Import (paste a backup)</span>' +
      '<textarea id="ta-import" rows="4" spellcheck="false" placeholder="Paste backup JSON here"></textarea></label>' +
      '<button class="btn btn-primary btn-block" id="act-import" type="button">Import</button>' +
      '</div>' +
      '<p class="hint version-line">Kaioken v' + APP_VERSION + '</p>';

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

    $app.querySelectorAll('.seg-bg button').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.b;
        if (settings.bgStyle === v) return;
        applyBgStyle(v, true);
        store.setSetting('bgStyle', v)
          .catch((e) => console.error('Kaioken: setting save failed', e));
        render();
      };
    });
    const chooseBtn = document.getElementById('act-photo-choose');
    if (chooseBtn) chooseBtn.onclick = () => pickPhoto();
    $app.querySelectorAll('.seg-fit button').forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.f;
        if (settings.photoFit === v) return;
        applyPhotoFit(v);
        $app.querySelectorAll('.seg-fit button').forEach((x) => x.classList.toggle('on', x === b));
        store.setSetting('photoFit', v)
          .catch((e) => console.error('Kaioken: setting save failed', e));
      };
    });
    const removeBtn = document.getElementById('act-photo-remove');
    if (removeBtn) removeBtn.onclick = () => {
      store.setSetting('photo', '')
        .catch((e) => console.error('Kaioken: setting save failed', e));
      applyPhoto('');
      applyBgStyle('off');
      render();
    };

    $app.querySelectorAll('.seg-rest button').forEach((b) => {
      b.onclick = () => {
        settings.rest = Number(b.dataset.s);
        $app.querySelectorAll('.seg-rest button').forEach((x) => x.classList.toggle('on', x === b));
        store.setSetting('rest', settings.rest)
          .catch((e) => console.error('Kaioken: setting save failed', e));
      };
    });

    // Goals (#65): saved on every change; empty/0 simply turns that goal
    // off. Editing the weight target (or its unit) re-stamps `since`, so
    // progress restarts from the new reference without touching history.
    const gfInt = (id) => {
      const el = document.getElementById(id);
      if (!el) return 0;
      const n = Math.floor(toNum(el.value) || 0);
      return (isFinite(n) && n > 0) ? n : 0;
    };
    const saveGoals = () => {
      const raw = {};
      const wo = { week: gfInt('gf-wo-week'), month: gfInt('gf-wo-month'), year: gfInt('gf-wo-year') };
      if (wo.week || wo.month || wo.year) raw.workouts = wo;
      const su = { week: gfInt('gf-su-week'), month: gfInt('gf-su-month') };
      if (su.week || su.month) raw.supps = su;
      const wtEl = document.getElementById('gf-wt');
      const t = wtEl ? toNum(wtEl.value) : null;
      if (t != null && t > 0) {
        let since = todayISO();
        const prev = settings.goals && settings.goals.weight;
        if (prev) {
          const prevInNewUnit = prev.unit === goalUnit
            ? prev.target
            : (prev.unit === 'lb' ? prev.target * LB_TO_KG : prev.target / LB_TO_KG);
          if (Math.abs(prevInNewUnit - t) < 1e-9) since = prev.since;
        }
        raw.weight = { target: t, unit: goalUnit, since: since };
      }
      settings.goals = sanitizeGoals(raw);
      store.setSetting('goals', settings.goals)
        .catch((e) => console.error('Kaioken: setting save failed', e));
    };
    ['gf-wo-week', 'gf-wo-month', 'gf-wo-year', 'gf-su-week', 'gf-su-month', 'gf-wt'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', saveGoals);
    });
    $app.querySelectorAll('.seg-gu button').forEach((b) => {
      b.onclick = () => {
        const u = b.dataset.gu;
        if (u === goalUnit) return;
        const wtEl = document.getElementById('gf-wt');
        const t = toNum(wtEl.value);
        if (t != null && t > 0) {
          const kg = goalUnit === 'lb' ? t / LB_TO_KG : t;
          wtEl.value = String(Math.round((u === 'lb' ? kg / LB_TO_KG : kg) * 10) / 10);
        }
        goalUnit = u;
        $app.querySelectorAll('.seg-gu button').forEach((x) => x.classList.toggle('on', x === b));
        saveGoals();
      };
    });

    document.getElementById('act-gen').onclick = () => {
      document.getElementById('ta-export').value = buildExport();
      toast('Backup text ready');
    };

    document.getElementById('act-copy').onclick = () => {
      const ta = document.getElementById('ta-export');
      if (!ta.value) ta.value = buildExport();
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
        openAlertSheet({ title: 'Import failed', message: 'That does not look like valid JSON.' });
        return;
      }
      const incoming = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.routines)) ? data.routines : null;
      const list = (incoming || [])
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .map(sanitizeRoutine);
      const incomingPrograms = (data && Array.isArray(data.programs))
        ? data.programs.map(sanitizeProgram).filter(Boolean)
        : [];
      if (!list.length && !incomingPrograms.length && !(data && data.settings)) {
        openAlertSheet({ title: 'Import failed', message: 'No routines or programs found in the backup.' });
        return;
      }
      const apply = async () => {
        // Two routines in one backup sharing an id: the second would
        // silently replace the first in both the session and the
        // database (#32) - give duplicates a fresh identity so both
        // survive as separate workouts.
        const seen = new Set();
        for (const ir of list) {
          if (seen.has(ir.id)) ir.id = uid();
          seen.add(ir.id);
        }
        // Write to the database before touching the in-memory list, and
        // merge only what actually landed (#33): a failed put used to
        // leave the session showing routines the database never received
        // - they silently vanished on the next reload - with no feedback
        // of any kind.
        const saved = [];
        let failed = false;
        for (const ir of list) {
          try {
            await store.put(ir);
            saved.push(ir);
          } catch (err) {
            console.error('Kaioken: import write failed', err);
            failed = true;
            break;
          }
        }
        let added = 0;
        let updated = 0;
        for (const ir of saved) {
          const idx = routines.findIndex((x) => x.id === ir.id);
          if (idx >= 0) {
            routines[idx] = ir;
            updated++;
          } else {
            routines.push(ir);
            added++;
          }
        }
        if (failed) {
          if (saved.length) render();
          openAlertSheet({
            title: 'Import incomplete',
            message: 'A write failed midway: only ' + saved.length + ' of ' +
              list.length + ' routines were saved. The rest were not imported. Reload the app, then try again with a smaller backup.',
          });
          return;
        }
        let pAdded = 0;
        let pUpdated = 0;
        if (incomingPrograms.length) {
          // Same write-then-merge discipline as the routines (#33): build
          // the merged array, write it, and only then touch the session -
          // a failed write must not leave programs that vanish on reload.
          const seenP = new Set();
          incomingPrograms.forEach((ip) => {
            if (seenP.has(ip.id)) ip.id = uid();
            seenP.add(ip.id);
          });
          const merged = programs.slice();
          incomingPrograms.forEach((ip) => {
            const idx = merged.findIndex((x) => x.id === ip.id);
            if (idx >= 0) { merged[idx] = ip; pUpdated++; }
            else { merged.push(ip); pAdded++; }
          });
          try {
            await store.setSetting('programs', merged);
            programs = merged;
          } catch (err) {
            console.error('Kaioken: program import write failed', err);
            openAlertSheet({
              title: 'Import incomplete',
              message: 'The routines were saved but the programs were not. Reload the app, then try again.',
            });
            go('home');
            return;
          }
        }
        if (data && data.settings) applySettings(data.settings);
        toast('Imported ' + added + ' new, updated ' + updated +
          (incomingPrograms.length
            ? ', ' + pAdded + ' program' + (pAdded === 1 ? '' : 's') + ' added, ' + pUpdated + ' updated'
            : ''));
        go('home');
      };
      // Settings-only backups write nothing destructive and skip the
      // confirm; anything carrying routines or programs shows the
      // overwrite summary first (programs overwrite by id on re-import).
      if (!list.length && !incomingPrograms.length) {
        await apply();
        return;
      }
      // Overwrites are the dangerous half of a merge: show what would be
      // replaced before anything is written, instead of counting after.
      const replacing = list.filter((ir) => routines.some((x) => x.id === ir.id));
      openConfirmSheet({
        title: 'Import backup',
        message: (replacing.length
          ? 'Overwrites ' + replacing.length + ' existing routine' +
            (replacing.length === 1 ? '' : 's') + ' (' +
            replacing.slice(0, 3).map((ir) => ir.name).join(', ') +
            (replacing.length > 3 ? ', \u2026' : '') + '). '
          : '') +
          'Adds ' + (list.length - replacing.length) + ' new.' +
          (incomingPrograms.length
            ? ' Programs: adds ' +
              incomingPrograms.filter((ip) => !programs.some((x) => x.id === ip.id)).length +
              ', overwrites ' +
              incomingPrograms.filter((ip) => programs.some((x) => x.id === ip.id)).length + '.'
            : ''),
        confirmLabel: 'Import',
        onConfirm: apply,
      });
    };
  }

  /* ---------- init ---------- */
  // A new press anywhere unlocks the action sheet: the gesture that opened
  // it may still emit a stray click when it ends, which must be ignored.
  document.addEventListener('pointerdown', () => { sheetGestureLock = false; }, true);
  document.addEventListener('touchstart', () => { sheetGestureLock = false; }, true);

  // Sheets work from a keyboard: Escape closes, Tab stays trapped inside.
  document.addEventListener('keydown', (e) => {
    const sheet = document.getElementById('sheet');
    if (!sheet) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const focusables = Array.prototype.slice.call(
      sheet.querySelectorAll('button, input')).filter((el) => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active && sheet.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) { e.preventDefault(); last.focus(); }
    } else {
      if (!inside || active === last) { e.preventDefault(); first.focus(); }
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  window.addEventListener('popstate', (e) => {
    const v = e.state && e.state.view && e.state.view.name ? e.state.view : { name: 'home' };
    view = v;
    render();
  });

  openDB()
    .then(() => {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        navigator.storage.persist()
          .then((ok) => { storagePersisted = !!ok; })
          .catch(() => {});
      }
    })
    .then(() => store.getSetting('rest', 120))
    .then((rest) => {
      settings.rest = (typeof rest === 'number' && rest > 0) ? rest : 120;
    })
    .then(() => store.getSetting('theme', 'dark'))
    .then((t) => { applyTheme(THEMES[t] ? t : 'dark'); })
    .then(() => store.getSetting('photo', ''))
    .then((photo) => { applyPhoto(typeof photo === 'string' ? photo : ''); })
    .then(() => store.getSetting('photoFit', 'fill'))
    .then((pf) => { applyPhotoFit(pf === 'fit' ? 'fit' : 'fill'); })
    .then(() => store.getSetting('bgStyle', null))
    .then((v) => {
      if (BG_STYLES.indexOf(v) !== -1) return v;
      return store.getSetting('bg', false)
        .then((legacy) => (legacy === true ? 'texture' : 'off'));
    })
    .then((v) => { applyBgStyle(v); })
    .then(() => store.getSetting('suppsLast', false))
    .then((v) => { settings.suppsLast = v === true; })
    .then(() => store.getSetting('bwUnit', 'kg'))
    .then((u) => { settings.bwUnit = u === 'lb' ? 'lb' : 'kg'; })
    .then(() => store.getSetting('homeChart', null))
    .then((v) => { settings.homeChart = v && typeof v === 'object' && v.tab ? v : null; })
    .then(() => store.getSetting('homeOrder', null))
    .then((v) => { settings.homeOrder = Array.isArray(v) ? v : null; })
    .then(() => store.getSetting('goals', null))
    .then((v) => { settings.goals = sanitizeGoals(v); })
    .then(() => store.getSetting('programs', null))
    .then((v) => {
      programs = Array.isArray(v) ? v.map(sanitizeProgram).filter(Boolean) : [];
    })
    .then(() => store.all())
    .then((rows) => { routines = rows || []; })
    .then(() => {
      try { history.replaceState({ view: { name: 'home' } }, ''); } catch (err) {}
    })
    .then(render)
    .catch((err) => {
      $app.innerHTML = '<div class="card note">Could not open the local database: ' +
        esc(err && err.message) + '</div>';
    });
})();
