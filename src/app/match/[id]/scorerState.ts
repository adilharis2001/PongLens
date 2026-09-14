export type ScorerState = {
  confirmed_winner: "user" | "opponent" | null;
  is_let: boolean;
  scored_at_cut_s: number | null;
};

type ScorerStateSource = {
  confirmed_winner: "user" | "opponent" | null;
  is_let: boolean;
  scored_at_cut_s?: number | null;
};

export function scorerState(_point: ScorerStateSource): ScorerState {
  const skipped = Boolean(_point.is_let);
  const observation = Number(_point.scored_at_cut_s);
  return {
    confirmed_winner: skipped ? null : _point.confirmed_winner,
    is_let: skipped,
    scored_at_cut_s:
      skipped ||
      _point.confirmed_winner === null ||
      _point.scored_at_cut_s == null ||
      !Number.isFinite(observation)
        ? null
        : observation,
  };
}

export function winnerState(
  _before: ScorerState,
  _next: "user" | "opponent" | null,
  _observation?: number | null,
): ScorerState {
  const before = scorerState(_before);
  if (_next === null) {
    return {
      confirmed_winner: null,
      is_let: before.is_let,
      scored_at_cut_s: null,
    };
  }

  const correcting = before.confirmed_winner !== null || before.is_let;
  const eligibleObservation =
    _observation != null && Number.isFinite(_observation)
      ? _observation
      : null;
  return {
    confirmed_winner: _next,
    is_let: false,
    scored_at_cut_s: before.is_let
      ? null
      : correcting
        ? before.scored_at_cut_s
        : (eligibleObservation ?? before.scored_at_cut_s),
  };
}

export function skipState(_before: ScorerState, _next: boolean): ScorerState {
  const before = scorerState(_before);
  if (_next) {
    return {
      confirmed_winner: null,
      is_let: true,
      scored_at_cut_s: null,
    };
  }
  return before.is_let
    ? { confirmed_winner: null, is_let: false, scored_at_cut_s: null }
    : before;
}

export function sameScorerState(_a: ScorerState, _b: ScorerState): boolean {
  return (
    _a.confirmed_winner === _b.confirmed_winner &&
    _a.is_let === _b.is_let &&
    _a.scored_at_cut_s === _b.scored_at_cut_s
  );
}

export type ScorePlaybackEvent = {
  pointId: string;
  start: number;
  end: number;
  time: number;
  playing: boolean;
  ready: boolean;
  foreground: boolean;
  sourceKey: string;
  requiresOwnClip?: boolean;
};

export class ScorePlaybackRun {
  private run:
    | {
        pointId: string;
        start: number;
        end: number;
        sourceKey: string;
        lastTime: number;
      }
    | undefined;

  invalidate(): void {
    this.run = undefined;
  }

  observe(event: ScorePlaybackEvent): void {
    if (!eligibleMedia(event)) {
      this.invalidate();
      return;
    }

    const sameRun =
      this.run !== undefined &&
      this.run.pointId === event.pointId &&
      this.run.start === event.start &&
      this.run.end === event.end &&
      this.run.sourceKey === event.sourceKey;
    if (sameRun) {
      if (event.time + START_EPSILON_S < this.run!.lastTime) {
        this.invalidate();
        this.armAtStart(event);
        return;
      }
      this.run!.lastTime = event.time;
      return;
    }

    const previousRun = this.run;
    this.invalidate();
    this.armAtStart(event, previousRun);
  }

  observation(event: ScorePlaybackEvent): number | undefined {
    if (!eligibleMedia(event) || !this.run) return undefined;
    if (
      this.run.pointId !== event.pointId ||
      this.run.start !== event.start ||
      this.run.end !== event.end ||
      this.run.sourceKey !== event.sourceKey ||
      event.time < event.start ||
      event.time > event.end
    ) {
      return undefined;
    }
    return event.time;
  }

