/**
 * The frozen winner model's call beside the saved winner, for every research
 * point. Stored as its own suggestion run so a later model can be published
 * next to it without touching labels. Sides are camera ends; names come from
 * the audited end each player was at for that point.
 */
export const WINNER_CHECK_RUN_ID = 'winner-check-20260926-v1';
/** Point batches shown on the point-endings page, oldest first. */
export const RESEARCH_BATCHES = ['out-ball-479-v1', 'model-check-20260926-v1'] as const;

export type CheckGroup = 'development' | 'new' | 'far_camera';
export const CHECK_GROUPS: readonly (readonly [CheckGroup, string])[] = [
  ['development', 'Your original six'],
  ['new', 'New matches'],
  ['far_camera', 'Anton · far camera'],
];
type Side = 'near' | 'far';
export type CheckBasis = 'net' | 'out' | 'rule' | 'model';
export type WinnerCheck = {
  version: 1;
  runId: string;
  group: CheckGroup;
  players: {near: string; far: string};
  savedSide: Side | null;
  predicted: {side: Side | null; basis: CheckBasis | null; score: number | null};
};
export type CheckState = 'agrees' | 'disagrees' | 'no_call' | 'unscored';

const side = (x: unknown) => x === null || x === 'near' || x === 'far';
const name = (x: unknown) => typeof x === 'string' && x.trim().length > 0 && x.length <= 60;

export function validWinnerCheck(value: unknown): value is WinnerCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as WinnerCheck;
  const p = x.predicted;
  if (x.version !== 1 || x.runId !== WINNER_CHECK_RUN_ID) return false;
  if (!CHECK_GROUPS.some(([g]) => g === x.group)) return false;
  if (!x.players || !name(x.players.near) || !name(x.players.far)) return false;
  if (!side(x.savedSide) || !p || typeof p !== 'object' || !side(p.side)) return false;
  if (!(p.basis === null || ['net', 'out', 'rule', 'model'].includes(p.basis))) return false;
  if (!(p.score === null || (typeof p.score === 'number' && Number.isFinite(p.score) && p.score >= 0 && p.score <= 1))) return false;
  // A call always says what produced it; no call carries no basis.
  return (p.side === null) === (p.basis === null);
}

export function checkState(check?: WinnerCheck): CheckState | null {
  if (!check) return null;
  if (!check.savedSide) return 'unscored';
  if (!check.predicted.side) return 'no_call';
  return check.predicted.side === check.savedSide ? 'agrees' : 'disagrees';
}

export function checkGroup(check?: WinnerCheck): CheckGroup {
  return check?.group ?? 'development';
}

export function predictedName(check: WinnerCheck): string | null {
  return check.predicted.side ? check.players[check.predicted.side] : null;
}

export function basisText(check: WinnerCheck): string {
  const p = check.predicted;
  if (p.basis === 'net') return 'Net rule';
  if (p.basis === 'out') return 'Ball-went-out rule';
  if (p.basis === 'rule') return 'Earlier rule';
  if (p.basis === 'model') return p.score === null ? 'Model' : `Model score ${Math.round(p.score * 100)} / 100`;
  return '';
}

export type CheckTotals = {group: CheckGroup; points: number; calls: number; correct: number};
/** Coverage and agreement per group, computed from whatever rows are loaded. */
export function checkTotals(rows: readonly {check?: WinnerCheck}[]): CheckTotals[] {
  return CHECK_GROUPS.map(([group]) => {
    const scored = rows.filter(r => r.check && r.check.group === group && r.check.savedSide);
    const calls = scored.filter(r => r.check!.predicted.side);
    return {group, points: scored.length, calls: calls.length, correct: calls.filter(r => checkState(r.check) === 'agrees').length};
  }).filter(t => t.points > 0);
}
