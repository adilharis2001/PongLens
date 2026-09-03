import fs from 'fs';
const html = fs.readFileSync('/tmp/serve-diag/corpus/light.html', 'utf8');
const OV = JSON.parse(html.match(/window\.OVERLAY = (\{.*?\});\n/s)[1]);
const attrs = s => Object.fromEntries([...s.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([,k,v])=>[k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const noop = () => {};
const fakeCtx = () => new Proxy({}, { get: (t, p) => p in t ? t[p] : noop, set: () => true });
const cards = [...html.matchAll(/<article class="card"([^>]*)>/g)].map(m => {
  const handlers = {};
  const video = { currentTime: 0, paused: true, ended: false, clientWidth: 416, clientHeight: 234,
                  addEventListener(e, f) { (handlers[e] ||= []).push(f); }, pause: noop };
  const canvas = { width: 0, height: 0, style: {}, getContext: fakeCtx };
  const els = { video, 'canvas.ov': canvas, '.play-head': { style: {} }, '.read': { textContent: '' },
                '.strip': { addEventListener: noop, getBoundingClientRect: () => ({ left: 0, width: 1000 }) },
                '.toggle': { addEventListener: noop, setAttribute: noop, textContent: '' } };
  return { dataset: attrs(m[1]), style: {}, classList: { toggle: noop }, setAttribute: noop,
           scrollIntoView: noop, addEventListener: noop, querySelector: s => els[s] ?? null,
           querySelectorAll: () => [], _v: video, _h: handlers, _c: canvas };
});
const ids = { 'n-shown': {textContent:''}, 'pos': {textContent:''}, 'copied': {textContent:''}, 'copy': {addEventListener:noop}, 'fallback': {} };
global.window = { OVERLAY: OV, devicePixelRatio: 2, addEventListener: noop };
global.requestAnimationFrame = () => 0;
global.setTimeout = (f) => { try { f(); } catch (e) { errors.push('setTimeout: ' + e.message); } return 0; };
global.localStorage = { store:{}, getItem(k){return this.store[k]??null;}, setItem(k,v){this.store[k]=v;} };
global.document = { querySelectorAll: s => s === '.card' ? cards : [], querySelector: s => s === '.grid' ? {scrollIntoView:noop} : null,
                    getElementById: id => ids[id] ?? null, addEventListener: noop };
const errors = [];
new Function(fs.readFileSync('/tmp/serve-diag/corpus/overlay.js','utf8'))();
let drawn = 0, reads = 0, heads = 0;
for (const c of cards) {
  const d = OV[c.dataset.id];
  if (!d) { errors.push('no data: ' + c.dataset.id); continue; }
  for (const frac of [0, 0.15, 0.4, 0.55, 0.8, 0.999]) {
    c._v.currentTime = d.dur * frac;
    for (const f of (c._h.timeupdate || [])) {
      try { f(); drawn++; } catch (e) { errors.push(`${c.dataset.id} @${frac}: ${e.message}`); }
    }
  }
  if (c.querySelector('.read').textContent) reads++;
  if (c.querySelector('.play-head').style.left) heads++;
  if (c._c.width !== Math.round(416 * 2)) errors.push('canvas not sized on ' + c.dataset.id);
}
console.log(`cards ${cards.length}, draws ${drawn}, errors ${errors.length}`);
errors.slice(0, 6).forEach(e => console.log('  ', e));
console.log(`readout filled on ${reads}/${cards.length}, playhead moved on ${heads}/${cards.length}`);
console.log('sample readout:', JSON.stringify(cards[0].querySelector('.read').textContent));
const t = Object.values(OV);
console.log(`payload: ${t.length} splits, ${t.reduce((a,d)=>a+d.track.length,0)} ball positions, ` +
            `${t.reduce((a,d)=>a+d.bounces.length,0)} bounces, ${t.reduce((a,d)=>a+d.crossings.length,0)} crossings, ` +
            `${t.reduce((a,d)=>a+d.taps.length,0)} taps`);
const bad = t.filter(d => !d.quad || d.quad.length !== 4 || !d.track.length);
console.log('splits missing a quad or a track:', bad.length);
process.exit(errors.length ? 1 : 0);
