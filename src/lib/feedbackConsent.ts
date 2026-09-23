/**
 * Whether a feedback post may go through the tidy step, which sends its
 * words to OpenAI (Adil, 2026-09-22).
 *
 *   allowed         yes, silently.
 *   switched off    no, and no sheet: the post stands as the author wrote
 *                   it. Asking again on every post would be nagging.
 *   never answered  the consent sheet, once per browser. "Not now" writes
 *                   nothing to the account, so "never asked" and "said not
 *                   now" look the same in the database; this browser's
 *                   memory is what stops the sheet reappearing on the next
 *                   post. Losing that memory costs one extra sheet.
 *
 * The iPhone app follows the same rule in FeedbackScreen.swift.
 */

const ASKED_KEY = "ponglens.feedback-ai-asked";

export async function mayTidyFeedback(
  enabled: boolean | null,
  ensure: () => Promise<boolean>,
): Promise<boolean> {
  if (enabled === true) return true;
  if (enabled === false) return false;
  try {
    if (window.localStorage.getItem(ASKED_KEY)) return false;
    window.localStorage.setItem(ASKED_KEY, new Date().toISOString());
  } catch {
    // Storage blocked: fall through and ask; worst case is a repeat sheet.
  }
  return ensure();
}
