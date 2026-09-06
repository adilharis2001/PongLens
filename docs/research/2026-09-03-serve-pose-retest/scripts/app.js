// One card at a time, one video element. Ninety-three <video> tags on one
// page cannot all decode, so most of them painted black — which is what the
// first version of this page did, and it made the page useless.
(function () {
  'use strict';
  var D = window.REAL || {};
  var EDGES = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
               [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
  var KEY = 'ponglens.emerge.verdicts.v1';
  var verdicts = {};
  try { verdicts = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}

  var v = document.getElementById('v');
  var cv = document.getElementById('cv');
  var meta = document.getElementById('meta');
  var countEl = document.getElementById('count');
  var doneEl = document.getElementById('done');
  var overlay = true;
  var queue = 'unanchored';
  var ids = [];
  var at = 0;

  function build() {
    ids = Object.keys(D).filter(function (k) {
      return queue === 'all' ? true : D[k].arm === queue;
    }).sort(function (a, b) { return D[a].idx - D[b].idx; });
    at = 0;
    show();
  }

  function colour(s) {
    s = String(s || '');
    if (s.indexOf('CHOSEN as the near') === 0) return '#50f050';
    if (s.indexOf('CHOSEN as the far') === 0) return '#f0b43c';
    return '#6e6e6e';
  }

  function nearest(d, t) {
    var best = null, bd = 1e9;
    for (var k in d.frames) {
      var dt = Math.abs(d.frames[k].t - t);
      if (dt < bd) { bd = dt; best = k; }
    }
    return bd <= 0.2 ? best : null;
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
    if (!overlay) return;
    var t = v.currentTime;

    if (d.quad && d.quad.length === 4) {
      g.strokeStyle = 'rgba(90,220,255,.9)'; g.lineWidth = 2;
      g.beginPath();
      d.quad.forEach(function (p, i) { g[i ? 'lineTo' : 'moveTo'](p[0]*w, p[1]*h); });
      g.closePath(); g.stroke();
    }
    var key = nearest(d, t);
    if (key) {
      d.frames[key].people.forEach(function (p) {
        var c = colour(p.v), b = p.b;
        g.strokeStyle = c; g.lineWidth = (c === '#6e6e6e') ? 1 : 2.5;
        g.strokeRect(b[0]*w, b[1]*h, (b[2]-b[0])*w, (b[3]-b[1])*h);
      });
      var kp = d.kp[key];
      if (kp) Object.keys(kp).forEach(function (side) {
        var pts = kp[side]; if (!pts) return;
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
        EDGES.forEach(function (e) {
          var a = pts[e[0]], b2 = pts[e[1]];
          if (!a || !b2 || a[2] < .3 || b2[2] < .3) return;
          g.beginPath(); g.moveTo(a[0]*w, a[1]*h); g.lineTo(b2[0]*w, b2[1]*h); g.stroke();
        });
      });
    }
    var TRAIL = 0.5, seen = false;
    for (var i = 0; i < d.ball.length; i++) {
      var dt = t - d.ball[i][0];
      if (Math.abs(dt) < 0.06) seen = true;
      if (dt < 0 || dt > TRAIL) continue;
      var a2 = 1 - dt / TRAIL;
      g.fillStyle = 'rgba(255,94,168,' + (0.15 + 0.85 * a2).toFixed(3) + ')';
      g.beginPath(); g.arc(d.ball[i][1]*w, d.ball[i][2]*h, 2 + 5 * a2, 0, 6.284); g.fill();
    }
    g.font = '600 14px system-ui';
    g.fillStyle = seen ? 'rgba(255,94,168,.95)' : 'rgba(150,160,175,.8)';
    g.fillText(seen ? 'ball visible' : 'no ball', w - 96, h - 14);

    (d.emerge || []).forEach(function (et) {
      if (Math.abs(et - t) > 0.15) return;
      g.strokeStyle = 'rgba(126,224,138,.95)'; g.lineWidth = 5;
      g.strokeRect(2.5, 2.5, w - 5, h - 5);
      g.fillStyle = '#7ee08a'; g.font = '600 17px system-ui';
      g.fillText('BALL EMERGES', 14, 30);
    });
    if (d.labels.contact != null && Math.abs(d.labels.contact - t) < 0.12) {
      g.fillStyle = '#ffd24a'; g.font = '600 15px system-ui';
      g.fillText('serve mark (ball rule)', 14, 54);
    }
  }

  function chip(label, side, truth) {
    if (!side) return '<span class="tag off">' + label + ': silent</span>';
    var ok = side === truth;
    return '<span class="tag ' + (ok ? 'ok' : 'bad') + '">' + label + ': ' +
           side + (ok ? '' : ' ✗') + '</span>';
  }

  function show() {
    var d = D[ids[at]];
    if (!d) return;
    v.src = d.clip;
    v.load();
    var target = (d.emerge || []).length ? Math.max(0, d.emerge[0] - 1.2)
               : Math.max(0, (d.labels.b1 || 1.9) - 1.2);
    var settled = false;
    function land() {
      if (settled) return;
      settled = true;
      try { v.currentTime = target; } catch (e) {}
      // The canvas has no size until the video has laid out, and setting
      // currentTime to a value it already holds fires no 'seeked'. So nudge
      // the draw a few times rather than trusting one event.
      [0, 60, 180, 400, 800].forEach(function (ms) { setTimeout(draw, ms); });
    }
    v.addEventListener('loadedmetadata', land);
    v.addEventListener('loadeddata', land);
    v.addEventListener('canplay', land);
    setTimeout(land, 900);

    meta.innerHTML =
      '<span class="id">card #' + d.idx + '</span>' +
      '<span>truth: <b>' + d.truth + '</b> served</span>' +
      chip('ball rule', d.ball_side, d.truth) +
      chip('pose', d.pose.side, d.truth) +
      ((d.emerge || []).length
        ? '<span class="tag em">ball emerges at ' +
          d.emerge.map(function (x) { return x.toFixed(2) + 's'; }).join(' and ') + '</span>'
        : '<span class="tag off">no emergence found</span>');
    var vd = verdicts[d.idx];
    document.querySelectorAll('.verdict button').forEach(function (b) {
      b.classList.toggle('chosen', b.dataset.v === vd);
    });
    var judged = ids.filter(function (k) { return verdicts[D[k].idx]; }).length;
    countEl.textContent = 'Card ' + (at + 1) + ' of ' + ids.length +
      '  ·  ' + judged + ' judged';
    render();
  }

  function render() {
    var mine = ids.map(function (k) { return D[k].idx; });
    var got = mine.filter(function (i) { return verdicts[i]; });
    var yes = got.filter(function (i) { return verdicts[i] === 'serve'; }).length;
    var no = got.filter(function (i) { return verdicts[i] === 'not'; }).length;
    var idk = got.filter(function (i) { return verdicts[i] === 'unsure'; }).length;
    if (!got.length) {
      doneEl.innerHTML = 'No verdicts yet. Keys: <kbd>1</kbd> yes, <kbd>2</kbd> no, ' +
        '<kbd>3</kbd> can\'t tell, <kbd>&larr;</kbd><kbd>&rarr;</kbd> move, ' +
        '<kbd>space</kbd> play. Verdicts save in this browser.';
      return;
    }
    doneEl.innerHTML = '<b>' + got.length + ' of ' + mine.length + ' judged</b> — ' +
      yes + ' the serve, ' + no + ' wrong moment, ' + idk + ' unclear' +
      (got.length ? '  (' + Math.round(yes / (yes + no || 1) * 100) +
        '% of the decided ones are the serve)' : '') +
      '<textarea readonly>' + JSON.stringify(verdicts) + '</textarea>' +
      'Copy that line back to me when you are done.';
  }

  document.querySelector('.bar').addEventListener('click', function (e) {
    var a = e.target.closest('button') && e.target.closest('button').dataset.a;
    var d = D[ids[at]];
    if (!a || !d) return;
    var step = 1 / (d.fps || 30);
    if (a === 'play') { v.paused ? v.play() : v.pause(); }
    if (a === 'emg' && (d.emerge || []).length) v.currentTime = Math.max(0, d.emerge[0] - 1.2);
    if (a === 'start') v.currentTime = 0;
    if (a === 'back') { v.pause(); v.currentTime = Math.max(0, v.currentTime - step); }
    if (a === 'fwd') { v.pause(); v.currentTime += step; }
    if (a === 'ov') { overlay = !overlay; e.target.textContent = overlay ? 'Overlay off' : 'Overlay on'; }
    if (a === 'prev') { at = (at - 1 + ids.length) % ids.length; show(); }
    if (a === 'next') { at = (at + 1) % ids.length; show(); }
    draw();
  });
  document.querySelector('.verdict').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    verdicts[D[ids[at]].idx] = b.dataset.v;
    try { localStorage.setItem(KEY, JSON.stringify(verdicts)); } catch (err) {}
    at = Math.min(at + 1, ids.length - 1);
    show();
  });
  document.querySelector('.queue').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('.queue button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    queue = b.dataset.q;
    build();
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'TEXTAREA') return;
    var d = D[ids[at]], step = 1 / ((d && d.fps) || 30);
    if (e.key === ' ') { e.preventDefault(); v.paused ? v.play() : v.pause(); }
    if (e.key === 'ArrowRight') { at = (at + 1) % ids.length; show(); }
    if (e.key === 'ArrowLeft') { at = (at - 1 + ids.length) % ids.length; show(); }
    if (e.key === ',') { v.pause(); v.currentTime = Math.max(0, v.currentTime - step); }
    if (e.key === '.') { v.pause(); v.currentTime += step; }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      verdicts[d.idx] = { '1': 'serve', '2': 'not', '3': 'unsure' }[e.key];
      try { localStorage.setItem(KEY, JSON.stringify(verdicts)); } catch (err) {}
      at = Math.min(at + 1, ids.length - 1);
      show();
    }
    draw();
  });
  v.addEventListener('seeked', draw);
  v.addEventListener('timeupdate', draw);
  (function loop() { if (!v.paused) draw(); requestAnimationFrame(loop); })();
  window.addEventListener('resize', draw);
  build();
})();
