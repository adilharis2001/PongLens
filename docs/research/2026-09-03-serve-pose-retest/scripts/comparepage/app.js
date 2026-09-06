// Two ball tracks over one clip, plus a timeline of when each saw the ball
// on the table. The timeline is the part that carries the argument: an
// empty stretch before the serve on one row and a filled one on the other
// is the whole claim, and it is visible without playing anything.
(function () {
  'use strict';
  var D = window.CMP || {};
  var KEY = 'ponglens.cropcompare.v1';
  var verd = {};
  try { verd = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  var v = document.getElementById('v'), cv = document.getElementById('cv');
  var ids = [], at = 0, mode = 'serve';

  function build() {
    ids = Object.keys(D).map(Number)
      .filter(function (i) { return mode === 'all' ? true : D[i].serve != null; })
      .sort(function (a, b) { return a - b; });
    at = 0; show();
  }

  function strip(el, pts, len, serve) {
    el.innerHTML = '';
    var seen = {};
    pts.forEach(function (p) {
      if (!p[3]) return;                      // only "over the table"
      var k = Math.round(p[0] * 30);
      if (seen[k]) return;
      seen[k] = 1;
      var i = document.createElement('i');
      i.style.left = (p[0] / len * 100) + '%';
      i.style.background = el.id === 's-old' ? '#ff5ea8' : '#5adcff';
      el.appendChild(i);
    });
    if (serve != null) {
      var s = document.createElement('span');
      s.className = 'srv'; s.style.left = (serve / len * 100) + '%';
      el.appendChild(s);
    }
    var n = document.createElement('span');
    n.className = 'now'; n.id = el.id + '-now';
    el.appendChild(n);
  }

  function draw() {
    var d = D[ids[at]];
    if (!d) return;
    var w = v.clientWidth, h = v.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var t = v.currentTime;
    if (d.quad && d.quad.length === 4) {
      g.strokeStyle = 'rgba(120,140,160,.55)'; g.lineWidth = 1.5;
      g.beginPath();
      d.quad.forEach(function (p, i) { g[i ? 'lineTo' : 'moveTo'](p[0]*w, p[1]*h); });
      g.closePath(); g.stroke();
    }
    // a trail either side of now, so a still frame still shows the path
    [['old', d.old, '#ff5ea8'], ['new', d.new, '#5adcff']].forEach(function (row) {
      row[1].forEach(function (p) {
        var dt = t - p[0];
        if (dt < -0.1 || dt > 0.6) return;
        var a = 1 - Math.max(0, dt) / 0.6;
        g.globalAlpha = 0.2 + 0.8 * a;
        g.fillStyle = row[2];
        g.beginPath();
        g.arc(p[1]*w, p[2]*h, p[3] ? (3 + 4*a) : (2 + 2*a), 0, 6.284);
        g.fill();
        if (p[3]) { g.strokeStyle = row[2]; g.lineWidth = 1; g.stroke(); }
      });
    });
    g.globalAlpha = 1;
    // does each version see a ball on the table right now?
    function seesNow(pts) {
      return pts.some(function (p) { return Math.abs(p[0]-t) < 0.06 && p[3]; });
    }
    g.font = '600 14px system-ui';
    g.fillStyle = seesNow(d.old) ? '#ff5ea8' : 'rgba(140,150,165,.65)';
    g.fillText(seesNow(d.old) ? 'OLD: ball on table' : 'OLD: nothing', 12, 24);
    g.fillStyle = seesNow(d.new) ? '#5adcff' : 'rgba(140,150,165,.65)';
    g.fillText(seesNow(d.new) ? 'NEW: ball on table' : 'NEW: nothing', 12, 44);
    if (d.serve != null && Math.abs(d.serve - t) < 0.15) {
      g.fillStyle = '#ffd24a'; g.fillText('THE SERVE', 12, 66);
    }
    ['s-old', 's-new'].forEach(function (id) {
      var n = document.getElementById(id + '-now');
      if (n) n.style.left = (t / d.len * 100) + '%';
    });
  }

  function show() {
    var d = D[ids[at]];
    if (!d) return;
    v.src = d.clip; v.load();
    var start = d.serve != null ? Math.max(0, d.serve - 2.0) : 0;
    var once = false;
    function land() {
      if (once) return; once = true;
      try { v.currentTime = start; } catch (e) {}
      [0, 80, 250, 600].forEach(function (m) { setTimeout(draw, m); });
    }
    v.addEventListener('loadedmetadata', land);
    v.addEventListener('loadeddata', land);
    setTimeout(land, 900);
    strip(document.getElementById('s-old'), d.old, d.len, d.serve);
    strip(document.getElementById('s-new'), d.new, d.len, d.serve);
    var got = ids.filter(function (i) { return verd[i]; }).length;
    document.getElementById('count').textContent =
      'Card ' + (at + 1) + ' of ' + ids.length + '  ·  ' + got + ' judged' +
      (d.was_missed ? '  ·  the old rule missed this one' : '');
    document.querySelectorAll('.verdict button').forEach(function (b) {
      b.classList.toggle('chosen', b.dataset.v === verd[ids[at]]);
    });
    render();
  }

  function render() {
    var got = ids.filter(function (i) { return verd[i]; });
    var el = document.getElementById('done');
    if (!got.length) {
      el.innerHTML = 'Keys: <kbd>1</kbd> agree, <kbd>2</kbd> disagree, ' +
        '<kbd>3</kbd> unsure, <kbd>&larr;</kbd><kbd>&rarr;</kbd> move, ' +
        '<kbd>space</kbd> play. Saves in this browser.';
      return;
    }
    var a = got.filter(function (i) { return verd[i] === 'agree'; }).length;
    var b = got.filter(function (i) { return verd[i] === 'disagree'; }).length;
    var u = got.length - a - b;
    el.innerHTML = '<b>' + got.length + ' of ' + ids.length + ' judged</b> — ' +
      a + ' agree the crop fills the silence, ' + b + ' say no difference, ' +
      u + ' unsure' +
      '<textarea readonly>' + JSON.stringify(verd) + '</textarea>' +
      'Paste that back to me.';
  }

  document.querySelector('.bar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var d = D[ids[at]], step = 1 / 30;
    if (b.dataset.a === 'play') v.paused ? v.play() : v.pause();
    if (b.dataset.a === 'serve' && d.serve != null) v.currentTime = Math.max(0, d.serve - 2.0);
    if (b.dataset.a === 'back') { v.pause(); v.currentTime = Math.max(0, v.currentTime - step); }
    if (b.dataset.a === 'fwd') { v.pause(); v.currentTime += step; }
    if (b.dataset.a === 'prev') { at = (at - 1 + ids.length) % ids.length; show(); }
    if (b.dataset.a === 'next') { at = (at + 1) % ids.length; show(); }
    draw();
  });
  document.querySelector('.verdict').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    verd[ids[at]] = b.dataset.v;
    try { localStorage.setItem(KEY, JSON.stringify(verd)); } catch (err) {}
    at = Math.min(at + 1, ids.length - 1); show();
  });
  document.querySelector('.top').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    mode = b.dataset.q; build();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    if (e.key === 'ArrowRight') { at = (at + 1) % ids.length; show(); }
    if (e.key === 'ArrowLeft') { at = (at - 1 + ids.length) % ids.length; show(); }
    if (e.key === ',') { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1/30); }
    if (e.key === '.') { v.pause(); v.currentTime += 1/30; }
    var m = { '1': 'agree', '2': 'disagree', '3': 'unsure' };
    if (m[e.key]) {
      verd[ids[at]] = m[e.key];
      try { localStorage.setItem(KEY, JSON.stringify(verd)); } catch (err) {}
      at = Math.min(at + 1, ids.length - 1); show();
    }
    draw();
  });
  v.addEventListener('seeked', draw);
  v.addEventListener('timeupdate', draw);
  (function loop() { if (!v.paused) draw(); requestAnimationFrame(loop); })();
  window.addEventListener('resize', draw);
  build();
})();
