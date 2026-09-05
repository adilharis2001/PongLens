export type BallLabel = {state: 'visible' | 'hidden' | 'absent' | 'unsure'; x: number | null; y: number | null};
export type BallSample = {
  id: string; match_id: string; venue: string; split: string;
  frame: number; time_s: number; width: number; height: number;
  frame_keys: string[]; label: BallLabel | null; prediction: BallLabel | null;
  model_run: string | null; revision: number;
  corners: [number, number][];
};

export function validBallLabel(value: unknown, width: number, height: number): value is BallLabel {
  if (!value || typeof value !== 'object') return false;
  const {state,x,y} = value as BallLabel;
  if (state === 'visible') return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height;
  return ['hidden','absent','unsure'].includes(state) && x === null && y === null;
}

export function sourcePoint(x: number, y: number, displayWidth: number, displayHeight: number, width: number, height: number): [number, number] {
  return [Math.max(0,Math.min(width-1,x/displayWidth*width)), Math.max(0,Math.min(height-1,y/displayHeight*height))];
}
