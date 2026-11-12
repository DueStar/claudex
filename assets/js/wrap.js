/* wrap.js — line breaks where the meaning breaks, with semantic-wrap (vendor/semantic-wrap-0.4.0.js).

   The subtitles (.lede) and the four steps' lines are measured at their real width and font,
   and broken between phrases instead of wherever the browser runs out of room
   ("…만나는 / 곳이 달라요" becomes "…만나요. / 쓰는 도구마다 만나는 곳이 달라요"). A text that fits on
   one line stays one line; one that does not breaks between its sentences first, and a sentence
   still too wide goes to the model (trained on titles). Short titles are left alone: the model
   split them oddly ("내 / PC에서만.").
   Korean and English only (there is no Japanese model; Japanese keeps word-break: auto-phrase).
   Runs once the fonts are in (loading.js), again on a language switch (main.js) and after a resize. */
(function () {
  'use strict';
  var SW = window.semanticWrap;
  if (!SW || !SW.selectLineBreaks) return;
  var TARGETS = '.lede, .steps4 li > p';
  var FILL = 0.84;
  var canvas = document.createElement('canvas').getContext('2d');

  function modelFor(lang) { return lang === 'ko' ? SW.koTitleModel : lang === 'en' ? SW.enTitleModel : null; }

  function linesFor(text, model, max, measure) {
    if (measure(text) <= max) return null;
    var lines = [];
    var sentences = text.split(/(?<=[.!?。])\s+/);
    for (var k = 0; k < sentences.length; k++) {
      var s = sentences[k];
      if (measure(s) <= max) { lines.push(s); continue; }
      var r = null;
      try { r = SW.selectLineBreaks({ text: s, model: model, maxWidth: max, measureText: measure }); } catch (e) { r = null; }
      if (!r || !r.applied || r.overflow || !r.lines) return null;
      lines.push.apply(lines, r.lines);
    }
    return lines.length > 1 ? lines : null;
  }

  function wrapOne(el, model) {
    // only plain text: a line that holds links or marks is left to the browser
    if (el.children.length && !el.hasAttribute('data-sw')) return;
    var text = el.getAttribute('data-sw') || el.textContent;
    if (!text || !text.trim()) return;
    // the room it may take, not the width it has now: a centred line shrinks to its longest line, so
    // measuring that kept the breaks of a narrower window after the window grew again
    el.textContent = text;
    var before = el.style.width;
    el.style.width = '100%';
    var cs = getComputedStyle(el);
    var width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    el.style.width = before;
    if (!(width > 0)) return;
    canvas.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    if ('letterSpacing' in canvas) canvas.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    // lines are kept to 84% of the room: a line that runs edge to edge reads like a rule, and two
    // shorter lines read easier than one full one
    var lines = linesFor(text, model, (width - 1) * FILL, function (s) { return canvas.measureText(s).width; });
    el.setAttribute('data-sw', text);
    if (!lines) { el.textContent = text; return; }
    el.textContent = '';
    lines.forEach(function (line, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(line));
    });
  }

  function rewrap() {
    var model = modelFor(document.documentElement.lang);
    document.querySelectorAll(TARGETS).forEach(function (el) {
      if (!model) { if (el.hasAttribute('data-sw')) { el.textContent = el.getAttribute('data-sw'); el.removeAttribute('data-sw'); } return; }
      wrapOne(el, model);
    });
  }
  // a language switch writes fresh text: forget the old one first
  window.spawnRewrap = function (fresh) {
    if (fresh) document.querySelectorAll('[data-sw]').forEach(function (el) { el.removeAttribute('data-sw'); });
    rewrap();
  };

  var timer = null, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(rewrap, 150);
  });
})();
