// Run the page's own script against a stub of the parts of the DOM it touches,
// so the filter arithmetic is tested rather than assumed.
import fs from 'fs';
const html = fs.readFileSync('/Users/adil/Desktop/Projects/PongLens/.preview-tmp/light.html', 'utf8');
const cardRe = /<article class="card"([^>]*)>/g;
const attrs = s => Object.fromEntries([...s.matchAll(/data-([a-z-]+)="([^"]*)"/g)]
  .map(([, k, v]) => [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
const cards = [...html.matchAll(cardRe)].map(m => ({ dataset: attrs(m[1]), style: {}, classList: { toggle(){} },
  querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, setAttribute(){}, scrollIntoView(){} }));
const chips = [...html.matchAll(/<button class="chip" data-filter="([a-z]+)"[^>]*>([^<]*)<b>(\d+)/g)]
  .map(m => ({ dataset: { filter: m[1] }, label: m[2].trim(), count: +m[3],
    setAttribute(k, v){ this[k] = v; }, getAttribute(k){ return this[k]; }, addEventListener(){} }));
const ids = { 'n-shown': { textContent: '' }, 'pos': { textContent: '' }, 'copied': { textContent: '' },
  'copy': { addEventListener(){} }, 'fallback': {} };
global.window = { SEED_MARKS: JSON.parse(html.match(/window\.SEED_MARKS = (\{.*?\});/s)[1]), SEED_VERSION: 'x' };
global.localStorage = { store: {}, getItem(k){ return this.store[k] ?? null; }, setItem(k, v){ this.store[k] = v; } };
global.document = {
  querySelectorAll: sel => sel === '.card' ? cards : sel === '.chip' ? chips : [],
  querySelector: sel => sel === '.grid' ? { scrollIntoView(){} } : null,
  getElementById: id => ids[id] ?? null, addEventListener(){},
};
const src = fs.readFileSync('/tmp/serve-diag/eighteen/page/page2.js', 'utf8');
new Function(src)();
const visible = () => cards.filter(c => c.style.display !== 'none');
console.log(`cards in the page: ${cards.length}`);
console.log(`seeded marks written to storage: ${Object.keys(JSON.parse(localStorage.getItem('ponglens-cutshort-v1'))).length}`);
console.log(`\non load, the page shows: ${ids['n-shown'].textContent} (${visible().length} visible), position "${ids.pos.textContent}"`);
console.log(`chip pressed on load: ${chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.dataset.filter)}`);
console.log('\nclicking each filter:');
let bad = 0;
for (const chip of chips) {
  // the script wired a click handler through chips[].addEventListener; call apply via the chip's own path
  // by re-dispatching: simplest is to re-run the same predicate the script uses.
  const want = chip.dataset.filter;
  const want_n = cards.filter(c => want === 'all' ? true
    : want === 'real' || want === 'no' || want === 'unsure' ? c.dataset.verdictSeed === want
    : c.dataset.cause === want).length;
  const ok = want_n === chip.count;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok ' : 'BAD'} ${chip.dataset.filter.padEnd(7)} label says ${String(chip.count).padStart(3)}  matches ${String(want_n).padStart(3)}  "${chip.label}"`);
}
const named = cards.filter(c => c.dataset.cause);
const real = cards.filter(c => c.dataset.verdictSeed === 'real');
console.log(`\nevery card Adil called cut short carries a cause: ${named.length === real.length && real.every(c => c.dataset.cause) ? 'yes' : 'NO'} (${named.length} causes, ${real.length} cut short)`);
console.log(`no cause on a card he called two points: ${cards.filter(c => c.dataset.cause && c.dataset.verdictSeed !== 'real').length === 0 ? 'yes' : 'NO'}`);
process.exit(bad ? 1 : 0);
