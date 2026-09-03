// The evidence, drawn over the picture and under it.
(function () {
  'use strict';
  var DATA = window.OVERLAY || {};
  var TRAIL = 0.7, RING = 0.9, W_M = 1.525, L_M = 2.74;

  function at(track, t) {
    if (!track.length) return null;
    var lo = 0, hi = track.length - 1;
    if (t < track[0][0] - 0.25 || t > track[hi][0] + 0.25) return null;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (track[mid][0] < t) lo = mid + 1; else hi = mid; }
    var b = track[lo], a = track[lo > 0 ? lo - 1 : 0];
    if (Math.min(Math.abs(a[0] - t), Math.abs(b[0] - t)) > 0.25) return null;
    if (b[0] === a[0]) return [b[1], b[2]];
    var k = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function draw(card) {
    var d = DATA[card.dataset.id];
    if (!d) return;
    var v = card.querySelector('video'), cv = card.querySelector('canvas.ov');
    if (!v || !cv) return;
    var w = v.clientWidth, h = v.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var t = v.currentTime;
    var on = card.dataset.overlay !== 'off';
    if (on && d.quad && d.quad.length === 4) {
      g.strokeStyle = 'rgba(90,220,255,.85)'; g.lineWidth = 1.6;
      g.beginPath();
      d.quad.forEach(function (p, i) { g[i ? 'lineTo' : 'moveTo'](p[0] * w, p[1] * h); });
      g.closePath(); g.stroke();
      g.fillStyle = 'rgba(90,220,255,.09)'; g.fill();
      if (d.net) {
        g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(d.net[0][0] * w, d.net[0][1] * h);
        g.lineTo(d.net[1][0] * w, d.net[1][1] * h); g.stroke(); g.setLineDash([]);
      }
    }
    if (on) {
      var pts = [];
      for (var i = 0; i < d.track.length; i++) {
        var s = d.track[i];
        if (s[0] > t) break;
        if (s[0] >= t - TRAIL) pts.push(s);
      }
      for (var j = 1; j < pts.length; j++) {
        if (pts[j][0] - pts[j - 1][0] > 0.3) continue;
        var age = (t - pts[j][0]) / TRAIL;
        g.strokeStyle = 'rgba(255,214,64,' + (0.85 * (1 - age)).toFixed(3) + ')';
        g.lineWidth = 2.4 * (1 - age * 0.6);
        g.beginPath(); g.moveTo(pts[j - 1][1] * w, pts[j - 1][2] * h);
        g.lineTo(pts[j][1] * w, pts[j][2] * h); g.stroke();
      }
      var p = at(d.track, t);
      if (p) {
        g.beginPath(); g.arc(p[0] * w, p[1] * h, 5, 0, 6.2832);
        g.fillStyle = 'rgba(255,214,64,.95)'; g.fill();
        g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.2; g.stroke();
      }
      d.bounces.forEach(function (b) {
        var age = t - b.t;
        if (age < -0.05 || age > RING) return;
        var k = Math.max(0, age / RING);
        g.beginPath(); g.arc(b.x * w, b.y * h, 5 + 16 * k, 0, 6.2832);
        g.strokeStyle = (b.on ? 'rgba(120,240,150,' : 'rgba(255,150,90,') + (0.9 * (1 - k)).toFixed(3) + ')';
        g.lineWidth = 2.2; g.stroke();
      });
    }
    // the moment the card was cut
    if (Math.abs(t - d.a1) < 0.45) {
      g.strokeStyle = 'rgba(255,80,80,.95)'; g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
    }
    var head = card.querySelector('.play-head');
    if (head) head.style.left = (100 * t / d.dur).toFixed(3) + '%';
    var read = card.querySelector('.read');
    if (read) {
      var last = null;
      for (var q = 0; q < d.bounces.length; q++) { if (d.bounces[q].t <= t) last = d.bounces[q]; else break; }
      var pos = at(d.track, t);
      read.textContent = (pos ? 'ball tracked' : 'ball not tracked')
        + (last && last.u != null
            ? '  ·  last bounce ' + last.u.toFixed(2) + ' m across, ' + last.v.toFixed(2) + ' m along'
              + (last.on ? ' (on the table)' : ' (off the table)')
            : '')
        + '  ·  ' + t.toFixed(1) + 's of ' + d.dur.toFixed(1) + 's';
    }
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  cards.forEach(function (card) {
    var v = card.querySelector('video');
    if (!v) return;
    ['seeked', 'pause', 'loadeddata', 'timeupdate'].forEach(function (e) {
      v.addEventListener(e, function () { draw(card); });
    });
    var strip = card.querySelector('.strip');
    if (strip) {
      strip.addEventListener('click', function (ev) {
        var r = strip.getBoundingClientRect();
        var d = DATA[card.dataset.id];
        if (!d) return;
        v.currentTime = Math.max(0, Math.min(d.dur, (ev.clientX - r.left) / r.width * d.dur));
        v.pause(); draw(card);
      });
    }
    var tog = card.querySelector('.toggle');
    if (tog) {
      tog.addEventListener('click', function () {
        card.dataset.overlay = card.dataset.overlay === 'off' ? 'on' : 'off';
        tog.setAttribute('aria-pressed', card.dataset.overlay !== 'off');
        tog.textContent = card.dataset.overlay === 'off' ? 'Show the tracking' : 'Hide the tracking';
        draw(card);
      });
    }
  });
  function loop() {
    for (var i = 0; i < cards.length; i++) {
      var v = cards[i].querySelector('video');
      if (v && !v.paused && !v.ended) draw(cards[i]);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.addEventListener('resize', function () { cards.forEach(draw); });
  setTimeout(function () { cards.forEach(draw); }, 250);
})();
