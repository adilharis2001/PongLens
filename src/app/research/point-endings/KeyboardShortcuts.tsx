'use client';
import {BOUNCE_KINDS} from '@/lib/research/pointEndings';
import {KIND_KEYS} from '@/lib/research/endingShortcuts';

const GENERAL: readonly (readonly [string, string])[] = [
  ['Tab / Shift + Tab', 'Next or previous bounce'],
  ['L', 'Mark or unmark the last playable bounce'],
  ['A', 'Add a missed bounce at this frame'],
  ['Delete', 'Clear this bounce’s label'],
  ['Space', 'Play or pause'],
  ['← / →', 'One frame back or forward (Shift for ten)'],
  ['E / W', 'Replay the ending / play the whole point'],
  ['1–9', 'How the point ended, in the list’s order'],
  ['Shift + ↓ / ↑', 'Last paddle contact: nearer or farther player'],
  ['Y', 'Confirm this point’s suggestions'],
  ['Enter / Shift + Enter', 'Next or previous point'],
  ['Esc', 'Leave a text field so the keys work again'],
];
const key = 'rounded border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200';

export function KeyboardShortcuts({open, onToggle, note}: {open: boolean; onToggle: () => void; note: string}) {
  return <div className="mt-3 hidden sm:block">
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" aria-expanded={open} onClick={onToggle} className="min-h-11 rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500">Keyboard shortcuts <span className={key}>?</span></button>
      <p role="status" aria-live="polite" className="text-sm text-cyan-100">{note}</p>
    </div>
    {open && <div className="mt-3 grid gap-x-8 gap-y-1.5 rounded-xl border border-edge bg-surface-1 p-4 text-sm text-zinc-300 md:grid-cols-2">
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">Bounce type, then on to the next bounce</p>
        {KIND_KEYS.map(([k, kind]) => <p key={k} className="flex items-center gap-3"><span className={`${key} w-6 text-center`}>{k.toUpperCase()}</span>{BOUNCE_KINDS.find(([id]) => id === kind)?.[1]}</p>)}
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-500">Everything else</p>
        {GENERAL.map(([k, text]) => <p key={k} className="flex items-baseline gap-3"><span className={`${key} shrink-0`}>{k}</span>{text}</p>)}
      </div>
    </div>}
  </div>;
}
