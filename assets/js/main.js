/* main.js — language, the live app demo in the hero, and the app views in
   the sections. Markup follows the app's components (src/Widget.tsx,
   src/components/SessionTabs.tsx, src/Toast.tsx, src/components/TodayLog.tsx,
   PokedexView.tsx, LeaderboardView.tsx); the sessions and numbers are made up.
   Pictures come from where the app gets them (server/sprites.js):
   Pokémon HOME art from PokeAPI's sprites, Scarlet/Violet box icons from
   Pokémon Database, ball icons from PokeAPI's item sprites. */
(function () {
  'use strict';

  var LANGS = ['ko', 'en', 'ja'];
  var LANG_KEY = 'spawn-site-lang';
  var OWN_BALL = 'assets/img/poke-ball-dream.png';
  /* The plain Poké Ball (a session before its Pokémon comes out, placeholders): the Dream World ball.
     It is also the fallback when a ball sprite does not load. Balls a Pokémon was caught in stay PokeAPI item sprites. */
  var GENERIC_BALL = OWN_BALL;
  var ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
  var ICON = 'https://img.pokemondb.net/sprites/scarlet-violet/icon';
  var ITEM = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items';
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  // ------------------------------------------------------------------ i18n

  function detectLang() {
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved && LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    var list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i] || '').toLowerCase().slice(0, 2);
      if (LANGS.indexOf(code) >= 0) return code;
    }
    return 'en';
  }

  var lang = detectLang();
  var langListeners = [];
  var LI = function () { return { ko: 0, en: 1, ja: 2 }[lang]; };

  function t(key, vars) {
    var table = STRINGS[lang] || STRINGS.en;
    var s = table[key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    s = s.split('{name}').join(PRODUCT_NAME);
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function node(tag, text, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function h(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  var EXT_ICON = '<svg class="ext-ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/></svg>';

  // The version line and the first-install zip name, from LATEST_VERSION. loading.js asks GitHub for the
  // newest release and sets it through spawnLatest; until then these stand as skeletons
  function versionText(el) {
    if (el.id === 'startZip') return platState() === 'mac-soon' ? t('dl.soon') : zipName(platState() === 'win' ? 'win-x64' : 'mac-arm64');
    return t('cta.version', { v: LATEST_VERSION });
  }
  window.spawnVersionText = versionText;
  window.spawnLatest = function (v) {
    if (!/^\d+\.\d+\.\d+$/.test(v)) return;
    LATEST_VERSION = v;
  };

  // ------------------------------------------------------------------ Mac: which download each button offers
  // os: 'win' (today's behaviour, untouched) or 'mac'. arm / intel: the latest release carries that Mac zip
  // (loading.js reads the GitHub assets list; with no answer, none is assumed and a Mac visitor sees "coming soon").
  // ?os=mac / ?os=win overrides the detection (for testing).
  function detectOS() {
    var m = /[?&]os=(mac|win)(?:&|#|$)/.exec(location.search);
    if (m) return m[1];
    var uad = navigator.userAgentData, ua = navigator.userAgent || '';
    if (uad && uad.platform) return uad.platform === 'macOS' ? 'mac' : 'win';
    if (/iPhone|iPad|iPod/.test(ua)) return 'win';
    if (/Mac/i.test(navigator.platform || '') || /Macintosh|Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'win' : 'mac'; // iPadOS says Macintosh, with a touch screen
    return 'win';
  }
  var PLATFORM = { os: detectOS(), arm: false, intel: false, locked: false };
  function platState() { return PLATFORM.os !== 'mac' ? 'win' : (PLATFORM.arm ? 'mac-ready' : 'mac-soon'); }
  function zipName(kind) { return PRODUCT_NAME + '-' + LATEST_VERSION + '-' + kind + '.zip'; }
  function macUrl(arch) { return SITE_LINKS.repo + '/releases/download/v' + LATEST_VERSION + '/' + zipName('mac-' + arch); }
  // the same text with the Mac wording where there is one (hero note, unzip step, the Mac FAQ answer)
  function platKey(key) {
    if (key === 'faq.a9') return PLATFORM.arm ? 'faq.a9.ready' : key;
    if (PLATFORM.os !== 'mac') return key;
    if (key === 'faq.a3') return 'faq.a3.mac';
    if (key === 'start.s1.p') return PLATFORM.arm ? key : 'start.s1.p.soon';
    if (key === 'hero.note' || key === 'start.s2.p') return key + '.mac';
    return key;
  }
  function exeText() { return PLATFORM.os === 'mac' ? PRODUCT_NAME + '.app' : 'win-unpacked\\' + PRODUCT_NAME + '.exe'; }

  function applyPlatform() {
    var state = platState(), mac = PLATFORM.os === 'mac';
    document.documentElement.setAttribute('data-plat', state);
    // back to the Windows baseline first, so switching platforms leaves nothing behind
    document.querySelectorAll('[data-dl]').forEach(function (a) {
      a.href = SITE_LINKS.releases;
      a.removeAttribute('aria-disabled');
      a.classList.remove('is-soon');
      if (a.hasAttribute('data-was-primary')) { a.classList.remove('btn-ghost'); a.classList.add('btn-primary'); a.removeAttribute('data-was-primary'); }
      var label = a.querySelector('[data-i18n]');
      if (label) label.textContent = t(label.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n'), pk = platKey(k);
      if (pk !== k) el.textContent = t(pk);
    });
    document.querySelectorAll('[data-win-only]').forEach(function (d) { d.hidden = mac; }); // the SmartScreen question is for Windows
    var exe = document.getElementById('startExe');
    if (exe) exe.textContent = exeText();
    var zip = document.getElementById('startZip');
    if (zip) zip.textContent = versionText(zip);
    var note = document.querySelector('[data-mac-note]');
    if (note) { note.hidden = !mac; note.textContent = mac ? t('start.s2.note.mac') : ''; }
    // the quiet second link: Intel Mac when the Mac build is out, Windows while it is not
    document.querySelectorAll('[data-dl-alt]').forEach(function (p) {
      var a = p.querySelector('a');
      var show = mac && (state === 'mac-soon' || PLATFORM.intel);
      p.hidden = !show;
      if (!show) { a.textContent = ''; a.removeAttribute('href'); return; }
      a.textContent = t(state === 'mac-soon' ? 'dl.win' : 'dl.intel');
      a.href = state === 'mac-soon' ? SITE_LINKS.releases : macUrl('x64');
      a.rel = 'noopener';
    });
    if (!mac) return;
    document.querySelectorAll('[data-dl]').forEach(function (a) {
      var kind = a.getAttribute('data-dl'), label = a.querySelector('[data-i18n]');
      if (state === 'mac-ready') {
        a.href = macUrl('arm64');
        if (kind === 'cta' && label) label.textContent = t('cta.download.mac');
        return;
      }
      // coming soon: a calm ghost button that goes nowhere
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.classList.add('is-soon');
      if (a.classList.contains('btn-primary')) { a.classList.remove('btn-primary'); a.classList.add('btn-ghost'); a.setAttribute('data-was-primary', ''); }
      var ico = a.querySelector('.ext-ico'); if (ico) ico.remove();
      if (label) label.textContent = t(kind === 'nav' ? 'nav.soon' : 'cta.soon');
    });
  }
  // loading.js hands over the release's asset list; lab tools may pin the state (locked) to compare the two
  window.spawnMacAssets = function (assets) {
    if (PLATFORM.locked) return;
    var names = (assets || []).map(function (a) { return a && a.name; });
    var was = PLATFORM.arm + '/' + PLATFORM.intel;
    PLATFORM.arm = names.some(function (n) { return /-mac-arm64\.zip$/.test(n); });
    PLATFORM.intel = names.some(function (n) { return /-mac-x64\.zip$/.test(n); });
    if (was !== PLATFORM.arm + '/' + PLATFORM.intel) window.spawnReapply();
  };
  window.spawnSetPlatform = function (o) {
    for (var k in o) PLATFORM[k] = o[k];
    window.spawnReapply();
  };

  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = t('meta.title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
    document.querySelectorAll('[data-name]').forEach(function (el) { el.textContent = PRODUCT_NAME; });
    document.querySelectorAll('[data-link]').forEach(function (el) {
      var href = SITE_LINKS[el.getAttribute('data-link')];
      if (href) { el.href = href; el.rel = 'noopener'; }
    });
    applyPlatform();
    document.querySelectorAll('.lang-seg button').forEach(function (b) {
      var on = b.getAttribute('data-lang') === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('title', STRINGS[b.getAttribute('data-lang')]['lang.name']);
    });
    // Japanese, centred lines: 、 and 。 are full-width with their ink at the left of the box, so a line ending in one
    // carries ~half an em of blank on the right and its ink sits off-centre. Set them half-width (as Japanese display type does).
    if (lang === 'ja') {
      document.querySelectorAll('.hero-head h1, .hero-head .lede, .center h2, .center .lede').forEach(function (el) {
        if (/[、。]/.test(el.textContent)) el.innerHTML = esc(el.textContent).replace(/([、。])/g, '<span class="jp-p">$1</span>');
      });
    }
    // Every text link that leaves the site: light grey, with the external-link mark (buttons keep their look)
    document.querySelectorAll('a[href^="http"]:not(.btn)').forEach(function (a) {
      a.classList.add('ext-link');
      if (!a.querySelector('.ext-ico')) a.insertAdjacentHTML('beforeend', EXT_ICON);
    });
    document.querySelectorAll('[data-version]').forEach(function (el) { el.textContent = versionText(el); });
    langListeners.forEach(function (fn) { fn(); });
    // the fresh text gets its line breaks by meaning again (wrap.js; not there yet on the first run)
    if (window.spawnRewrap) window.spawnRewrap(true);
  }

  window.spawnReapply = applyStatic;

  function setLang(next) {
    if (LANGS.indexOf(next) < 0 || next === lang) return;
    lang = next;
    try { localStorage.setItem(LANG_KEY, next); } catch (e) {}
    applyStatic();
  }

  document.querySelectorAll('.lang-seg button').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); });
  });

  function onLang(fn) { langListeners.push(fn); }

  // ------------------------------------------------------------------ Pokémon data and pictures

  var SP = {};
  SPECIES.forEach(function (r) {
    SP[r[0]] = { id: r[0], ko: r[1], en: r[2], ja: r[3], types: r[4].split(','), tier: r[5], gen: r[6], slug: r[7], h: r[8], w: r[9] };
  });
  function nameOf(id) { var p = SP[id]; return p ? (p[lang] || p.en) : ''; }
  /* The HOME artwork (toasts, the Pokédex) */
  function art(id, shiny) { return ART + '/' + (shiny ? 'shiny/' : '') + id + '.png'; }
  /* The Scarlet/Violet box icon (tabs, party, rows, log, ranking); the HOME picture when there is none */
  function icon(id) { var p = SP[id]; return p && p.slug ? ICON + '/' + p.slug + '.png' : art(id); }
  function ballSrc(b) { return ITEM + '/' + (BALLS[b] ? b : 'poke-ball') + '.png'; }
  function ballName(b) { var n = BALLS[b] || BALLS['poke-ball']; return n[LI()] || n[1]; }
  function natureName(k) { var n = NATURES[k]; return n ? (n[LI()] || n[1]) : ''; }
  function typeName(y) { return t('type.' + y); }

  /* The app crops each icon to its opaque pixels (server/sprites.js fitPng); object-view-box does the same here */
  function viewBox(id) { var b = (typeof ICON_BOX !== 'undefined') && ICON_BOX[id]; return b ? 'inset(' + b.join('px ') + 'px)' : ''; }
  function iconImg(id, cls) {
    var vb = viewBox(id);
    return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + icon(id) + '" data-fb="' + art(id) + '"' + (vb ? ' style="object-fit:contain;object-view-box:' + vb + '"' : '') + ' alt="" loading="lazy">';
  }
  function ballImg(b, size) { return '<img class="pokeball" src="' + ballSrc(b) + '" data-fb="' + OWN_BALL + '" style="object-view-box:inset(6px)" width="' + size + '" height="' + size + '" alt="">'; }
  function plainBall(size) { return '<img class="pokeball" src="' + GENERIC_BALL + '" data-fb="' + OWN_BALL + '" width="' + size + '" height="' + size + '" alt="">'; }
  function setIcon(img, id) { img.removeAttribute('data-retried'); img.style.objectViewBox = id ? viewBox(id) : ''; img.style.objectFit = 'contain'; img.src = id ? icon(id) : GENERIC_BALL; img.setAttribute('data-fb', id ? art(id) : OWN_BALL); }

  // A picture that does not load falls back once (icon → HOME art, ball → the app's own ball drawing)
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    // A busy moment on the picture host: try once more a little later, then the fallback
    if (!img.hasAttribute('data-retried') && /^https:/.test(img.src)) {
      img.setAttribute('data-retried', '1');
      var src = img.src;
      setTimeout(function () { img.src = src + (src.indexOf('?') < 0 ? '?r=1' : '&r=1'); }, 900);
      return;
    }
    var fb = img.getAttribute('data-fb');
    if (fb && img.getAttribute('src') !== fb) { img.removeAttribute('data-fb'); img.removeAttribute('data-retried'); img.style.objectViewBox = ''; img.src = fb; }
  }, true);

  // ------------------------------------------------------------------ shared pieces

  function tokensK(n) { return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); }
  function hpTone(left) { return left <= 20 ? 'hp-red' : left <= 50 ? 'hp-yellow' : 'hp-green'; }
  function moodKey(m) { return m === 'working' ? 'app.working' : m === 'needs-you' ? 'app.needs' : 'app.idle'; }
  function place(town, terrain, night) {
    return t('app.place.wild', { town: town, where: t('terrain.' + terrain) }) + (night ? t('app.night') : '');
  }
  function withName(key, nameHtml, vars) {
    var v = vars || {};
    v.mon = '\u0000';
    return esc(t(key, v)).replace('\u0000', nameHtml);
  }

  /* One session row of the party card (Widget.tsx), kept as live references */
  function makeRow(s) {
    var row = h(
      '<div class="w-row">' +
        '<span class="w-glint" aria-hidden="true"></span>' +
        '<div class="w-row-head">' +
          '<img class="w-row-mon" alt="">' +
          '<div class="w-row-line1"><span class="w-row-name"></span><span class="w-pill"></span></div>' +
          '<div class="w-row-line2"><span class="w-row-lv"></span><span class="w-row-meta"><span class="w-row-project"></span></span></div>' +
        '</div>' +
        '<div class="w-row-bottom"><span class="w-hp-label">HP</span><div class="w-ctx w-hp"><span></span></div><span class="w-row-model"></span><span class="w-row-num"></span></div>' +
      '</div>');
    var meta = row.querySelector('.w-row-meta');
    if (s.tool) meta.appendChild(node('span', s.tool, 'w-row-tool'));
    if (s.branch) meta.appendChild(node('span', s.branch, 'w-row-branch'));
    s.ui = {
      row: row,
      img: row.querySelector('.w-row-mon'),
      name: row.querySelector('.w-row-name'),
      pill: row.querySelector('.w-pill'),
      lv: row.querySelector('.w-row-lv'),
      project: row.querySelector('.w-row-project'),
      hp: row.querySelector('.w-hp'),
      hpBar: row.querySelector('.w-hp span'),
      model: row.querySelector('.w-row-model'),
      num: row.querySelector('.w-row-num')
    };
    updateRow(s);
    return row;
  }

  function updateRow(s) {
    var u = s.ui; if (!u) return;
    u.row.className = 'w-row mood-' + s.mood + (s.chosen ? ' chosen' : '');
    if (u.img.getAttribute('data-dex') !== String(s.dex || 0)) { setIcon(u.img, s.dex); u.img.setAttribute('data-dex', String(s.dex || 0)); }
    u.img.title = s.dex ? nameOf(s.dex) : '';
    u.name.textContent = s.titleKey ? t(s.titleKey) : s.title;
    u.pill.className = 'w-pill mood-' + s.mood;
    u.pill.textContent = t(moodKey(s.mood));
    u.lv.textContent = s.dex ? 'Lv.' + s.lv : '';
    u.project.textContent = s.project;
    u.hp.className = 'w-ctx w-hp ' + hpTone(s.hp);
    u.hpBar.style.width = Math.max(0, Math.min(100, s.hp)) + '%';
    u.hp.setAttribute('title', t('app.hp'));
    u.model.textContent = s.model;
    u.num.textContent = tokensK(Math.round(s.ctx * s.hp / 100));
  }

  /* A limit row of the usage card */
  function makeLimit(labelKey, value, reset) {
    var el = h('<div class="w-limit"><span class="w-label"></span><div class="w-bar"><span></span></div><span class="w-limit-pct"><b></b><small>%</small></span><span class="w-limit-reset"></span></div>');
    el.querySelector('.w-label').setAttribute('data-k', labelKey);
    setLimit(el, value);
    el.querySelector('.w-limit-reset').textContent = reset ? '↻ ' + reset : '';
    return el;
  }
  function setLimit(el, value) {
    el.className = 'w-limit tone-' + (value >= 80 ? 'warn' : 'ok');
    el.querySelector('.w-bar span').style.width = Math.max(2, Math.min(100, value)) + '%';
    el.querySelector('.w-limit-pct b').textContent = Math.round(value);
  }
  function labelLimits(root) {
    root.querySelectorAll('.w-limit .w-label[data-k]').forEach(function (l) { l.textContent = t(l.getAttribute('data-k')); });
  }

  /* The notification card (Toast.tsx ToastCard) */
  function toastCard(e) {
    var kindKey = { catch: 'app.caught', flee: 'app.fled', levelup: 'app.levelup', evolve: 'app.evolved' }[e.kind];
    var tier = e.tier || (SP[e.id] && SP[e.id].tier) || 'common';
    var head = '';
    if (e.daily) head += '<span class="w-toast-badge">' + esc(t('app.daily')) + '</span>';
    head += '<span class="w-toast-kind">' + esc(t(kindKey)) + '</span>';
    if (e.kind !== 'levelup') head += '<span class="w-toast-tier">' + esc(t('tier.' + tier)) + '</span>';
    if (e.isNew) head += '<span class="w-toast-new">NEW</span>';
    var title = e.kind === 'evolve'
      ? esc(nameOf(e.from)) + ' <span class="w-toast-arrow">→</span> ' + esc(nameOf(e.id))
      : (e.shiny ? '✦ ' : '') + esc(nameOf(e.id));
    if ((e.kind === 'catch' || e.kind === 'levelup') && e.level) title += '<small>Lv.' + e.level + '</small>';
    var meta = '';
    var where = e.kind === 'catch' || e.kind === 'flee' ? [e.nature ? natureName(e.nature) : '', e.place || ''].filter(Boolean).join(' · ') : '';
    if ((e.kind === 'catch' && e.ball) || where) {
      meta = '<div class="w-toast-meta">' +
        (e.kind === 'catch' && e.ball ? '<span class="w-toast-ball">' + ballImg(e.ball, 14) + esc(ballName(e.ball)) + '</span>' : '') +
        (where ? '<span class="w-toast-place">' + esc(where) + '</span>' : '') + '</div>';
    }
    var via = e.via && e.kind === 'catch' ? '<div class="w-toast-via">' + esc(t('app.viaCatch', { how: e.via })) + '</div>' : '';
    return h('<div class="w-toast kind-' + e.kind + ' tier-' + tier + (e.shiny ? ' shiny' : '') + '" role="status">' +
      '<div class="w-toast-art"><img src="' + art(e.id, e.shiny) + '" alt=""></div>' +
      '<div class="w-toast-text"><div class="w-toast-eyebrow">' + head + '</div>' +
      '<div class="w-toast-title">' + title + '</div>' + meta + via + '</div></div>');
  }

  // ------------------------------------------------------------------ the hero demo

  var app = document.getElementById('app');
  var els = {
    rows: document.getElementById('rows'),
    tabs: document.getElementById('tabs'),
    term: document.getElementById('term'),
    slots: document.getElementById('partySlots'),
    dexCount: document.getElementById('dexCount'),
    dexRecent: document.getElementById('dexRecent'),
    dexNew: document.getElementById('dexNew'),
    viewNew: document.getElementById('viewNew'),
    toast: document.getElementById('toastSlot'),
    lim5: document.getElementById('lim5'),
    limW: document.getElementById('limW'),
    toggle: document.getElementById('demoToggle')
  };

  // The party: Charmander, Pikachu, Eevee, Gastly, Dratini, Snorlax
  var PARTY = [4, 25, 133, 92, 147, 143];
  var demo = {
    sessions: [], shown: null, party: PARTY.slice(),
    dex: 0, recent: [10, 41, 74, 63, 1],
    lim5: 31, limW: 46,
    userPaused: false, inView: true
  };

  function running() { return !demo.userPaused && demo.inView && !document.hidden; }
  function wait(ms) {
    return new Promise(function (resolve) {
      var left = ms;
      (function tick() {
        setTimeout(function () { if (running()) left -= 100; if (left <= 0) resolve(); else tick(); }, 100);
      })();
    });
  }

  function newSession(o) {
    var s = { id: o.id, title: o.title || '', titleKey: o.titleKey || null, project: o.project, branch: o.branch || null, tool: o.tool || null,
      model: o.model, dex: o.dex || 0, lv: o.lv || 5, mood: o.mood || 'idle', hp: o.hp == null ? 100 : o.hp, ctx: o.ctx || 200000, chosen: false, lines: [] };
    demo.sessions.push(s);
    els.rows.appendChild(makeRow(s));
    s.tab = h('<span class="w-sess-tab"><img alt=""><span class="w-sess-tab-name"></span><span class="w-sess-tab-dot"></span></span>');
    els.tabs.appendChild(s.tab);
    updateTab(s);
    renderSlots();
    return s;
  }

  function updateTab(s) {
    s.tab.className = 'w-sess-tab mood-' + s.mood + (demo.shown === s ? ' on' : '');
    var img = s.tab.querySelector('img');
    if (img.getAttribute('data-dex') !== String(s.dex || 0)) { setIcon(img, s.dex); img.setAttribute('data-dex', String(s.dex || 0)); }
    img.title = s.dex ? nameOf(s.dex) : '';
    s.tab.querySelector('.w-sess-tab-name').textContent = s.titleKey ? t(s.titleKey) : s.title;
  }

  function update(s) { updateRow(s); updateTab(s); }

  function removeSession(s) {
    demo.sessions = demo.sessions.filter(function (x) { return x !== s; });
    if (s.ui) s.ui.row.remove();
    s.tab.remove();
    renderSlots();
  }

  function show(s) {
    demo.shown = s;
    demo.sessions.forEach(function (x) { x.chosen = x === s; updateRow(x); updateTab(x); });
    renderTerm();
  }

  function renderSlots() {
    var out = demo.sessions.map(function (s) { return s.dex; });
    els.slots.innerHTML = demo.party.map(function (id) {
      return '<span class="w-party-mon' + (out.indexOf(id) >= 0 ? ' out' : '') + '" title="' + esc(nameOf(id)) + '">' + iconImg(id) + '</span>';
    }).join('');
  }

  function renderDex() {
    els.dexCount.textContent = demo.dex;
    els.dexRecent.innerHTML = demo.recent.slice(0, 5).map(function (id) { return iconImg(id); }).join('');
  }

  function renderLimits() { setLimit(els.lim5, demo.lim5); setLimit(els.limW, demo.limW); }

  // --- terminal: each session keeps its own lines (keys, so a language change redraws them)
  function lineEl(l) {
    var d = node('div', undefined, 'ln ' + (l.cls || ''));
    if (l.cls === 'ln-gap') return d;
    if (l.html) d.innerHTML = l.html;
    else d.textContent = l.key ? t(l.key) : l.text;
    return d;
  }
  function renderTerm() {
    els.term.textContent = '';
    var s = demo.shown; if (!s) return;
    s.lines.slice(-40).forEach(function (l) { var d = lineEl(l); d.style.animation = 'none'; els.term.appendChild(d); });
  }
  function push(s, l) {
    s.lines.push(l);
    if (demo.shown === s) {
      els.term.appendChild(lineEl(l));
      while (els.term.children.length > 40) els.term.removeChild(els.term.firstChild);
    }
  }

  // --- notifications, one at a time, as the toast window does
  var toastTimer = null;
  function toast(e) {
    clearTimeout(toastTimer);
    els.toast.textContent = '';
    var card = toastCard(e);
    els.toast.appendChild(card);
    toastTimer = setTimeout(function () {
      card.classList.add('leaving');
      toastTimer = setTimeout(function () { card.remove(); }, reduceMotion ? 0 : 350);
    }, e.kind === 'levelup' ? 2600 : 4600);
  }

  // --- what a step does
  function step(s, terrain, extra) {
    s.hp = Math.max(14, s.hp - (2 + Math.round(Math.random() * 2)));
    demo.lim5 = Math.min(96, demo.lim5 + 0.5);
    demo.limW = Math.min(96, demo.limW + 0.1);
    renderLimits();
    update(s);
    if (!extra) return Promise.resolve();
    return wait(700).then(function () {
      if (extra.encounter) {
        var e = extra.encounter;
        e.place = place(s.project, terrain, false);
        toast(e);
        if (e.kind === 'catch') {
          demo.dex++;
          demo.recent.unshift(e.id);
          renderDex();
          els.dexNew.hidden = false; els.viewNew.hidden = false;
        }
        return null;
      }
      if (extra.levelup) {
        s.lv++;
        update(s);
        toast({ kind: 'levelup', id: s.dex, level: s.lv });
        if (!extra.evolveTo) return null;
        // Evolution happens on a level-up (server/pokedex.js evolutionFor)
        return wait(2900).then(function () {
          var from = s.dex;
          s.dex = extra.evolveTo;
          demo.party = demo.party.map(function (id) { return id === from ? s.dex : id; });
          update(s); renderSlots();
          toast({ kind: 'evolve', from: from, id: s.dex });
        });
      }
      return null;
    });
  }

  function typePrompt(s, key) {
    var l = { cls: 't-prompt', key: key };
    s.lines.push({ cls: 'ln-gap' });
    if (demo.shown === s) els.term.appendChild(lineEl({ cls: 'ln-gap' }));
    s.lines.push(l);
    if (demo.shown !== s || reduceMotion) { if (demo.shown === s) els.term.appendChild(lineEl(l)); return wait(500); }
    var d = node('div', '', 'ln t-prompt');
    els.term.appendChild(d);
    var full = t(key), i = 0;
    return new Promise(function (resolve) {
      (function next() {
        if (!running()) return setTimeout(next, 120);
        i = Math.min(full.length, i + 2);
        d.textContent = full.slice(0, i);
        if (i >= full.length) return setTimeout(resolve, 380);
        setTimeout(next, 45);
      })();
    });
  }

  function tool(s, name, arg, result, terrain, extra) {
    push(s, { cls: 't-tool', html: '<b>' + esc(name) + '</b>(' + esc(arg) + ')' });
    return wait(650).then(function () {
      push(s, { cls: 't-res', text: result });
      return step(s, terrain, extra);
    }).then(function () { return wait(900); });
  }

  function say(s, key) { push(s, { cls: 't-say', key: key }); return wait(400); }
  function mood(s, m) { s.mood = m; update(s); }

  var a, b, d;
  function setup() {
    els.rows.textContent = ''; els.tabs.textContent = '';
    demo.sessions = [];
    demo.party = PARTY.slice();
    a = newSession({ id: 'a', title: 'header-copy', project: 'spawn-site', branch: 'main', model: 'Opus', dex: 4, lv: 15, mood: 'idle', hp: 84, ctx: 200000 });
    b = newSession({ id: 'b', title: 'rank-api', project: 'server', branch: 'feat/rank', tool: 'Codex', model: 'gpt-5-codex', dex: 25, lv: 9, mood: 'working', hp: 63, ctx: 272000 });
    d = newSession({ id: 'd', title: 'migrate-db', project: 'server', branch: 'chore/db', model: 'Sonnet', dex: 143, lv: 23, mood: 'needs-you', hp: 24, ctx: 200000 });
    a.lines = [{ cls: 't-status', text: 'claude --session-id 7f3a… ' }];
    b.lines = []; d.lines = [];
    show(a);
    renderDex(); renderLimits();
  }

  async function cycle() {
    setup();
    await wait(900);
    await typePrompt(a, 'term.prompt1');
    mood(a, 'working');
    await wait(500);
    await tool(a, 'Read', 'src/Header.tsx', 'Read 48 lines', 'forest');
    step(b, 'cave');
    await tool(a, 'Glob', 'src/**/*.css', 'Found 7 files', 'forest');
    await tool(a, 'Grep', '"hero-title"', 'Found 3 files', 'forest');
    await tool(a, 'Edit', 'src/Header.tsx', 'Updated with 3 additions and 2 removals', 'grass',
      { encounter: { kind: 'catch', id: 43, level: 8, ball: 'great-ball', nature: 'gentle', via: 'Edit', isNew: true } });
    step(b, 'grass');
    await tool(a, 'Edit', 'src/Hero.tsx', 'Updated with 1 addition', 'grass');
    await tool(a, 'Write', 'src/hero.test.tsx', 'Wrote 36 lines', 'grass');
    // the Codex session meets one too (its own toast, while Charmander's terminal stays on screen)
    step(b, 'plant', { encounter: { kind: 'catch', id: 81, level: 14, ball: 'quick-ball', nature: 'jolly', via: 'mcp__github', isNew: true } });
    await wait(2600);
    // Charmander reaches Lv.16 and evolves into Charmeleon
    await tool(a, 'Bash', 'npm test', 'Tests  24 passed (24)', 'cave', { levelup: true, evolveTo: 5 });
    await say(a, 'term.reply1');
    mood(a, 'idle');
    await wait(2400);

    // a new session: its Pokémon is there from the start
    var c = newSession({ id: 'c', titleKey: 'app.newTab', project: 'spawn-site', branch: 'fix/login', model: 'Opus', dex: 133, lv: 12, mood: 'idle', hp: 100, ctx: 200000 });
    c.lines = [{ cls: 't-status', text: 'claude --session-id 2c91… ' }];
    show(c); renderSlots();
    await wait(1700);
    await typePrompt(c, 'term.prompt2');
    c.titleKey = null; c.title = 'login-bug';
    mood(c, 'working');
    await tool(c, 'Read', 'src/auth/session.ts', 'Read 112 lines', 'forest');
    step(b, 'cave');
    await tool(c, 'Bash', 'rg "refreshToken" src', 'src/auth/token.ts:41', 'cave',
      { encounter: { kind: 'flee', id: 95 } });
    await tool(c, 'WebSearch', '"oauth refresh token rotation"', 'Did 1 search', 'sky',
      { encounter: { kind: 'catch', id: 16, level: 6, ball: 'poke-ball', nature: 'hardy', via: 'WebSearch' } });
    step(b, 'grass');
    await tool(c, 'Read', 'src/auth/token.ts', 'Read 64 lines', 'forest');
    await tool(c, 'Agent', 'check every caller of refresh()', 'Done (5 tool uses)', 'safari');
    await say(c, 'term.reply2');
    mood(c, 'idle'); mood(b, 'idle');
    await wait(3600);
    removeSession(c);
    els.dexNew.hidden = true; els.viewNew.hidden = true;
    demo.recent = demo.recent.slice(0, 6);
  }

  async function loop() { for (;;) { await cycle(); } }

  if (app) {
    onLang(function () {
      demo.sessions.forEach(function (s) { updateRow(s); updateTab(s); });
      renderSlots();
      renderTerm();
      els.toggle.textContent = t(demo.userPaused ? 'demo.play' : 'demo.pause');
    });
    els.toggle.addEventListener('click', function () {
      demo.userPaused = !demo.userPaused;
      els.toggle.setAttribute('aria-pressed', demo.userPaused ? 'true' : 'false');
      els.toggle.textContent = t(demo.userPaused ? 'demo.play' : 'demo.pause');
    });
    try {
      new IntersectionObserver(function (entries) { demo.inView = entries[0].isIntersecting; }, { threshold: 0.15 }).observe(app);
    } catch (e) {}
  }

  // ------------------------------------------------------------------ the Pokédex (PokedexView.tsx)

  /* Sample save: who is caught, who was only seen. Made up, but the same on every load. */
  function hash(id) { var x = Math.imul(id, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) % 1000; }
  var FORCE_CAUGHT = [1, 4, 5, 10, 16, 25, 41, 43, 63, 74, 81, 92, 130, 133, 143, 147];
  var FORCE_SEEN = [95, 144];
  // Shiny picks: Gyarados (red) and Zubat (green). Eevee was shiny here before, and shiny Eevee's HOME art is silver-white, which read as "faded" in the detail card
  var SHINY = [130, 41];
  var NEW_CAUGHT = [43, 92];
  var PARTY_DEX = [5, 25, 133, 92, 147, 143];
  var WORKING_DEX = [5, 25];
  var TERRAINS = ['grass', 'cave', 'forest', 'sky', 'safari', 'plant'];
  var VIA = { grass: 'Edit', cave: 'Bash', forest: 'Read', sky: 'WebSearch', safari: 'Agent', plant: 'mcp__github' };
  var PROJECTS = ['spawn-site', 'server', 'dotfiles'];
  var NATURE_KEYS = Object.keys(NATURES);
  var BALL_POOL = ['poke-ball', 'poke-ball', 'poke-ball', 'great-ball', 'great-ball', 'ultra-ball', 'dusk-ball', 'net-ball', 'quick-ball', 'premier-ball', 'repeat-ball', 'timer-ball', 'luxury-ball', 'friend-ball', 'nest-ball'];
  var CUT = { 1: 520, 2: 300, 3: 240, 4: 220, 5: 170, 6: 160, 7: 150, 8: 140, 9: 130 };
  var caught = {}, seen = {};
  SPECIES.forEach(function (r) {
    var id = r[0], p = SP[id], hv = hash(id);
    var legend = p.tier === 'legendary' || p.tier === 'mythical';
    var cut = p.tier === 'sub' ? 60 : CUT[p.gen] || 150;
    var isCaught = FORCE_CAUGHT.indexOf(id) >= 0 || (!legend && FORCE_SEEN.indexOf(id) < 0 && hv < cut);
    var isSeen = !isCaught && (FORCE_SEEN.indexOf(id) >= 0 || (!legend && hv < cut + 160));
    if (isCaught) {
      var terrain = TERRAINS[hv % 6];
      var how = id === 4 ? 'starter' : id === 5 ? 'evolve' : id === 1 ? 'attendance' : 'wild';
      var count = 1 + (hv % 4 === 0 ? 1 : 0) + (hv % 9 === 0 ? 1 : 0);
      if (id === 133) count = 2;
      var day = new Date(2026, 8, 1 + (hv % 70), 9 + (hv % 12), (hv * 7) % 60);
      var mons = [];
      for (var i = 0; i < count; i++) {
        var hv2 = hash(id * 31 + i);
        mons.push({ lv: 5 + (hv2 % 38), nature: NATURE_KEYS[hv2 % NATURE_KEYS.length], ball: BALL_POOL[hv2 % BALL_POOL.length], steps: (hv2 * 3) % 900,
          shiny: SHINY.indexOf(id) >= 0 && i === 0, party: i === 0 && PARTY_DEX.indexOf(id) >= 0, working: i === 0 && WORKING_DEX.indexOf(id) >= 0, via: how === 'wild' ? VIA[terrain] : '' });
      }
      caught[id] = { count: count, shiny: SHINY.indexOf(id) >= 0, how: how, terrain: terrain, night: hv % 5 === 0, project: PROJECTS[hv % 3], first: day, mons: mons };
    } else if (isSeen) {
      seen[id] = 1 + (hv % 4);
    }
  });

  var dexView = { gen: 1, show: 'all', tiers: [], query: '', pick: 25 }; // tiers: several at once, none = all (as the app)
  var opened = {};

  function pad3(n) { return 'No.' + String(n).padStart(3, '0'); }
  function dateText(d) { return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function num(n) { try { return n.toLocaleString(lang); } catch (e) { return String(n); } }

  function stat(label, value, total, hint) {
    var pct = total ? Math.min(100, value / total * 100) : 0;
    return '<div class="dex-stat"' + (hint ? ' title="' + esc(hint) + '"' : '') + '><span class="dex-stat-label">' + esc(label) + '</span>' +
      '<span class="dex-stat-value"><b>' + num(value) + '</b><small> / ' + num(total) + '</small></span>' +
      '<span class="dex-stat-bar"><i style="width:' + pct + '%"></i></span><span class="dex-stat-pct">' + pct.toFixed(1) + '%</span></div>';
  }

  function dexList() {
    var q = dexView.query.trim().toLowerCase();
    return SPECIES.filter(function (r) {
      var p = SP[r[0]];
      if (dexView.gen && p.gen !== dexView.gen) return false;
      if (dexView.tiers.length && dexView.tiers.indexOf(p.tier) < 0) return false;
      if (dexView.show === 'caught' && !caught[p.id]) return false;
      if (dexView.show === 'missing' && caught[p.id]) return false;
      if (q) {
        var known = caught[p.id] || seen[p.id];
        var byNo = String(p.id) === q.replace(/^no\.?0*/, '');
        var byName = known && (p.ko.toLowerCase().indexOf(q) >= 0 || p.en.toLowerCase().indexOf(q) >= 0 || p.ja.indexOf(q) >= 0);
        if (!byNo && !byName) return false;
      }
      return true;
    }).map(function (r) { return SP[r[0]]; });
  }

  function renderDexStats() {
    var statsEl = document.getElementById('dexStats');
    var total = SPECIES.length;
    var caughtN = Object.keys(caught).length, seenN = caughtN + Object.keys(seen).length;
    var boxN = Object.keys(caught).reduce(function (n, id) { return n + caught[id].count; }, 0) - 6;
    var tiers = ['common', 'rare', 'sub', 'legendary', 'mythical'].map(function (k) {
      var all = SPECIES.filter(function (r) { return r[5] === k; });
      var c = all.filter(function (r) { return caught[r[0]]; }).length;
      return '<div class="dex-tiercol tier-' + k + '"><span>' + esc(t('tier.' + k)) + '</span><em>' + c + '<small> / ' + all.length + '</small></em><i><b style="width:' + (all.length ? c / all.length * 100 : 0) + '%"></b></i></div>';
    }).join('');
    statsEl.innerHTML = stat(t('dex.statCaught'), caughtN, total) + stat(t('dex.statSeen'), seenN, total, t('dex.seenHint')) + stat(t('dex.statBox'), boxN, 1200) +
      '<div class="dex-stat dex-stat-tiers"><div class="dex-tiers">' + tiers + '</div></div>';
  }

  function renderDexFilters() {
    var f = document.getElementById('dexFilters');
    var gens = '<button type="button" data-gen="0" class="' + (!dexView.gen ? 'on' : '') + '">' + esc(t('dex.all')) + '</button>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (g) { return '<button type="button" data-gen="' + g + '" class="' + (dexView.gen === g ? 'on' : '') + '" title="' + esc(t('dex.genN', { n: g })) + '">' + g + '</button>'; }).join('');
    var shows = [['all', 'dex.all'], ['caught', 'dex.caughtOnly'], ['missing', 'dex.missing']].map(function (s) {
      return '<button type="button" data-show="' + s[0] + '" class="' + (dexView.show === s[0] ? 'on' : '') + '">' + esc(t(s[1])) + '</button>';
    }).join('');
    var tiers = ['common', 'rare', 'sub', 'legendary', 'mythical'].map(function (k) {
      return '<button type="button" data-tier="' + k + '" class="tier-' + k + (dexView.tiers.indexOf(k) >= 0 ? ' on' : '') + '" aria-pressed="' + (dexView.tiers.indexOf(k) >= 0) + '">' + esc(t('tier.' + k)) + '</button>';
    }).join('');
    var keepFocus = document.activeElement && document.activeElement.id === 'dexQuery';
    f.innerHTML =
      '<div class="dex-fgroup"><span class="dex-flabel">' + esc(t('dex.gen')) + '</span><div class="dex-seg">' + gens + '</div></div>' +
      '<div class="dex-fgroup"><span class="dex-flabel">' + esc(t('dex.show')) + '</span><div class="dex-seg">' + shows + '</div></div>' +
      '<div class="dex-fgroup"><span class="dex-flabel">' + esc(t('dex.tier')) + '</span><div class="dex-chips">' + tiers + '</div></div>' +
      '<div class="dex-fgroup dex-fsearch"><input id="dexQuery" value="' + esc(dexView.query) + '" placeholder="' + esc(t('dex.search')) + '" aria-label="' + esc(t('dex.searchAria')) + '"><span class="dex-result" id="dexResult"></span></div>';
    if (keepFocus) { var q = document.getElementById('dexQuery'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function renderDexGrid() {
    var grid = document.getElementById('dexGrid');
    var list = dexList();
    document.getElementById('dexResult').textContent = t('dex.count', { n: list.length });
    var pickInList = list.some(function (p) { return p.id === dexView.pick; });
    grid.innerHTML = list.map(function (p, i) {
      var c = caught[p.id], s = seen[p.id];
      var cls = c ? 'caught' : s ? 'seen' : 'unknown';
      var tab = (dexView.pick === p.id || (i === 0 && !pickInList)) ? 0 : -1;
      return '<button type="button" role="listitem" data-id="' + p.id + '" tabindex="' + tab + '" class="dex-cell ' + cls + ' tier-' + p.tier + (dexView.pick === p.id ? ' picked' : '') + '" title="' + esc(c || s ? pad3(p.id) + ' ' + nameOf(p.id) : pad3(p.id)) + '">' +
        (cls !== 'unknown' ? '<img src="' + art(p.id, c && c.shiny) + '" alt="" loading="lazy" draggable="false">' : '<span class="dex-q">?</span>') +
        '<span class="dex-no">' + p.id + '</span>' +
        (c && c.shiny ? '<span class="dex-shiny">✦</span>' : '') +
        (c && c.count > 1 ? '<span class="dex-count">×' + c.count + '</span>' : '') +
        (c && NEW_CAUGHT.indexOf(p.id) >= 0 && !opened[p.id] ? '<span class="dex-new" aria-label="' + esc(t('dex.newCaught')) + '"></span>' : '') +
        '</button>';
    }).join('') + (list.length ? '' : '<div class="dex-empty">' + esc(t('dex.empty')) + '</div>');
  }

  function howText(how) { return t({ starter: 'how.starter', evolve: 'how.evolve', attendance: 'how.attendance' }[how] || 'how.wild'); }

  function renderDexDetail() {
    var aside = document.getElementById('dexDetail');
    var p = SP[dexView.pick];
    if (!p) { aside.innerHTML = ''; return; }
    var dc = caught[p.id], ds = seen[p.id], tx = SPECIES_TEXT[p.id];
    var html = '<div class="dex-card tier-' + p.tier + '">' +
      '<div class="dex-card-art">' + (dc || ds ? '<img src="' + art(p.id, dc && dc.shiny) + '" alt="' + esc(nameOf(p.id)) + '"' + (dc ? '' : ' class="silhouette"') + '>' : '<span class="dex-q big">?</span>') + '</div>' +
      '<div class="dex-card-no">' + pad3(p.id) + ' · ' + esc(t('dex.genN', { n: p.gen })) + '</div>' +
      '<div class="dex-card-name">' + (dc ? iconImg(p.id, 'dex-card-icon') : '') + esc(dc || ds ? nameOf(p.id) : '???') + ' ' + (dc && lang !== 'en' ? '<span class="dex-card-en">' + esc(p.en) + '</span>' : '') + '</div>';
    if (dc || ds) {
      html += '<div class="dex-card-tags"><span class="dex-tier tier-' + p.tier + '">' + esc(t('tier.' + p.tier)) + '</span>' +
        p.types.map(function (y) { return '<span class="dex-type type-' + y + '">' + esc(typeName(y)) + '</span>'; }).join('') + '</div>';
    }
    if (dc) {
      var where = dc.how === 'attendance' ? t('app.place.daily', { town: dc.project }) : dc.how === 'starter' ? '—' : place(dc.project, dc.terrain, dc.night);
      if (tx) html += '<div class="dex-card-genus">' + esc(tx.g[LI()] || tx.g[1] || '') + '</div><p class="dex-card-flavor">' + esc(tx.f[LI()] || tx.f[1] || '') + '</p>';
      html += '<div class="dex-facts">' +
        '<div><span>' + esc(t('fact.height')) + '</span><b>' + (p.h / 10).toFixed(1) + ' m</b></div>' +
        '<div><span>' + esc(t('fact.weight')) + '</span><b>' + (p.w / 10).toFixed(1) + ' kg</b></div>' +
        '<div><span>' + esc(t('fact.times')) + '</span><b>' + esc(t('fact.timesVal', { n: dc.count })) + '</b></div>' +
        '<div><span>' + esc(t('fact.how')) + '</span><b>' + esc(howText(dc.how)) + (dc.shiny ? ' · ✦' : '') + '</b></div>' +
        '<div class="wide"><span>' + esc(t('fact.caughtAt')) + '</span><b>' + esc(where) + '</b></div>' +
        '<div class="wide"><span>' + esc(t('fact.first')) + '</span><b>' + dateText(dc.first) + '</b></div>' +
        (dc.how === 'wild' ? '<div class="wide"><span>' + esc(t('fact.via')) + '</span><b>' + esc(t('app.viaCatch', { how: VIA[dc.terrain] })) + '</b></div>' : '') +
        '</div>';
      html += '<div class="dex-owned"><div class="dex-owned-title">' + esc(t('dex.owned', { n: dc.mons.length })) + '</div>' +
        dc.mons.map(function (m) {
          return '<div class="dex-owned-row"><div class="dex-owned-top">' + ballImg(m.ball, 14) +
            '<span class="dex-lv">Lv.' + m.lv + '</span><b>' + (m.shiny ? '✦ ' : '') + esc(nameOf(p.id)) + '</b>' +
            '<span class="dex-nature">' + esc(natureName(m.nature)) + '</span></div>' +
            '<div class="dex-owned-sub">' + esc(t(m.party ? 'app.party' : 'app.box')) + (m.working ? ' · ' + esc(t('app.working')) : '') + ' · ' + esc(t('fact.stepsVal', { n: m.steps })) +
            (m.via ? ' · ' + esc(t('app.viaCatch', { how: m.via })) : '') + '</div></div>';
        }).join('') + '</div>';
    } else if (ds) {
      html += '<p class="dex-card-flavor muted">' + esc(t('dex.seenOnly', { n: ds })) + '</p>';
    } else {
      html += '<p class="dex-card-flavor muted">' + esc(t('dex.unknown')) + '</p>';
    }
    aside.innerHTML = html + '</div>';
  }

  function renderDexAll() { renderDexStats(); renderDexFilters(); renderDexGrid(); renderDexDetail(); }

  (function () {
    var grid = document.getElementById('dexGrid');
    var filters = document.getElementById('dexFilters');
    if (!grid) return;
    function pick(id, focus) {
      dexView.pick = id;
      if (caught[id]) opened[id] = true;
      renderDexGrid(); renderDexDetail();
      if (focus) { var c = grid.querySelector('[data-id="' + id + '"]'); if (c) c.focus({ preventScroll: false }); }
    }
    grid.addEventListener('click', function (e) {
      var cell = e.target.closest('.dex-cell');
      if (cell) pick(Number(cell.getAttribute('data-id')), true);
    });
    // Arrow keys across the grid (PokedexView.tsx gridStep): one tab stop, arrows move inside it
    grid.addEventListener('keydown', function (e) {
      var cells = grid.querySelectorAll('.dex-cell');
      if (!cells.length) return;
      var cols = 0;
      while (cols < cells.length && cells[cols].offsetTop === cells[0].offsetTop) cols++;
      var stepBy = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -Math.max(1, cols), ArrowDown: Math.max(1, cols), Home: -Infinity, End: Infinity }[e.key];
      if (stepBy === undefined) return;
      e.preventDefault();
      var ids = Array.prototype.map.call(cells, function (c) { return Number(c.getAttribute('data-id')); });
      var at = ids.indexOf(dexView.pick);
      var next = Math.min(ids.length - 1, Math.max(0, (at < 0 ? 0 : at) + stepBy));
      pick(ids[next], true);
    });
    filters.addEventListener('click', function (e) {
      var bt = e.target.closest('button');
      if (!bt) return;
      if (bt.hasAttribute('data-gen')) dexView.gen = Number(bt.getAttribute('data-gen')) || null;
      else if (bt.hasAttribute('data-show')) dexView.show = bt.getAttribute('data-show');
      else if (bt.hasAttribute('data-tier')) {
        var k = bt.getAttribute('data-tier'), at = dexView.tiers.indexOf(k);
        if (at >= 0) dexView.tiers.splice(at, 1); else dexView.tiers.push(k);
      }
      renderDexFilters(); renderDexGrid();
    });
    filters.addEventListener('input', function (e) {
      if (e.target.id !== 'dexQuery') return;
      dexView.query = e.target.value;
      renderDexGrid();
    });
    onLang(renderDexAll);
  })();

  // The hero's dex card starts from the same save
  demo.dex = Object.keys(caught).length - 1;

  // ------------------------------------------------------------------ section demos: a clock that runs only on screen

  /* Each section demo keeps its own clock: it runs while its panel is on screen,
     the tab is visible and the demo is not paused (the hero's pause button stops all of them). */
  function sectionClock(el) {
    var c = { inView: false };
    c.running = function () { return c.inView && !demo.userPaused && !document.hidden; };
    c.wait = function (ms) {
      return new Promise(function (resolve) {
        var left = ms;
        (function tick() {
          setTimeout(function () { if (c.running()) left -= 100; if (left <= 0) resolve(); else tick(); }, 100);
        })();
      });
    };
    try {
      new IntersectionObserver(function (entries) { c.inView = entries[0].isIntersecting; }, { threshold: 0.2 }).observe(el);
    } catch (e) { c.inView = true; }
    return c;
  }

  function miniTerm(box, lines, max) {
    box.textContent = '';
    lines.slice(-(max || 14)).forEach(function (l) { var d = lineEl(l); d.style.animation = 'none'; box.appendChild(d); });
  }

  // ------------------------------------------------------------------ 세션마다 한 마리: sessions open, one Pokémon each

  (function () {
    var root = document.getElementById('sessDemo');
    if (!root) return;
    var slotsEl = document.getElementById('sessSlots');
    var colsEl = document.getElementById('sessCols');
    var clock = sectionClock(root);
    var party = [4, 25, 133, 92, 147, 143];
    /* Two rounds of three sessions, so the party takes turns (each from the party, each its own project) */
    var ROUNDS = [
      [
        { mon: 4, title: 'header-copy', project: 'spawn-site', branch: 'main', model: 'Opus', lv: 15, hp: 92, sid: '7f3a', prompt: 'term.prompt1', reply: 'term.reply1',
          steps: [['Read', 'src/Header.tsx', 'Read 48 lines'], ['Grep', '"hero-title"', 'Found 3 files'], ['Edit', 'src/Header.tsx', 'Updated with 3 additions'], ['Bash', 'npm test', 'Tests  24 passed (24)']] },
        { mon: 25, title: 'rank-api', project: 'server', branch: 'feat/rank', tool: 'Codex', model: 'gpt-5-codex', lv: 9, hp: 78, ctx: 272000, prompt: 'term.prompt3', reply: 'term.reply3',
          steps: [['Read', 'server/rank.js', 'Read 210 lines'], ['Edit', 'server/rank.js', 'Updated with 18 additions'], ['Bash', 'npm run test:rank', '6 passed']] },
        { mon: 133, title: 'login-bug', project: 'spawn-site', branch: 'fix/login', model: 'Sonnet', lv: 12, hp: 100, sid: '2c91', prompt: 'term.prompt2', reply: 'term.reply2',
          steps: [['Read', 'src/auth/session.ts', 'Read 112 lines'], ['Bash', 'rg "refreshToken" src', 'src/auth/token.ts:41'], ['WebSearch', '"refresh token rotation"', 'Did 1 search'], ['Read', 'src/auth/token.ts', 'Read 64 lines']] }
      ],
      [
        { mon: 92, title: 'pwsh-profile', project: 'dotfiles', branch: 'main', model: 'Haiku', lv: 11, hp: 96, sid: 'e51d', prompt: 'term.prompt4', reply: 'term.reply4',
          steps: [['Read', '.zshrc', 'Read 88 lines'], ['Glob', '**/*.ps1', 'Found 2 files'], ['Write', 'Microsoft.PowerShell_profile.ps1', 'Wrote 41 lines'], ['PowerShell', '. $PROFILE', '(no output)']] },
        { mon: 147, title: 'readme-ja', project: 'spawn', branch: 'docs/ja', tool: 'Codex', model: 'gpt-5-codex', lv: 18, hp: 70, ctx: 272000, prompt: 'term.prompt5', reply: 'term.reply5',
          steps: [['Read', 'README.ja.md', 'Read 302 lines'], ['WebFetch', 'docs.claude.com', 'Received 18 KB'], ['Edit', 'README.ja.md', 'Updated with 22 changes']] },
        { mon: 143, title: 'migrate-db', project: 'server', branch: 'chore/db', model: 'Sonnet', lv: 23, hp: 58, sid: 'b04e', prompt: 'term.prompt6', ask: 'term.ask6',
          steps: [['Read', 'db/migrations/0042.sql', 'Read 37 lines'], ['Bash', 'npm run db:diff', '1 column dropped: users.legacy_id'], ['Grep', '"legacy_id"', 'Found 2 files']] }
      ]
    ];
    var round = 0, live = [];

    function renderSlots() {
      var out = live.map(function (s) { return s.dex; });
      slotsEl.innerHTML = party.map(function (id) {
        return '<span class="w-party-mon' + (out.indexOf(id) >= 0 ? ' out' : '') + '" title="' + esc(nameOf(id)) + '">' + iconImg(id) + '</span>';
      }).join('');
    }
    function pushLine(s, l) { s.lines.push(l); miniTerm(s.term, s.lines); var last = s.term.lastElementChild; if (last && !reduceMotion) last.style.animation = ''; }

    async function run(p, at) {
      var s = { title: '', titleKey: 'app.newTab', project: p.project, branch: p.branch, tool: p.tool || null, model: p.model,
        dex: p.mon, lv: p.lv, mood: 'idle', hp: p.hp, ctx: p.ctx || 200000, chosen: false, lines: [] };
      var col = colsEl.children[at];
      col.textContent = '';
      col.className = 'sess-col open';
      col.appendChild(makeRow(s));
      s.term = node('div', undefined, 'fake-term sess-term');
      col.appendChild(s.term);
      live.push(s); renderSlots();
      pushLine(s, { cls: 't-status', text: p.tool === 'Codex' ? 'codex' : 'claude --session-id ' + p.sid + '… ' });
      await clock.wait(1100);
      // the session takes its name (its Pokémon was there from the start)
      s.titleKey = null; s.title = p.title; updateRow(s);
      await clock.wait(800);
      pushLine(s, { cls: 'ln-gap' });
      pushLine(s, { cls: 't-prompt', key: p.prompt });
      s.mood = 'working'; updateRow(s);
      for (var i = 0; i < p.steps.length; i++) {
        await clock.wait(850);
        var st = p.steps[i];
        pushLine(s, { cls: 't-tool', html: '<b>' + esc(st[0]) + '</b>(' + esc(st[1]) + ')' });
        await clock.wait(550);
        pushLine(s, { cls: 't-res', text: st[2] });
        s.hp = Math.max(18, s.hp - 5 - Math.round(Math.random() * 4)); updateRow(s);
      }
      await clock.wait(700);
      if (p.ask) { pushLine(s, { cls: 't-say', key: p.ask }); s.mood = 'needs-you'; updateRow(s); return; }
      pushLine(s, { cls: 't-say', key: p.reply });
      s.mood = 'idle'; updateRow(s);
    }

    async function cycle() {
      // three empty places, filled one by one (the panel keeps its size while it plays)
      var plan = ROUNDS[round % ROUNDS.length]; round++;
      colsEl.textContent = ''; live = []; renderSlots();
      plan.forEach(function () { var c = node('div', undefined, 'sess-col'); c.appendChild(h('<span class="sess-wait">' + plainBall(22) + '</span>')); colsEl.appendChild(c); });
      await clock.wait(700);
      var runs = [];
      for (var i = 0; i < plan.length; i++) { runs.push(run(plan[i], i)); await clock.wait(2400); }
      await Promise.all(runs);
      await clock.wait(4200);
    }
    onLang(function () { renderSlots(); live.forEach(function (s) { updateRow(s); miniTerm(s.term, s.lines); }); });
    (async function () { for (;;) { await cycle(); } })();
  })();

  // ------------------------------------------------------------------ 도구를 쓰면 한 걸음: tool calls, steps, encounters (starts mid-day)

  (function () {
    var root = document.getElementById('stepDemo');
    if (!root) return;
    var termEl = document.getElementById('stepTerm');
    var trail = document.getElementById('stepTrail');
    var countEl = document.getElementById('stepCount');
    var toastEl = document.getElementById('stepToast');
    var histEl = document.getElementById('stepLog');
    var clock = sectionClock(root);
    var WALKER = 25, walkerLv = 21; // Pikachu: it evolves by stone, so level-ups here never call for an evolution
    /* [tool, argument, result, terrain, encounter?] — terrain follows the tool as the app maps it */
    var PLAN = [
      ['Read', 'src/store.ts', 'Read 140 lines', 'forest'],
      ['Edit', 'src/store.ts', 'Updated with 4 additions', 'grass', { kind: 'catch', id: 43, level: 8, ball: 'great-ball', nature: 'gentle', via: 'Edit', isNew: true }],
      ['Bash', 'npm run lint', '0 problems', 'cave'],
      ['Glob', 'src/**/*.test.ts', 'Found 12 files', 'forest'],
      ['WebFetch', 'nodejs.org/api/fs.html', 'Received 64 KB', 'sky', { kind: 'flee', id: 21 }],
      ['mcp__github', 'create_pull_request', 'PR #128 opened', 'plant', { kind: 'catch', id: 100, level: 13, ball: 'quick-ball', nature: 'hasty', via: 'mcp__github', isNew: true }],
      ['Edit', 'src/api.ts', 'Updated with 9 additions', 'grass'],
      ['Bash', 'npm test', 'Tests  31 passed (31)', 'cave', { kind: 'catch', id: 74, level: 12, ball: 'ultra-ball', nature: 'adamant', via: 'Bash' }],
      ['Agent', 'review the diff', 'Done (6 tool uses)', 'safari', { kind: 'catch', id: 128, level: 20, ball: 'net-ball', nature: 'brave', via: 'Agent', isNew: true }],
      ['Read', 'docs/notes.md', 'Read 52 lines', 'forest', { kind: 'levelup', id: WALKER }],
      ['Write', 'src/cache.ts', 'Wrote 58 lines', 'grass'],
      ['Bash', 'git commit -m "cache"', '1 file changed', 'cave', { kind: 'catch', id: 41, level: 11, ball: 'dusk-ball', nature: 'jolly', via: 'Bash', night: true }],
      ['WebSearch', '"lru cache ttl"', 'Did 1 search', 'sky', { kind: 'catch', id: 147, level: 15, ball: 'great-ball', nature: 'modest', via: 'WebSearch', isNew: true }],
      ['Read', 'src/index.ts', 'Read 33 lines', 'forest']
    ];
    /* Where the day already is when the section first shows */
    var PAST = [
      ['Read', 'README.md', 'Read 88 lines', 'forest'],
      ['Glob', 'src/**/*.tsx', 'Found 23 files', 'forest'],
      ['Bash', 'git status', '2 files changed', 'cave'],
      ['Read', 'src/App.tsx', 'Read 210 lines', 'forest'],
      ['Grep', '"PARTY_SIZE"', 'Found 3 files', 'forest'],
      ['Edit', 'src/config.ts', 'Updated with 1 addition', 'grass'],
      ['Bash', 'npm test', 'Tests  28 passed (28)', 'cave'],
      ['WebSearch', '"react useMemo deps"', 'Did 1 search', 'sky'],
      ['Read', 'package.json', 'Read 61 lines', 'forest'],
      ['Grep', '"useParty"', 'Found 4 files', 'forest'],
      ['Edit', 'src/Party.tsx', 'Updated with 2 additions', 'grass'],
      ['Bash', 'npm run build', 'built in 2.4s', 'cave'],
      ['WebFetch', 'pokeapi.co/docs', 'Received 22 KB', 'sky'],
      ['Edit', 'src/Box.tsx', 'Updated with 1 addition', 'grass']
    ];
    var PAST_TILES = ['grass', 'grass', 'cave', 'forest', 'forest', 'sky', 'grass', 'cave', 'forest', 'grass', 'cave', 'sky'];
    var PAST_HITS = { 2: 1, 8: 1 };
    var PAST_EVENTS = [
      { time: '10:42', kind: 'catch', id: 10, level: 5, ball: 'poke-ball', nature: 'calm', via: 'Read', terrain: 'forest', isNew: true },
      { time: '11:15', kind: 'flee', id: 19, terrain: 'grass' }
    ];
    var lines = [], steps = 37, history = [], minute = 11 * 60 + 40;

    function walker() {
      var w = trail.querySelector('.trail-walker');
      if (!w) { w = node('img', undefined, 'trail-walker'); w.alt = ''; trail.appendChild(w); setIcon(w, WALKER); }
      return w;
    }
    function tile(terrain, hit, quiet) {
      var el = node('span', t('terrain.' + terrain) + (hit ? ' !' : ''), 'trail-tile' + (hit ? ' hit' : ''));
      el.setAttribute('data-terrain', terrain);
      if (hit) el.setAttribute('data-hit', '1');
      if (quiet) el.style.animation = 'none';
      var w = walker();
      trail.insertBefore(el, w);
      var all = trail.querySelectorAll('.trail-tile');
      if (all.length > 12) all[0].remove();
      if (!quiet && !reduceMotion) { w.classList.remove('hop'); void w.offsetWidth; w.classList.add('hop'); }
    }
    function evPlace(e) { return place('spawn-site', e.terrain, e.night); }
    function histRow(e) {
      var tier = SP[e.id].tier;
      var line = withName(e.kind === 'catch' ? 'app.logCatch' : 'app.logFlee', '<b>' + esc(nameOf(e.id)) + '</b>') + (e.kind === 'catch' && e.level ? ' · Lv.' + e.level : '');
      if (e.kind === 'catch' && e.isNew) line += '<span class="today-new">NEW</span>';
      var sub = '<span class="w-toast-tier tier-' + tier + '">' + esc(t('tier.' + tier)) + '</span>' +
        (e.kind === 'catch' ? '<span class="today-ball">' + ballImg(e.ball, 13) + esc(ballName(e.ball)) + '</span>' : '') +
        '<span>' + esc(evPlace(e)) + '</span>';
      return '<div class="today-row kind-' + e.kind + ' tier-' + tier + '"><span class="today-time">' + e.time + '</span>' +
        iconImg(e.id, 'today-icon' + (e.kind === 'flee' ? ' faded' : '')) +
        '<div class="today-text"><span class="today-line">' + line + '</span><span class="today-sub">' + sub + '</span></div></div>';
    }
    function renderHist() {
      histEl.innerHTML = '<div class="today-day">' + esc(t('app.today')) + '</div>' + history.slice(0, 3).map(histRow).join('');
    }
    var current = null;
    function cardFor(e) { var ev = {}; for (var k in e) ev[k] = e[k]; if (ev.kind === 'levelup') { ev.level = walkerLv; } else ev.place = evPlace(e); return ev; }
    function show(e, quiet) {
      // the card on screen moves down into today's list, the new one takes its place
      if (current && current.kind !== 'levelup') { history.unshift(current); if (history.length > 6) history.pop(); renderHist(); }
      current = e;
      toastEl.textContent = '';
      var card = toastCard(cardFor(e));
      if (quiet) card.style.animation = 'none';
      toastEl.appendChild(card);
    }
    // the terminal is as tall as the panel: up to 34 lines, what does not fit is cut at the top
    function push(l) { lines.push(l); if (lines.length > 34) lines.shift(); miniTerm(termEl, lines, 34); var last = termEl.lastElementChild; if (last && !reduceMotion) last.style.animation = ''; }
    function clockText() { minute += 3 + Math.round(Math.random() * 6); var hh = Math.floor(minute / 60) % 24, mm = minute % 60; return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); }

    // start mid-day: steps counted, tool calls in the terminal, a walked trail, earlier encounters
    PAST.forEach(function (p) { lines.push({ cls: 't-tool', html: '<b>' + esc(p[0]) + '</b>(' + esc(p[1]) + ')' }); lines.push({ cls: 't-res', text: p[2] }); });
    miniTerm(termEl, lines, 34);
    walker();
    PAST_TILES.forEach(function (x, i) { tile(x, !!PAST_HITS[i], true); });
    countEl.textContent = num(steps);
    show(PAST_EVENTS[0], true);
    history = [PAST_EVENTS[1]];
    renderHist();

    async function cycle() {
      for (var i = 0; i < PLAN.length; i++) {
        var p = PLAN[i];
        push({ cls: 't-tool', html: '<b>' + esc(p[0]) + '</b>(' + esc(p[1]) + ')' });
        await clock.wait(600);
        push({ cls: 't-res', text: p[2] });
        steps++; countEl.textContent = num(steps);
        var e = p[4];
        tile(p[3], !!(e && e.kind !== 'levelup'));
        if (e) {
          await clock.wait(500);
          var ev = {}; for (var k in e) ev[k] = e[k];
          ev.terrain = p[3]; ev.time = clockText();
          if (ev.kind === 'levelup') walkerLv++;
          show(ev);
          await clock.wait(2600);
        } else clockText();
        await clock.wait(900);
      }
    }
    onLang(function () {
      miniTerm(termEl, lines);
      trail.querySelectorAll('.trail-tile').forEach(function (el) { el.textContent = t('terrain.' + el.getAttribute('data-terrain')) + (el.getAttribute('data-hit') ? ' !' : ''); });
      countEl.textContent = num(steps);
      renderHist();
      if (current) { toastEl.textContent = ''; var c = toastCard(cardFor(current)); c.style.animation = 'none'; toastEl.appendChild(c); }
    });
    (async function () { for (;;) { await cycle(); } })();
  })();

  // ------------------------------------------------------------------ Claude Code and Codex: limits and sessions, ticking

  (function () {
    var limits = document.getElementById('toolLimits');
    var rows = document.getElementById('toolRows');
    if (!limits) return;
    var clock = sectionClock(limits.parentNode);
    var L = [
      { key: 'app.usage5h', v: 42, reset: '15:40' },
      { key: 'app.usageWeek', v: 58, reset: '11/17' },
      { key: 'app.codex5h', v: 17, reset: '16:05' },
      { key: 'app.codexWeek', v: 71, reset: '11/15' }
    ];
    L.forEach(function (x) { x.el = makeLimit(x.key, x.v, x.reset); x.start = x.v; limits.appendChild(x.el); });
    var list = [
      { title: 'header-copy', project: 'spawn-site', branch: 'main', model: 'Opus', dex: 5, lv: 17, mood: 'working', hp: 72, ctx: 200000, claude: true },
      { title: 'rank-api', project: 'server', branch: 'feat/rank', tool: 'Codex', model: 'gpt-5-codex', dex: 25, lv: 10, mood: 'working', hp: 64, ctx: 272000 },
      { title: 'readme-ja', project: 'spawn', branch: 'docs/ja', tool: 'Codex', model: 'gpt-5-codex', dex: 148, lv: 30, mood: 'idle', hp: 47, ctx: 272000 },
      { title: 'migrate-db', project: 'server', branch: 'chore/db', model: 'Sonnet', dex: 143, lv: 23, mood: 'needs-you', hp: 12, ctx: 200000, claude: true, low: true }
    ];
    list.forEach(function (s) {
      s.chosen = false; s.start = s.hp;
      var row = makeRow(s);
      if (s.low) { s.hint = node('div', '', 'hp-hint'); row.appendChild(s.hint); }
      rows.appendChild(row);
    });
    function hints() { list.forEach(function (s) { if (s.hint) s.hint.textContent = t('app.hpHint'); }); }
    labelLimits(limits); hints();
    onLang(function () { labelLimits(limits); list.forEach(updateRow); hints(); });
    (async function () {
      for (var n = 0; ; n++) {
        await clock.wait(1400);
        var who = list[n % 2];
        who.hp = who.hp - 3;
        if (who.hp < 22) who.hp = 100; // as after /clear: the context is empty again
        updateRow(who);
        var lim = who.claude ? [L[0], L[1]] : [L[2], L[3]];
        lim[0].v += 1.2; lim[1].v += 0.3;
        lim.forEach(function (x) { if (x.v > 94) x.v = x.start; setLimit(x.el, x.v); });
      }
    })();
  })();

  // ------------------------------------------------------------------ 내 PC에서만: the privacy rows, with the hide-prompts switch

  var hidePrompts = false;
  function renderHide() {
    var box = document.getElementById('hideSample');
    if (!box) return;
    var via = hidePrompts ? 'Edit' : 'Edit src/Header.tsx · "' + t('privacy.hide.sample') + '"';
    box.innerHTML = '<span class="today-line">' + withName('app.logCatch', '<b>' + esc(nameOf(43)) + '</b>') + ' · Lv.8</span>' +
      '<span class="today-sub"><span class="w-toast-tier tier-common">' + esc(t('tier.common')) + '</span><span class="today-ball">' + ballImg('great-ball', 13) + esc(ballName('great-ball')) + '</span><span>' + esc(place('spawn-site', 'grass')) + '</span><span>· ' + esc(via) + '</span></span>';
    var sw = document.getElementById('hideSwitch');
    sw.classList.toggle('on', hidePrompts);
    sw.setAttribute('aria-checked', hidePrompts ? 'true' : 'false');
  }
  (function () {
    var sw = document.getElementById('hideSwitch');
    if (!sw) return;
    sw.addEventListener('click', function () { hidePrompts = !hidePrompts; renderHide(); });
    onLang(renderHide);
  })();

  // ------------------------------------------------------------------ 네 단계: the little pictures beside each step

  (function () {
    var zip = document.getElementById('startZip');
    if (zip) onLang(function () { zip.textContent = versionText(zip); });
    var exe = document.getElementById('startExe');
    if (exe) exe.textContent = exeText();
    var slot = document.getElementById('startCatch');
    if (!slot) return;
    onLang(function () {
      slot.textContent = '';
      var c = toastCard({ kind: 'catch', id: 1, level: 7, ball: 'poke-ball', nature: 'modest', isNew: true, place: place('spawn-site', 'grass', false) });
      c.style.animation = 'none';
      slot.appendChild(c);
    });
  })();

  // ------------------------------------------------------------------ the closing strip: Pokédex cells, a new one filling in now and then

  (function () {
    var root = document.getElementById('dexStrip');
    if (!root) return;
    var cellsEl = document.getElementById('stripCells');
    var countEl = document.getElementById('stripCount');
    var clock = sectionClock(root);
    var page = 0, ids = [], next = [], have = {}, extra = 0, newest = 0;
    var base = Object.keys(caught).length;

    /* Twelve numbers at a time, from the same sample save as the Pokédex above: the ones caught there are filled,
       a few of the rest fill in one by one, then the strip moves on to the next twelve */
    function load(k) {
      ids = []; for (var i = 1; i <= 12; i++) ids.push(k * 12 + i);
      have = {}; ids.forEach(function (id) { if (caught[id]) have[id] = 1; });
      next = ids.filter(function (id) { var tr = SP[id].tier; return !have[id] && tr !== 'legendary' && tr !== 'mythical'; }).slice(0, 4);
      newest = 0;
    }
    function cell(id) {
      var c = have[id];
      return '<span class="dex-cell ' + (c ? 'caught' : 'unknown') + ' tier-' + SP[id].tier + (id === newest && !reduceMotion ? ' fill' : '') + '">' +
        (c ? '<img src="' + art(id) + '" alt="" draggable="false">' : '<span class="dex-q">?</span>') +
        '<span class="dex-no">' + id + '</span>' + (id === newest ? '<span class="dex-new"></span>' : '') + '</span>';
    }
    function render() {
      cellsEl.innerHTML = ids.map(cell).join('');
      countEl.textContent = num(base + extra);
    }
    load(0);
    if (reduceMotion) {
      // still, but complete: one already new
      if (next.length) { have[next[0]] = 1; extra = 1; newest = next[0]; }
      render(); onLang(render);
      return;
    }
    render(); onLang(render);
    (async function () {
      for (;;) {
        for (var i = 0; i < next.length; i++) {
          await clock.wait(3600);
          have[next[i]] = 1; extra++; newest = next[i];
          render();
        }
        await clock.wait(5000);
        page = (page + 1) % 12;
        if (!page) extra = 0;
        load(page); render();
      }
    })();
  })();

  // ------------------------------------------------------------------ the header: full width at the top, a floating pill once scrolled

  (function () {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var floating = null;
    function set(on) {
      if (on === floating) return;
      floating = on;
      nav.classList.toggle('floating', on);
    }
    function check() { set(window.scrollY > 80); }
    window.addEventListener('scroll', check, { passive: true });
    check();
    // A reload keeps its scroll: the header starts in the right shape, and only moves once the page has settled
    function settle() { setTimeout(function () { check(); requestAnimationFrame(function () { requestAnimationFrame(function () { nav.classList.remove('no-anim'); }); }); }, 150); }
    if (document.readyState === 'complete') settle(); else window.addEventListener('load', settle, { once: true });
  })();

  // ------------------------------------------------------------------ start

  applyStatic();
  if (app) loop();
})();
