/* field.js — the closing section ("기다리던 시간을 모험으로") with Pokémon set out behind it.
   Random Scarlet/Violet icons in tidy, unseen boxes: a grid whose every other column sits half a
   box lower (a zigzag). They are unseen until the pointer comes near, then come up clearer as it comes
   near (closer = clearer). Only a background: the words and the button above are left as they are.
   Icons at one size, 72×67 (60% of the 120×112 original: scaled down, never up). */
(function () {
  'use strict';
  var section = document.querySelector('.closing');
  if (!section || typeof SPECIES === 'undefined') return;
  var ICON = 'https://img.pokemondb.net/sprites/scarlet-violet/icon/';
  var ALL = SPECIES.filter(function (r) { return r[7]; });
  var CELL = 104;       // the unseen box, room around each Pokémon
  var R = 200;          // how far the pointer's light reaches
  var BASE = 0;         // unseen until the pointer comes near
  var hover = false;
  try { hover = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
  // a touch screen has no pointer to follow: there they stay faintly in view
  if (!hover) BASE = 0.14;

  var field = document.createElement('div');
  field.className = 'sv-field';
  field.setAttribute('aria-hidden', 'true');
  section.insertBefore(field, section.firstChild);

  var mons = [];
  function lay() {
    field.textContent = '';
    mons = [];
    var W = section.clientWidth, H = section.clientHeight;
    var cols = Math.floor(W / CELL), rows = Math.ceil(H / CELL) + 1;
    var left = (W - cols * CELL) / 2;
    for (var c = 0; c < cols; c++) {
      for (var r = -1; r < rows; r++) {
        var x = left + c * CELL + (CELL - 72) / 2;
        var y = r * CELL + (c % 2 ? CELL / 2 : 0) + (CELL - 67) / 2;
        if (y > H - 20) continue;
        var s = ALL[Math.floor(Math.random() * ALL.length)];
        var i = document.createElement('img');
        i.className = 'sv-hidden';
        i.alt = ''; i.draggable = false; i.decoding = 'async'; i.loading = 'lazy';
        i.src = ICON + s[7] + '.png';
        i.style.left = Math.round(x) + 'px';
        i.style.top = Math.round(y) + 'px';
        if (BASE) i.style.opacity = BASE;
        field.appendChild(i);
        mons.push({ el: i, x: x + 36, y: y + 33, o: BASE });
      }
    }
  }

  var px = -9999, py = -9999, raf = 0;
  function light() {
    raf = 0;
    for (var k = 0; k < mons.length; k++) {
      var m = mons[k], d = Math.hypot(m.x - px, m.y - py);
      var o = BASE + (1 - BASE) * (d >= R ? 0 : Math.pow(1 - d / R, 1.3));
      if (Math.abs(o - m.o) < 0.01) continue;
      m.o = o;
      m.el.style.opacity = o.toFixed(3);
    }
  }
  function ask() { if (!raf) raf = requestAnimationFrame(light); }

  if (hover) {
    section.addEventListener('pointermove', function (e) {
      var b = section.getBoundingClientRect();
      px = e.clientX - b.left; py = e.clientY - b.top;
      ask();
    }, { passive: true });
    section.addEventListener('pointerleave', function () { px = py = -9999; ask(); });
  }

  lay();
  var w = window.innerWidth, t = null;
  window.addEventListener('resize', function () {
    if (window.innerWidth === w) return;
    w = window.innerWidth;
    clearTimeout(t); t = setTimeout(function () { lay(); ask(); }, 200);
  });
})();
