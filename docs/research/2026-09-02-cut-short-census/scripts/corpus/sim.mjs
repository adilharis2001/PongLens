import fs from 'fs';
const html = fs.readFileSync('/tmp/serve-diag/corpus/light.html', 'utf8');
const attrs = s => Object.fromEntries([...s.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
const cards = [...html.matchAll(/<article class="card"([^>]*)>/g)].map(m => ({ dataset: attrs(m[1]), style: {}, classList: { toggle(){} }, querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, setAttribute(){}, scrollIntoView(){} }));
const chips = [...html.matchAll(/<button class="chip" data-filter="([a-z]+)"[^>]*>([^<]*)<b>(\d+)/g)].map(m => ({ dataset: { filter: m[1] }, label: m[2].trim(), count: +m[3], setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, addEventListener(){} }));
const ids = { 'n-shown': {textContent:''}, 'pos': {textContent:''}, 'copied': {textContent:''}, 'copy': {addEventListener(){}}, 'fallback': {} };
global.window = {}; global.localStorage = { store:{}, getItem(k){return this.store[k]??null;}, setItem(k,v){this.store[k]=v;} };
global.document = { querySelectorAll: s => s === '.card' ? cards : s === '.chip' ? chips : [], querySelector: s => s === '.grid' ? {scrollIntoView(){}} : null, getElementById: id => ids[id] ?? null, addEventListener(){} };
new Function(fs.readFileSync('/tmp/serve-diag/corpus/page.js','utf8'))();
const vis = () => cards.filter(c => c.style.display !== 'none');
console.log(`cards ${cards.length}, visible on load ${vis().length}, shown "${ids['n-shown'].textContent}", position "${ids.pos.textContent}"`);
console.log('pressed on load:', chips.filter(c => c.getAttribute('aria-pressed')==='true').map(c=>c.dataset.filter));
let bad = 0;
for (const ch of chips) {
  const want = ch.dataset.filter;
  const n = cards.filter(c => want === 'all' || c.dataset.klass === want).length;
  if (n !== ch.count) bad++;
  console.log(`  ${n===ch.count?'ok ':'BAD'} ${want.padEnd(6)} label ${String(ch.count).padStart(3)}  matches ${String(n).padStart(3)}  "${ch.label}"`);
}
console.log('every card has a class:', cards.every(c => c.dataset.klass) ? 'yes' : 'NO');
process.exit(bad ? 1 : 0);