  private armAtStart(
    event: ScorePlaybackEvent,
    previousRun?: {
      pointId: string;
      start: number;
      end: number;
      sourceKey: string;
      lastTime: number;
    },
  ): void {
    const crossedStartContinuously =
      previousRun !== undefined &&
      previousRun.pointId !== event.pointId &&
      previousRun.sourceKey === event.sourceKey &&
      previousRun.lastTime <= event.start &&
      event.time >= event.start &&
      event.time - previousRun.lastTime <= MAX_START_CROSSING_STEP_S;
    if (
      event.time > event.start + START_EPSILON_S &&
      !crossedStartContinuously
    ) {
      return;
    }
    this.run = {
      pointId: event.pointId,
      start: event.start,
      end: event.end,
      sourceKey: event.sourceKey,
      lastTime: event.time,
    };
  }
}

const START_EPSILON_S = 0.05;
/** One 250 ms browser timeupdate at the supported 2x ceiling. */
const MAX_START_CROSSING_STEP_S = 0.5;

function eligibleMedia(event: ScorePlaybackEvent): boolean {
  return (
    event.sourceKey === "cut" &&
    !event.requiresOwnClip &&
    event.playing &&
    event.ready &&
    event.foreground &&
    Number.isFinite(event.start) &&
    Number.isFinite(event.end) &&
    Number.isFinite(event.time) &&
    event.end >= event.start
  );
}

export type ScorerTimingGuard = {
  cut_t0: number | null;
  t0: number | null;
  t1: number | null;
  edited: boolean;
  tight_start: boolean;
  tight_end: boolean;
};

export type ScorerCommandReceipt = {
  pointId: string;
  before: ScorerState;
  after: ScorerState;
  timing: ScorerTimingGuard;
};

/** Null is an unchanged command; a failed write needs visible feedback. */
export type ScorerCommandResult = ScorerCommandReceipt | { failed: true } | null;

export function isScorerFailure(result: ScorerCommandResult): result is { failed: true } {
  return result !== null && "failed" in result;
}

/** Saves outlive a player session. Only their originating view/navigation
 * may consume delayed playback effects. */
export class ScorerSessionEffects {
  private session = 0;
  private navigation = 0;
  private active = false;

  open(): void { this.session += 1; this.active = true; }
  close(): void { this.active = false; }
  navigate(): void { this.navigation += 1; }
  capture(): { session: number; navigation: number } {
    return { session: this.session, navigation: this.navigation };
  }
  sameSession(owner: { session: number }): boolean {
    return this.active && this.session === owner.session;
  }
  owns(owner: { session: number; navigation: number }): boolean {
    return this.sameSession(owner) && this.navigation === owner.navigation;
  }
}

type ScorerCommandPoint = ScorerStateSource & ScorerTimingGuard & { id: string };

export class ScorerCommands {
  private readonly deps: {
    read: (pointId: string) => ScorerCommandPoint | null;
    apply: (pointId: string, state: ScorerState) => void;
    persist: (pointId: string, state: ScorerState) => Promise<boolean>;
  };
  private readonly tails = new Map<string, Promise<void>>();

  constructor(deps: {
    read: (pointId: string) => ScorerCommandPoint | null;
    apply: (pointId: string, state: ScorerState) => void;
    persist: (pointId: string, state: ScorerState) => Promise<boolean>;
  }) {
    this.deps = deps;
  }

  winner(
    pointId: string,
    next: "user" | "opponent" | null,
    observation?: number | null,
    observationTiming?: ScorerTimingGuard,
  ): Promise<ScorerCommandResult> {
    return this.command(pointId, (before, point) => {
      const currentTiming = scorerTimingGuard(point);
      const staleObservation =
        observationTiming !== undefined &&
        !sameTimingGuard(currentTiming, observationTiming);
      return winnerState(
        before,
        next,
        point.edited || staleObservation ? undefined : observation,
      );
    });
  }

  skip(
    pointId: string,
    next: boolean,
  ): Promise<ScorerCommandResult> {
    return this.command(pointId, (before) => skipState(before, next));
  }

