// Review pass: the verdicts are in, so the page's job is navigation.
(function () {
  'use strict';
  var KEY = 'ponglens-capreview-v1';
  var SEEN = 'ponglens-capreview-seed';
  var marks = {};
  try { marks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { marks = {}; }
  var seed = window.SEED_MARKS || {};
  var seedVersion = window.SEED_VERSION || '';
  var applied = '';
  try { applied = localStorage.getItem(SEEN) || ''; } catch (e) { applied = ''; }
  if (seedVersion && applied !== seedVersion) {
    for (var sk in seed) { if (!marks[sk]) { marks[sk] = seed[sk]; } }
    try {
      localStorage.setItem(KEY, JSON.stringify(marks));
      localStorage.setItem(SEEN, seedVersion);
    } catch (e) { /* private mode */ }
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var cur = 0, want = 'all';
  var elShown = document.getElementById('n-shown');
  var elPos = document.getElementById('pos');
  var elCopied = document.getElementById('copied');

  function visible() {
    return cards.filter(function (c) { return c.style.display !== 'none'; });
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (e) { /* private mode */ }
  }
  function paint(card) {
    var v = marks[card.dataset.id] || '';
    card.setAttribute('data-verdict', v);
    var btns = card.querySelectorAll('button[data-v]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].dataset.v === v ? 'true' : 'false');
    }
  }
  function position() {
    var vis = visible();
    var i = vis.indexOf(cards[cur]);
    elPos.textContent = vis.length ? (i < 0 ? '–' : (i + 1) + ' of ' + vis.length) : '–';
  }
  function focusCard(i, play, noScroll) {
    var vis = visible();
    if (!vis.length) { position(); return; }
    if (i < 0) i = 0;
    if (i >= vis.length) i = vis.length - 1;
    cur = cards.indexOf(vis[i]);
    for (var j = 0; j < cards.length; j++) {
      cards[j].classList.toggle('current', j === cur);
      var vd = cards[j].querySelector('video');
      if (j !== cur && vd) { vd.pause(); }
    }
    position();
    if (noScroll) return;
    cards[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (play) {
      var v = cards[cur].querySelector('video');
      if (v) { v.currentTime = 0; v.play().catch(function () {}); }
    }
  }
  function apply(value, quiet) {
    want = value;
    chips.forEach(function (ch) {
      ch.setAttribute('aria-pressed', ch.dataset.filter === want ? 'true' : 'false');
    });
    cards.forEach(function (c) {
      var show = want === 'all'
        || c.dataset.klass === want;
      c.style.display = show ? '' : 'none';
    });
    var n = visible().length;
    elShown.textContent = n + (n === 1 ? ' card' : ' cards');
    focusCard(0, false, quiet);
    if (quiet) return;
    var grid = document.querySelector('.grid');
    if (grid) { grid.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  cards.forEach(function (card) {
    paint(card);
    card.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-v]');
      if (b) {
        var id = card.dataset.id;
        if (marks[id] === b.dataset.v) { delete marks[id]; } else { marks[id] = b.dataset.v; }
        save(); paint(card);
        return;
      }
      if (ev.target.closest('a')) return;
      focusCard(visible().indexOf(card), false);
    });
  });
  chips.forEach(function (ch) {
    ch.addEventListener('click', function () { apply(ch.dataset.filter); });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    var k = ev.key.toLowerCase();
    var vis = visible();
    var here = vis.indexOf(cards[cur]);
    if (k === 'j') { ev.preventDefault(); focusCard(here + 1, true); }
    else if (k === 'k') { ev.preventDefault(); focusCard(here - 1, true); }
    else if (k === ' ') {
      ev.preventDefault();
      var v = cards[cur].querySelector('video');
      if (v) { if (v.paused) { v.play().catch(function () {}); } else { v.pause(); } }
    } else if (k === 'r' || k === 'n' || k === 'u') {
      ev.preventDefault();
      var map = { r: 'cut', n: 'two', u: 'unsure' };
      var id2 = cards[cur].dataset.id;
      if (marks[id2] === map[k]) { delete marks[id2]; } else { marks[id2] = map[k]; }
      save(); paint(cards[cur]);
    }
  });

  var btnCopy = document.getElementById('copy');
  var fallback = document.getElementById('fallback');
  function report() {
    var lines = ['match\tpoint\tmy_reading\tyour_verdict'];
    cards.forEach(function (c) {
      lines.push([c.dataset.match, c.dataset.t, c.dataset.klass,
                  marks[c.dataset.id] || 'unlabelled'].join('\t'));
    });
    return lines.join(String.fromCharCode(10));
  }
  function ok() {
    elCopied.textContent = 'Copied. Paste it into the chat.';
    setTimeout(function () { elCopied.textContent = ''; }, 5000);
  }
  btnCopy.addEventListener('click', function () {
    var text = report();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () {
        fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select();
        elCopied.textContent = 'Select the box below and press Cmd-C.';
      });
    } else {
      fallback.value = text; fallback.hidden = false; fallback.focus(); fallback.select();
      elCopied.textContent = 'Select the box below and press Cmd-C.';
    }
  });

  apply('cut', true);
})();
