/**
 * Who the captures sign in as.
 *
 * Out of the source and into the environment because this repo is public and
 * these are real, working addresses: capture.mjs mints a magic link for
 * whatever is set here, so an address committed next to that code is an
 * address anyone can read off GitHub. The coach one is not even ours to
 * publish.
 *
 * Set them before a run:
 *
 *   export TUTORIAL_ACCOUNT="you@example.com"   # the match owner
 *   export TUTORIAL_COACH="coach@example.com"   # only chapter 8 needs this
 *
 * All nine chapters are shot from real matches, so TUTORIAL_ACCOUNT is
 * always required; the coach address is read lazily so the other eight do
 * not have to set it.
 */

const need = (name, why) => {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} env var required — ${why}`);
    process.exit(1);
  }
  return v;
};

/** The account whose real matches the player chapters are shot from.
 *
 * Keep this named string export for every existing player flow, but do not
 * fail while a coach-only module is being imported. The capture driver owns
 * the player fallback/requirement; coach modules never consume this value.
 */
export const account = process.env.TUTORIAL_ACCOUNT;

/** The coach side of chapter 8, which is captured from both ends. */
export const coach = () =>
  need("TUTORIAL_COACH", "the coach account chapter 8 signs in as");

/** The roster owner used by every coach-course browser chapter. */
export const coachAccount = () =>
  need("TUTORIAL_COACH", "the staged coach whose workspace is captured");

/** The connected player shown from the coach's roster. */
export const student = () =>
  need("TUTORIAL_STUDENT", "the staged student connected to the tutorial coach");
