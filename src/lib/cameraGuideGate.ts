/**
 * How often a first-run account is shown camera advice without asking for
 * it.
 *
 * Two things ride on this rule. The "Where to place the camera" sheet was
 * the first: it opened on its own, twice, at the doors into recording and
 * uploading. The recording brief replaced that automatic showing in
 * September: five pages, once, with no way out except through them. The
 * sheet itself is still there behind every "How to record" link, and a
 * manual open never counts against anything.
 *
 * Twin of CameraGuideGate.swift. The same question has to get the same
 * answer on both platforms, and both are checked against the same table of
 * cases (cameraGuideGate.test.ts / CameraGuideGateTests.swift) rather than
 * each being read against the prose separately — this project has shipped
 * one rule written twice and wrong the same way in both.
 */

export const CAMERA_GUIDE_MAX_SHOWINGS = 2;

/** Lives beside first_steps_dismissed and tutorial_started. */
export const CAMERA_GUIDE_METADATA_KEY = "camera_guide_seen";

/**
 * The device-local mirror, keyed by user id because one browser and one
 * simulator both get shared between accounts.
 */
export function cameraGuideStorageKey(userId: string): string {
  return `pl-camera-guide-seen:${userId}`;
}

function coerce(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  // localStorage only holds strings, so the string branch is the common
  // one on web rather than a defensive afterthought.
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

/**
 * The count, read from both copies at once.
 *
 * The account copy (user_metadata) is what makes "twice" mean twice for
 * the person rather than twice per device. The device copy is what holds
 * the cap when the network does not: the likeliest place to be opening the
 * recorder is a sports hall with bad wifi, and if the write to Supabase
 * fails there, an account-only counter never moves and the sheet comes
 * back a third and a fourth time.
 *
 * null — and only null — means neither copy has ever been written, which
 * is what separates a new account from one seeded to zero.
 */
export function readSeenCount(account: unknown, device: unknown): number | null {
  const a = coerce(account);
  const d = coerce(device);
  if (a === null && d === null) return null;
  return Math.max(a ?? 0, d ?? 0);
}

export type CameraGuideDecision = {
  /** Open the sheet now, unasked. */
  show: boolean;
  /** Write this to both copies, or null when nothing needs writing. */
  persist: number | null;
};

/**
 * @param seen             readSeenCount(), null when never recorded
 * @param hasAnyMatch      does the account already have footage in it
 * @param shownThisSession has one already opened this launch / this tab
 * @param max              how many automatic showings an account gets
 */
export function cameraGuideGate({
  seen,
  hasAnyMatch,
  shownThisSession,
  max = CAMERA_GUIDE_MAX_SHOWINGS,
}: {
  seen: number | null;
  hasAnyMatch: boolean;
  shownThisSession: boolean;
  max?: number;
}): CameraGuideDecision {
  let effective = seen;
  let seed: number | null = null;

  // Back-fill. Nobody has a counter on the day this ships, so without this
  // every existing account gets interrupted — including accounts with
  // forty matches that plainly know where the camera goes.
  //
  // Keyed on ABSENT, never on zero. A genuinely new account that has just
  // recorded its first match sits at 1 and must still get its second
  // showing, so "already has footage" can only be asked once, before the
  // counter exists.
  if (seen === null && hasAnyMatch) {
    effective = max;
    seed = max;
  }

  // At most one automatic showing per launch. Without it, tapping Record
  // and then Upload in the same five minutes spends the whole budget two
  // minutes apart and the second showing teaches nothing. It also means a
  // refresh of /upload cannot burn the budget, with no line written for
  // that case.
  if (shownThisSession) return { show: false, persist: seed };

  const count = effective ?? 0;
  if (count < max) {
    return { show: true, persist: count + 1 };
  }
  return { show: false, persist: seed };
}

// ---------------------------------------------------------------------------
// The recording brief
// ---------------------------------------------------------------------------

/**
 * Once. Five pages twice would be a chore, and stepping through them is
 * what makes them land, so one walk is the whole budget.
 */
export const RECORDING_BRIEF_MAX_SHOWINGS = 1;

/** Beside camera_guide_seen. The old key is left exactly as it was. */
export const RECORDING_BRIEF_METADATA_KEY = "recording_brief_seen";

/** What both copies hold once the last page's button has been tapped. */
export const RECORDING_BRIEF_DONE = 1;

export function recordingBriefStorageKey(userId: string): string {
  return `pl-recording-brief-seen:${userId}`;
}

export type RecordingBriefDecision = {
  /** Open the brief now, at page one. */
  show: boolean;
  /**
   * Write this to both copies right now, or null. Only ever the back-fill:
   * the brief counts itself as seen when it is FINISHED, not when it opens,
   * so that quitting halfway brings it back from page one next time. That
   * write is RECORDING_BRIEF_DONE and belongs to the caller's completion
   * handler, never to this decision.
   */
  seed: number | null;
};

/**
 * @param seen        readSeenCount() over the brief's two copies
 * @param hasAnyMatch does the account already have footage in it
 */
export function recordingBriefGate({
  seen,
  hasAnyMatch,
}: {
  seen: number | null;
  hasAnyMatch: boolean;
}): RecordingBriefDecision {
  // No per-launch clause: with a budget of one there is nothing left to
  // space out, and an abandoned walk is meant to return.
  const d = cameraGuideGate({
    seen,
    hasAnyMatch,
    shownThisSession: false,
    max: RECORDING_BRIEF_MAX_SHOWINGS,
  });
  // When the answer is "show", persist is the completion value, which is
  // not written until the walk is finished. Only a no-show carries a seed.
  return { show: d.show, seed: d.show ? null : d.persist };
}
