/* motion.js — three quiet interactions, ideas from Amicro
   (https://github.com/Subhan-code/Amicro--Micro-transitions-, MIT), rewritten without React.
   1. Scroll reveal: blocks rise 8px and fade in once, as they come into view.
   2. Spotlight: a faint yellow light follows the pointer over cards (mouse only).
   3. Word reveal: the hero title comes in word by word once, after the fonts.
   Nothing moves with "reduce motion" on. */
(function () {
  'use strict';
  var root = document.documentElement;
  var still = false;
  try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (still) return;

  // ------------------------------------------------ 1. scroll reveal
  var picks = document.querySelectorAll([
    'main section:not(.hero) > .wrap > *',
    '.feature .wrap > *',
    '.steps4 > li',
    '.faq > *'
  ].join(','));
  var items = [];
  picks.forEach(function (el) {
    if (el.matches('.steps4, .faq')) return; // their children move instead
    if (items.indexOf(el) < 0) items.push(el);
  });
  items.forEach(function (el) {
    // siblings that come in together follow each other by 70ms (up to five)
    var i = 0, p = el.previousElementSibling;
    while (p && i < 5) { if (items.indexOf(p) >= 0) i++; p = p.previousElementSibling; }
    el.style.setProperty('--rv-i', i);
    el.setAttribute('data-rv', '');
  });
  root.classList.add('motion-ready');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('rv-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0.01 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('rv-in'); });
  }

  // ------------------------------------------------ 2. spotlight (a real pointer that hovers)
  var hover = false;
  try { hover = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
  if (hover) {
    document.querySelectorAll('.steps4 .step-pic, .faq details, .privacy-panel, .sess-demo .w-card, .dex-panel').forEach(function (card) {
      var spot = document.createElement('span');
      spot.className = 'spot';
      spot.setAttribute('aria-hidden', 'true');
      card.classList.add('has-spot');
      card.appendChild(spot);
      card.addEventListener('pointermove', function (ev) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
        card.style.setProperty('--my', (ev.clientY - r.top) + 'px');
      });
    });
  }

  // ------------------------------------------------ 3. word reveal of the hero title
  var title = document.querySelector('.hero-head h1');
  function split() {
    if (!title || title.querySelector('.wr')) return;
    var text = title.textContent;
    var ja = root.lang === 'ja';
    var n = 0;
    title.textContent = '';
    text.split('\n').forEach(function (line, li) {
      if (li) title.appendChild(document.createTextNode('\n'));
      // Japanese has no spaces: a few characters at a time; others: word by word
      var parts = ja ? (line.match(/.{1,3}/g) || []) : line.split(/(\s+)/);
      parts.forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { title.appendChild(document.createTextNode(part)); return; }
        var s = document.createElement('span');
        s.className = 'wr';
        s.style.setProperty('--wr-i', n++);
        s.textContent = part;
        title.appendChild(s);
      });
    });
  }
  function whenFonts(fn) {
    if (!root.classList.contains('fonts-wait')) { fn(); return; }
    var mo = new MutationObserver(function () {
      if (root.classList.contains('fonts-wait')) return;
      mo.disconnect(); fn();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  whenFonts(split);
})();
