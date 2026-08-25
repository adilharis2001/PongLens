/**
 * How often a first-run account is shown "Where to place the camera"
 * without asking for it.
 *
 * Where the camera goes decides whether the pipeline finds any points at
 * all, so the sheet now opens on its own at the doors into recording and
 * uploading. Twice, then never again — long enough to be read, short
 * enough that it never becomes the thing you swipe away on the way to
 * somewhere else.
 *
 * Twin of CameraGuideGate.swift. The same question has to get the same
 * answer on both platforms, and both are checked against the same table of
 * cases (cameraGuideGate.test.ts / CameraGuideGateTests.swift) rather than
 * each being read against the prose separately — this project has shipped
 * one rule written twice and wrong the same way in both.
 *
 * Manual opens are deliberately NOT counted. The "How to record" trigger
 * stays on every screen it is on today and spends nothing, because the two
 * automatic showings are worth saving for the moment somebody is standing
 * at a table about to film.
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
 */
export function cameraGuideGate({
  seen,
  hasAnyMatch,
  shownThisSession,
}: {
  seen: number | null;
  hasAnyMatch: boolean;
  shownThisSession: boolean;
}): CameraGuideDecision {
  let effective = seen;
  let seed: number | null = null;

  // Back-fill. Nobody has a counter on the day this ships, so without this
  // every existing account gets interrupted twice — including accounts
  // with forty matches that plainly know where the camera goes.
  //
  // Keyed on ABSENT, never on zero. A genuinely new account that has just
  // recorded its first match sits at 1 and must still get its second
  // showing, so "already has footage" can only be asked once, before the
  // counter exists.
  if (seen === null && hasAnyMatch) {
    effective = CAMERA_GUIDE_MAX_SHOWINGS;
    seed = CAMERA_GUIDE_MAX_SHOWINGS;
  }

  // At most one automatic showing per launch. Without it, tapping Record
  // and then Upload in the same five minutes spends the whole budget two
  // minutes apart and the second showing teaches nothing. It also means a
  // refresh of /upload cannot burn the budget, with no line written for
  // that case.
  if (shownThisSession) return { show: false, persist: seed };

  const count = effective ?? 0;
  if (count < CAMERA_GUIDE_MAX_SHOWINGS) {
    return { show: true, persist: count + 1 };
  }
  return { show: false, persist: seed };
}
