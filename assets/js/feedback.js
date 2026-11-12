/* feedback.js — a feedback button at the bottom right, for spawn itself
   (what to fix, what to add, where it should go), not for this page.
   Sending opens a prefilled GitHub issue (the visitor signs in to GitHub to
   post it), or the text can be copied instead. */
(function () {
  'use strict';

  var REPO = 'https://github.com/DueStar/spawn';
  var LABEL = 'feedback';
  var MAX = 2000;

  var S = {
    ko: {
      fab: '의견 보내기', title: 'spawn에 바라는 점',
      lead: '고쳤으면 하는 것, 더해졌으면 하는 것, 이렇게 자랐으면 하는 방향을 들려주세요.',
      kinds: { fix: '고쳐 주세요', add: '추가해 주세요', direction: '이런 방향은 어때요', like: '좋았던 점' },
      placeholder: '한 줄이어도 좋아요. 편하게 적어 주세요.',
      send: 'GitHub에 올리기', copy: '복사', copied: '복사했어요',
      note: 'GitHub 로그인이 필요해요. 계정이 없으면 복사해서 보내 주세요.',
      empty: '한 줄만 적어 주세요', sent: 'GitHub 창에서 「Create」를 누르면 올라가요', close: '닫기'
    },
    en: {
      fab: 'Send feedback', title: 'What should spawn do next?',
      lead: 'Tell me what to fix, what to add, or where you would like it to go.',
      kinds: { fix: 'Please fix', add: 'Please add', direction: 'A direction', like: 'What I liked' },
      placeholder: 'One line is plenty. Write it however you like.',
      send: 'Post on GitHub', copy: 'Copy', copied: 'Copied',
      note: 'Posting needs a GitHub sign-in. No account? Copy it and send it to me.',
      empty: 'Write a line first', sent: 'Press "Create" in the GitHub window to post it', close: 'Close'
    },
    ja: {
      fab: '意見を送る', title: 'spawn へのリクエスト',
      lead: '直してほしいこと、追加してほしいこと、こう育ってほしいという方向を教えてください。',
      kinds: { fix: '直してほしい', add: '追加してほしい', direction: 'こんな方向は？', like: 'よかったところ' },
      placeholder: 'ひとことで大丈夫です。気軽に書いてください。',
      send: 'GitHub に投稿', copy: 'コピー', copied: 'コピーしました',
      note: '投稿には GitHub のログインが必要です。アカウントがなければコピーして送ってください。',
      empty: 'ひとことだけ書いてください', sent: 'GitHub の画面で「Create」を押すと投稿されます', close: '閉じる'
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
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg><span></span>';
  document.body.appendChild(fab);

  function relabel() {
    fab.querySelector('span').textContent = t('fab');
    fab.setAttribute('aria-label', t('fab'));
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
    node.setAttribute('aria-label', t('title'));

    var head = el('div', 'fb-pop-head');
    head.appendChild(el('strong', null, t('title')));
    var x = el('button', 'fb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('close'));
    x.addEventListener('click', closePop);
    head.appendChild(x);
    node.appendChild(head);
    node.appendChild(el('p', 'fb-lead', t('lead')));

    var kind = 'fix';
    var chips = el('div', 'fb-kinds');
    Object.keys(S.en.kinds).forEach(function (k) {
      var c = el('button', 'fb-kind' + (k === kind ? ' on' : ''), t('kinds')[k]);
      c.type = 'button';
      c.setAttribute('aria-pressed', k === kind ? 'true' : 'false');
      c.addEventListener('click', function () {
        kind = k;
        chips.querySelectorAll('.fb-kind').forEach(function (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
        c.classList.add('on'); c.setAttribute('aria-pressed', 'true');
      });
      chips.appendChild(c);
    });
    node.appendChild(chips);

    var area = el('textarea', 'fb-text');
    area.maxLength = MAX;
    area.rows = 4;
    area.placeholder = t('placeholder');
    area.setAttribute('aria-label', t('title'));
    node.appendChild(area);

    area.style.marginBottom = '12px';

    var actions = el('div', 'fb-actions');
    var send = el('button', 'btn btn-primary btn-small', t('send')); send.type = 'button';
    var copy = el('button', 'btn btn-ghost btn-small', t('copy')); copy.type = 'button';
    actions.appendChild(send); actions.appendChild(copy);
    node.appendChild(actions);
    var msg = el('div', 'fb-msg');
    msg.setAttribute('role', 'status');
    node.appendChild(msg);
    node.appendChild(el('p', 'fb-note', t('note')));

    function compose() {
      var text = area.value.trim();
      if (!text) { msg.textContent = t('empty'); msg.className = 'fb-msg warn'; area.focus(); return null; }
      var first = text.split('\n')[0];
      var title = '[feedback] ' + S.en.kinds[kind] + ': ' + (first.length > 60 ? first.slice(0, 60) + '…' : first);
      var rows = [
        ['Kind', S.en.kinds[kind]],
        ['From', 'website'],
        ['Language', lang()],
        ['System', browser()]
      ].filter(Boolean);
      var body = text + '\n\n---\n\n| | |\n|---|---|\n' + rows.map(function (r) { return '| ' + r[0] + ' | ' + String(r[1]).replace(/\|/g, '\\|') + ' |'; }).join('\n') + '\n';
      return { title: title, body: body };
    }

    send.addEventListener('click', function () {
      var c = compose();
      if (!c) return;
      window.open(REPO + '/issues/new?labels=' + encodeURIComponent(LABEL) + '&title=' + encodeURIComponent(c.title) + '&body=' + encodeURIComponent(c.body), '_blank', 'noopener');
      msg.textContent = t('sent'); msg.className = 'fb-msg ok';
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
