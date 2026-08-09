/**
 * Reading the model's answer, and refusing to believe the parts of it that
 * are not traceable.
 *
 * The whole trust argument for Ask rests here. The prompt asks for a
 * citation on every sentence, but a prompt is a request, not a guarantee:
 * a model under pressure to be helpful will write a fluent sentence and
 * attach a plausible-looking id, or none at all. So the ids are checked
 * against the corpus that was actually sent, and a sentence that cannot be
 * traced does not ship. An uncited claim never reaches the screen, whether
 * the model meant well or not.
 */

export type AskRefusal = "not_in_journal" | "off_topic";

export interface AnswerPart {
  text: string;
  sourceIds: string[];
}

export interface AskResult {
  answer: AnswerPart[];
  refused: AskRefusal | null;
  /** Sentences dropped for citing nothing we sent. Logged, not shown: it
   *  is the number that says whether the model is drifting. */
  dropped: number;
}

/** Ids as they appear in the corpus: n3, l1, m12. */
const INLINE_ID = /\[([a-z]\d+)\]/g;

/**
 * The model writes "[l1]" into the sentence as well as into sourceIds,
 * however plainly the prompt asks it not to. Prompting harder is not a
 * fix — an id in the prose is a rendering bug the reader sees.
 *
 * So the ids are lifted OUT of the text and treated as what they are:
 * citations. A sentence that names its source only inline is properly
 * cited and should not be thrown away for putting it in the wrong field.
 */
function extractInlineIds(text: string): {
  clean: string;
  ids: string[];
} {
  const ids = [...text.matchAll(INLINE_ID)].map((m) => m[1]);
  const clean = text
    .replace(INLINE_ID, "")
    // A stripped id leaves a gap, and often a space before the full stop.
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return { clean, ids };
}

export function validateAnswer(
  raw: string,
  knownIds: Set<string>,
): AskResult | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = (data ?? {}) as Record<string, unknown>;
  const refusedRaw = obj.refused;
  const refused: AskRefusal | null =
    refusedRaw === "not_in_journal" || refusedRaw === "off_topic"
      ? refusedRaw
      : null;

  const parts = Array.isArray(obj.answer) ? obj.answer : [];
  const answer: AnswerPart[] = [];
  let dropped = 0;
  for (const part of parts) {
    const p = (part ?? {}) as Record<string, unknown>;
    const { clean: text, ids: inlineIds } = extractInlineIds(
      String(p.text ?? ""),
    );
    if (!text) continue;
    const declared = Array.isArray(p.sourceIds)
      ? p.sourceIds.map((id) => String(id))
      : [];
    const ids = [...new Set([...declared, ...inlineIds])].filter((id) =>
      knownIds.has(id),
    );
    // A refusal has nothing to cite by definition, so it is allowed
    // through uncited. Every other sentence must be traceable.
    if (ids.length === 0 && !refused) {
      dropped++;
      continue;
    }
    answer.push({ text, sourceIds: ids });
  }
  // Everything was invented, or there was nothing to begin with. Better to
  // show the failure than a hollowed-out answer.
  if (answer.length === 0 && !refused) return null;
  return { answer, refused, dropped };
}
