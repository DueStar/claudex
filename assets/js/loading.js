/* loading.js — what happens while the page is still on its way.

   1. Fonts: nothing is drawn in a stand-in font (it flashed when the real one came in).
      Until the page's fonts are in, the page stays unseen (.fonts-wait in site.css); then
      it fades in once. A slow network gets the page anyway after FONT_WAIT_MS, and the
      inline script in index.html lifts the wait after 4 s whatever happens here.
   2. The newest version: asked of GitHub once; the version line and the zip name show
      LATEST_VERSION (i18n.js) until it answers. */
(function () {
  'use strict';
  var FONT_WAIT_MS = 3000;
  var root = document.documentElement;

  // ---------------------------------------------------------------- 1. fonts

  var SAMPLE = { ko: '기다리던 시간을 모험으로', ja: '待っていた時間を冒険に', en: 'All that waiting' };

  function fontsIn() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var text = SAMPLE[root.lang] || SAMPLE.en;
    var asks = ['400 16px "Uncut Sans"', '600 16px "Uncut Sans"', '700 16px "Uncut Sans"'].map(function (f) { return document.fonts.load(f, 'Aa'); });
    if (root.lang === 'ko') asks.push(document.fonts.load('700 16px "Pretendard Variable"', text));
    if (root.lang === 'ja') asks.push(document.fonts.load('700 16px "Pretendard JP Variable"', text));
    return Promise.all(asks).then(function () { return document.fonts.ready; });
  }

  function within(ms, p) {
    return Promise.race([p.catch(function () {}), new Promise(function (r) { setTimeout(r, ms); })]);
  }

  within(FONT_WAIT_MS, fontsIn()).then(function () {
    // line breaks by meaning (wrap.js), measured in the real fonts before anything shows
    try { if (window.spawnRewrap) window.spawnRewrap(); } catch (e) {}
    root.classList.remove('fonts-wait');
    root.classList.add('fonts-in');
  });

  // ---------------------------------------------------------------- 2. the newest version

  if (!window.fetch || !window.spawnLatest || !window.spawnVersionText) return;
  fetch('https://api.github.com/repos/DueStar/spawn/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (j) {
      if (!j || typeof j.tag_name !== 'string') return;
      window.spawnLatest(j.tag_name.replace(/^v/, ''));
      if (window.spawnMacAssets) window.spawnMacAssets(j.assets); // does this release carry the Mac zips yet?
      document.querySelectorAll('[data-version], #startZip').forEach(function (el) { el.textContent = window.spawnVersionText(el); });
    })
    .catch(function () {});
})();