  restore(
    receipt: ScorerCommandReceipt,
  ): Promise<ScorerCommandResult> {
    return this.enqueue(receipt.pointId, () => this.restoreAtHead(receipt));
  }

  beginRestore(
    pointId: string,
    pending: Promise<ScorerCommandResult>,
  ): Promise<ScorerCommandResult> {
    return this.enqueue(pointId, async () => {
      const receipt = await pending;
      if (!receipt || isScorerFailure(receipt) || receipt.pointId !== pointId) return null;
      return this.restoreAtHead(receipt);
    });
  }

  private async restoreAtHead(receipt: ScorerCommandReceipt): Promise<ScorerCommandResult> {
    const point = this.deps.read(receipt.pointId);
    if (
      !point ||
      !sameScorerState(scorerState(point), receipt.after) ||
      !sameTimingGuard(scorerTimingGuard(point), receipt.timing)
    ) {
      return null;
    }
    return this.persistTransition(
      receipt.pointId,
      receipt.after,
      receipt.before,
      receipt.timing,
    );
  }

  private command(
    pointId: string,
    transition: (
      before: ScorerState,
      point: ScorerCommandPoint,
    ) => ScorerState,
  ): Promise<ScorerCommandResult> {
    return this.enqueue(pointId, async () => {
      const point = this.deps.read(pointId);
      if (!point) return null;
      const before = scorerState(point);
      const after = transition(before, point);
      if (sameScorerState(before, after)) return null;
      return this.persistTransition(
        pointId,
        before,
        after,
        scorerTimingGuard(point),
      );
    });
  }

  private async persistTransition(
    pointId: string,
    before: ScorerState,
    after: ScorerState,
    timing: ScorerTimingGuard,
  ): Promise<ScorerCommandResult> {
    this.deps.apply(pointId, after);
    let saved = false;
    try {
      saved = await this.deps.persist(pointId, after);
    } catch {
      saved = false;
    }
    if (!saved) {
      const current = this.deps.read(pointId);
      if (current) {
        const currentState = scorerState(current);
        const stillOwnsOutcome =
          currentState.confirmed_winner === after.confirmed_winner &&
          currentState.is_let === after.is_let;
        if (stillOwnsOutcome) {
          const stillOwnsObservation =
            currentState.scored_at_cut_s === after.scored_at_cut_s &&
            sameTimingGuard(scorerTimingGuard(current), timing);
          this.deps.apply(pointId, {
            confirmed_winner: before.confirmed_winner,
            is_let: before.is_let,
            scored_at_cut_s: before.is_let
              ? null
              : stillOwnsObservation
                ? before.scored_at_cut_s
                : currentState.scored_at_cut_s,
          });
        }
      }
      return { failed: true };
    }
    return { pointId, before, after, timing };
  }

  private enqueue<T>(pointId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(pointId) ?? Promise.resolve();
    const result = previous.then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(pointId, tail);
    void tail.then(() => {
      if (this.tails.get(pointId) === tail) this.tails.delete(pointId);
    });
    return result;
  }
}

export function scorerTimingGuard(
  point: ScorerTimingGuard,
): ScorerTimingGuard {
  return {
    cut_t0: point.cut_t0,
    t0: point.t0,
    t1: point.t1,
    edited: point.edited,
    tight_start: point.tight_start,
    tight_end: point.tight_end,
  };
}

function sameTimingGuard(
  a: ScorerTimingGuard,
  b: ScorerTimingGuard,
): boolean {
  return (
    a.cut_t0 === b.cut_t0 &&
    a.t0 === b.t0 &&
    a.t1 === b.t1 &&
    a.edited === b.edited &&
    a.tight_start === b.tight_start &&
    a.tight_end === b.tight_end
  );
}

export function applySynchronousStateUpdate<T>(
  ref: { current: T },
  commit: (next: T) => void,
  update: T | ((current: T) => T),
): T {
  const next =
    typeof update === "function"
      ? (update as (current: T) => T)(ref.current)
      : update;
  ref.current = next;
  commit(next);
  return next;
}
