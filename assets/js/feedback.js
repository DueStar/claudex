/* feedback.js — a feedback button at the bottom right, for spawn itself
   (what to fix, what to add, where it should go), not for this page.
   Sending adds one row to spawn's Supabase feedback table, the same one the app
   writes to: anyone may add to it, nobody can read it through the API
   (supabase/feedback.sql in the app's repo). No account is needed and nothing is
   public. If it cannot go, the text can be copied instead. */
(function () {
  'use strict';

  // the public (publishable) key, the same as in the app's server/cloud-config.json
  var SUPABASE = 'https://ofyjoyokuzngjtycbkhi.supabase.co';
  var KEY = 'sb_publishable_5E4RW5239vgCigo39aBLMQ_An4vVYP7';
  var MAX = 2000;

  var S = {
    ko: {
      fab: '의견 보내기', title: 'spawn에 바라는 점',
      lead: '고쳤으면 하는 것, 더해졌으면 하는 것, 이렇게 자랐으면 하는 방향을 들려주세요.',
      kinds: { fix: '고쳐 주세요', add: '추가해 주세요', direction: '이런 방향은 어때요', like: '좋았던 점' },
      placeholder: '한 줄이어도 좋아요. 편하게 적어 주세요.',
      send: '보내기', sending: '보내는 중…', copy: '복사', copied: '복사했어요',
      failed: '보내지 못했어요. 복사해서 보내 주세요',
      empty: '한 줄만 적어 주세요', sent: '보냈어요. 고마워요!', close: '닫기'
    },
    en: {
      fab: 'Send feedback', title: 'What should spawn do next?',
      lead: 'Tell me what to fix, what to add, or where you would like it to go.',
      kinds: { fix: 'Please fix', add: 'Please add', direction: 'A direction', like: 'What I liked' },
      placeholder: 'One line is plenty. Write it however you like.',
      send: 'Send', sending: 'Sending…', copy: 'Copy', copied: 'Copied',
      failed: "Couldn't send it. Copy it and send it another way",
      empty: 'Write a line first', sent: 'Sent. Thank you!', close: 'Close'
    },
    ja: {
      fab: '意見を送る', title: 'spawn へのリクエスト',
      lead: '直してほしいこと、追加してほしいこと、こう育ってほしいという方向を教えてください。',
      kinds: { fix: '直してほしい', add: '追加してほしい', direction: 'こんな方向は？', like: 'よかったところ' },
      placeholder: 'ひとことで大丈夫です。気軽に書いてください。',
      send: '送る', sending: '送信中…', copy: 'コピー', copied: 'コピーしました',
      failed: '送れませんでした。コピーして送ってください',
      empty: 'ひとことだけ書いてください', sent: '送りました。ありがとう！', close: '閉じる'
    }
  };
  function lang() { var l = document.documentElement.lang; return S[l] ? l : 'en'; }
  function t(k) { return S[lang()][k]; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function browser() {
    var ua = navigator.userAgent;
    var m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
    if (!m) return ua.slice(0, 60);
    var name = { Edg: 'Edge', OPR: 'Opera', Firefox: 'Firefox', Chrome: 'Chrome', Version: 'Safari' }[m[1]];
    var os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    return name + ' ' + m[2] + (os ? ' · ' + os : '');
  }

  var fab = el('button', 'fb-ui fb-fab');
  fab.type = 'button';
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>';
  document.body.appendChild(fab);

  // the button is the round mark alone; its name is read out and shown on hover
  function relabel() {
    fab.setAttribute('aria-label', t('fab'));
    fab.title = t('fab');
  }
  relabel();
  new MutationObserver(relabel).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  var pop = null;
  fab.addEventListener('click', function () { if (pop) closePop(); else openPop(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) closePop(); });

  function closePop() {
    if (!pop) return;
    pop.remove();
    pop = null;
    fab.classList.remove('on');
    fab.setAttribute('aria-expanded', 'false');
    fab.focus({ preventScroll: true });
  }

  function openPop() {
    var node = el('div', 'fb-ui fb-pop');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', t('fab'));

    var head = el('div', 'fb-pop-head');
    head.appendChild(el('strong', null, t('fab')));
    var x = el('button', 'fb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('close'));
    x.addEventListener('click', closePop);
    head.appendChild(x);
    node.appendChild(head);
    // just the box: no lead line and no kind to pick

    var area = el('textarea', 'fb-text');
    area.maxLength = MAX;
    area.rows = 4;
    area.placeholder = t('placeholder');
    area.setAttribute('aria-label', t('fab'));
    node.appendChild(area);

    area.style.marginBottom = '12px';

    var actions = el('div', 'fb-actions');
    var send = el('button', 'btn btn-primary btn-small', t('send')); send.type = 'button';
    var copy = el('button', 'btn btn-ghost btn-small', t('copy')); copy.type = 'button';
    // copy shows only when sending did not work
    copy.hidden = true;
    actions.appendChild(send); actions.appendChild(copy);
    node.appendChild(actions);
    var msg = el('div', 'fb-msg');
    msg.setAttribute('role', 'status');
    node.appendChild(msg);

    function compose() {
      var text = area.value.trim();
      if (!text) { msg.textContent = t('empty'); msg.className = 'fb-msg warn'; area.focus(); return null; }
      var body = text + '\n\n---\nFrom: website\nLanguage: ' + lang() + '\nSystem: ' + browser();
      return { title: '[feedback] ' + text.split('\n')[0].slice(0, 60), body: body, text: text.slice(0, MAX) };
    }

    send.addEventListener('click', function () {
      var c = compose();
      if (!c) return;
      send.disabled = true; send.textContent = t('sending');
      var row = { source: 'website', body: c.text, lang: lang(), context: { page: location.pathname.slice(0, 80) }, system: browser().slice(0, 120) };
      var done = function (ok) {
        send.textContent = t('send');
        if (ok) { msg.textContent = t('sent'); msg.className = 'fb-msg ok'; area.disabled = true; return; }
        send.disabled = false; copy.hidden = false;
        msg.textContent = t('failed'); msg.className = 'fb-msg warn';
      };
      fetch(SUPABASE + '/rest/v1/feedback', {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row)
      }).then(function (res) { done(res.ok); }, function () { done(false); });
    });
    copy.addEventListener('click', function () {
      var c = compose();
      if (!c) return;
      var all = c.title + '\n\n' + c.body;
      var done = function () { msg.textContent = t('copied'); msg.className = 'fb-msg ok'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(all).then(done, function () { fallbackCopy(all); done(); });
      else { fallbackCopy(all); done(); }
    });

    document.body.appendChild(node);
    pop = node;
    fab.classList.add('on');
    fab.setAttribute('aria-expanded', 'true');
    area.focus({ preventScroll: true });
  }

  function fallbackCopy(text) {
    var ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
})();
