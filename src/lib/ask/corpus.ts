// Relative, with extensions: this module is covered by `node --test`,
// which does not resolve the "@/" alias (same reason src/lib/recollect
// imports its neighbours this way).
import type { AggregateStats } from "../../app/stats/aggregate.ts";
import { deriveMatchTitle } from "../matchTitle.ts";
import type { Lesson, NoteFeedRow } from "../types.ts";

/**
 * The corpus Ask reasons over: everything the player has written, plus
 * every number the app has already worked out for them.
 *
 * Two rules shape this file.
 *
 * ONE — there is no retrieval step. The whole journal goes in the prompt.
 * The heaviest journal in production is about 19k tokens against an input
 * window of 922k, so selecting a subset could only ever lose something.
 * The way an "ask your notes" feature answers badly is that it retrieves
 * over a slice and misses; a corpus that holds everything cannot.
 *
 * TWO — THE MODEL NEVER COUNTS. It reads counts. Handing over 1,119 rows
 * of "point 34: lost, net" and asking for a rate is asking a language
 * model to do arithmetic across a haystack, which is exactly how these
 * features produce confident wrong numbers. Every figure below is computed
 * in TypeScript by the same functions that draw the Stats page, so an
 * answer and the screen behind it can never disagree.
 */

export type AskCoverage = "full" | "takeaways" | "recent";

/** A citable thing. Short ids keep the prompt small and make validating a
 *  citation a set lookup rather than a parse. */
export interface AskSource {
  /** 'n3', 'l1', 'm7' — what the model must cite. */
  id: string;
  kind:
    | "note"
    | "lesson"
    | "practice"
    | "coach"
    | "match"
    | "working_on"
    | "tags"
    | "profile";
  title: string;
  /** Where tapping it goes in the app. */
  href: string;
  /** ISO date, for ordering the cards under an answer. */
  when: string;
}

export interface AskCorpus {
  text: string;
  sources: AskSource[];
  coverage: AskCoverage;
  approxTokens: number;
  /** Nothing to answer from: the caller should say so without spending a
   *  request on it. */
  empty: boolean;
}

/**
 * The ceiling, in tokens. Luna would take five times this, so the number
 * is not a technical limit — it is the cost bound.
 *
 * Worst case per ask is 120k x $0.20/1M = $0.024. At the per-user daily
 * limit of 25 that is $0.60 a day for one determined person, and the
 * global daily limit caps the whole platform regardless. For scale: the
 * heaviest real journal today is 21k tokens, or $0.004 an ask, so this
 * bound sits about six times above anything real and only ever binds on
 * an account trying to make it bind.
 */
export const MAX_CORPUS_TOKENS = 120_000;

/** Rough and deliberately conservative: English prose runs about 4 chars
 *  a token, and over-estimating spends budget rather than blowing it. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function pct(n: number | null): string {
  return n === null ? "n/a" : `${n}%`;
}

// ---------------------------------------------------------------------------
// Match facts — precomputed, never derived by the model
// ---------------------------------------------------------------------------

export function matchFactsSection(
  stats: AggregateStats,
  matchSources: Map<string, string>,
): string {
  if (stats.matchesWithScores === 0) {
    return "## YOUR MATCHES\nNo scored matches yet.\n";
  }
  const lines: string[] = ["## YOUR MATCHES"];

  const wins = stats.results.filter((r) => r.gamesYou > r.gamesThem).length;
  const losses = stats.results.filter((r) => r.gamesYou < r.gamesThem).length;
  const level = stats.results.length - wins - losses;
  lines.push(
    `Scored matches: ${stats.results.length} (${wins} won, ${losses} lost` +
      (level > 0 ? `, ${level} level with no winner` : "") +
      ").",
  );
  lines.push(
    `Points across every scored match: ${stats.points.won} won, ${stats.points.lost} lost.`,
  );
  lines.push(`Games: ${stats.games.you} won, ${stats.games.them} lost.`);
  lines.push(
    `Serving ${pct(stats.serve.pct)} (${stats.serve.won}/${stats.serve.played}), ` +
      `receiving ${pct(stats.receive.pct)} (${stats.receive.won}/${stats.receive.played}).`,
  );
  lines.push(
    `At 9+ (pressure points) ${pct(stats.pressure.pct)} ` +
      `(${stats.pressure.won}/${stats.pressure.played}). ` +
      `Point right after losing one: ${pct(stats.bounceBack.pct)} ` +
      `(${stats.bounceBack.won}/${stats.bounceBack.played}).`,
  );
  if (stats.deuceGames.won + stats.deuceGames.lost > 0) {
    lines.push(
      `Games that reached 10-10: ${stats.deuceGames.won} won, ${stats.deuceGames.lost} lost.`,
    );
  }
  lines.push(`Longest run of points won in a row: ${stats.longestStreak}.`);

  // Only opponents with a decided result. An opponent whose only match
  // came out level lands here as "0 won, 0 lost", which reads as "you have
  // never played them" immediately after the answer has said you drew with
  // them. Silence is more honest than a pair of zeroes.
  const decided = stats.opponents.filter((o) => o.won + o.lost > 0);
  if (decided.length > 0) {
    lines.push("");
    lines.push(
      "Record against each opponent, counting only matches that produced " +
        "a winner:",
    );
    for (const o of decided) {
      lines.push(`- ${o.name}: ${o.won} won, ${o.lost} lost`);
    }
  }

  lines.push("");
  lines.push(
    "Every scored match, newest first. Won/lost is the games result, " +
      "already worked out:",
  );
  // aggregateStats returns results oldest first; questions are almost
  // always about the recent end, and "last 10" must not require the model
  // to reverse a list correctly.
  for (const r of [...stats.results].reverse()) {
    const id = matchSources.get(r.id);
    // Three outcomes, not two. A match whose scored games came out level
    // is not a loss, and calling it one puts "lost 1-1" in front of the
    // player — which is exactly the kind of wrong number this whole file
    // exists to prevent. The model repeats what it is given, so what it
    // is given has to be right.
    const outcome =
      r.gamesYou > r.gamesThem
        ? "WON"
        : r.gamesYou < r.gamesThem
          ? "LOST"
          : "LEVEL (no winner in the scored games)";
    const bits = [
      id ? `[${id}]` : null,
      shortDate(r.played_at),
      r.opponent ? `vs ${r.opponent}` : "vs unnamed opponent",
      r.match_type ?? null,
      `${outcome} ${r.gamesYou}-${r.gamesThem}`,
      `(${r.ptsYou}-${r.ptsThem} points)`,
    ].filter(Boolean);
    lines.push(`- ${bits.join(" · ")}`);
  }

  if (stats.lossReasons.length > 0) {
    lines.push("");
    lines.push(
      `Why you said you lost points (${stats.totalLost} lost points total, ` +
        "reasons given on some of them):",
    );
    for (const c of stats.lossReasons) {
      lines.push(`- ${c.label}: ${c.count}`);
    }
  }

  const mine = stats.serveMine;
  if (mine.count > 0) {
    lines.push("");
    lines.push(`Your serves, where you described them (${mine.count} points):`);
    for (const t of mine.spins) {
      lines.push(`- ${t.label}: ${t.won} won, ${t.lost} lost`);
    }
    for (const t of mine.lengths) {
      lines.push(`- ${t.label}: ${t.won} won, ${t.lost} lost`);
    }
  }
  const theirs = stats.serveTheirs;
  if (theirs.count > 0) {
    lines.push("");
    lines.push(`Serves you received (${theirs.count} points):`);
    for (const t of theirs.spins) {
      lines.push(`- ${t.label}: ${t.won} won, ${t.lost} lost`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function lessonBlock(
  l: Lesson,
  id: string,
  includeTranscript: boolean,
): string {
  const head = [
    `[${id}]`,
    l.kind === "practice" ? "Practice entry" : "Lesson",
    l.coach_name ? `with ${l.coach_name}` : null,
    shortDate(l.created_at),
    l.takeaways?.title ? `"${l.takeaways.title}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const parts = [head];
  if (l.takeaways?.themes?.length) {
    parts.push("Takeaways:");
    for (const theme of l.takeaways.themes) {
      parts.push(`  ${theme.name}: ${theme.points.join("; ")}`);
    }
  }
  if (includeTranscript && l.transcript.trim()) {
    parts.push("What was actually said:");
    parts.push(l.transcript.trim());
  }
  return parts.join("\n");
}

/** An entry a coach shared with the player (156): their words, read as
 *  material like everything else, never as instructions. */
export interface CoachEntryLite {
  entry_id: string;
  coach_name: string;
  transcript: string;
  takeaways: {
    title?: string | null;
    themes?: { name: string; points: string[] }[] | null;
  } | null;
  shared_at: string;
}

function coachEntryBlock(
  e: CoachEntryLite,
  id: string,
  includeTranscript: boolean,
): string {
  const head = [
    `[${id}]`,
    `Entry your coach ${e.coach_name} shared`,
    shortDate(e.shared_at),
    e.takeaways?.title ? `"${e.takeaways.title}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const parts = [head];
  if (e.takeaways?.themes?.length) {
    parts.push("Takeaways:");
    for (const theme of e.takeaways.themes) {
      parts.push(`  ${theme.name}: ${theme.points.join("; ")}`);
    }
  }
  if ((includeTranscript || !e.takeaways?.themes?.length) && e.transcript.trim()) {
    parts.push("What the coach wrote:");
    parts.push(e.transcript.trim());
  }
  return parts.join("\n");
}

function noteBlock(n: NoteFeedRow, id: string, title: string): string {
  const head = [
    `[${id}]`,
    "Note on",
    title,
    n.point_id ? "on a specific point" : null,
    `written by ${n.author_name?.trim() || "you"}`,
    shortDate(n.created_at),
  ]
    .filter(Boolean)
    .join(" · ");
  const body = n.body.trim();
  const media = !body
    ? n.audio_path
      ? "(a voice note with no typed words)"
      : n.image_path
        ? "(a drawing with no typed words)"
        : "(empty)"
    : body;
  return `${head}\n${media}`;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface CorpusInput {
  notes: NoteFeedRow[];
  lessons: Lesson[];
  /** Entries coaches shared with the player. Optional: older callers and
   *  the tier tests build without them. */
  coachEntries?: CoachEntryLite[];
  stats: AggregateStats | null;
  matchTitles: Map<string, { title: string; when: string }>;
  focusPoints: { label: string; done: boolean }[];
  tags: { label: string; points: number; entries: number }[];
  profile: {
    handedness?: string | null;
    grip?: string | null;
    style?: string | null;
  } | null;
}

/** Build at one coverage tier. Exported for the tier tests. */
export function buildAtCoverage(
  input: CorpusInput,
  coverage: AskCoverage,
): AskCorpus {
  const sources: AskSource[] = [];
  const sections: string[] = [];

  // Recent tier: a year back. Long enough that "this season" still works,
  // short enough to halve a heavy journal.
  const cutoff =
    coverage === "recent"
      ? Date.now() - 365 * 24 * 3600 * 1000
      : Number.NEGATIVE_INFINITY;
  const recentEnough = (iso: string) => new Date(iso).getTime() >= cutoff;

  const lessons = input.lessons.filter((l) => recentEnough(l.created_at));
  const notes = input.notes.filter((n) => recentEnough(n.created_at));
  const coachEntries = (input.coachEntries ?? []).filter((e) =>
    recentEnough(e.shared_at),
  );

  if (input.profile) {
    const bits = [
      input.profile.handedness ? `${input.profile.handedness}-handed` : null,
      input.profile.grip ? `${input.profile.grip} grip` : null,
      input.profile.style ? `plays ${input.profile.style}` : null,
    ].filter(Boolean);
    if (bits.length > 0) {
      // Citable like everything else. Without an id, "am I right-handed?"
      // has an answer the model cannot attribute, and an unattributable
      // sentence is dropped — a false refusal on a question the corpus
      // plainly answers. Same fix working-on and tags already needed.
      sections.push(`## [p1] THE PLAYER\n${bits.join(", ")}.\n`);
      sources.push({
        id: "p1",
        kind: "profile",
        title: "Your player profile",
        href: "/account/player",
        when: new Date(0).toISOString(),
      });
    }
  }

  // Matches are citable, so they get ids before the facts section renders.
  const matchIds = new Map<string, string>();
  if (input.stats) {
    input.stats.results.forEach((r, i) => {
      const id = `m${i + 1}`;
      matchIds.set(r.id, id);
      const meta = input.matchTitles.get(r.id);
      sources.push({
        id,
        kind: "match",
        title:
          meta?.title ??
          deriveMatchTitle({
            opponentName: r.opponent,
            playedAt: r.played_at,
          }),
        href: `/match/${r.id}`,
        when: r.played_at,
      });
    });
    sections.push(matchFactsSection(input.stats, matchIds));
  }

  const writing: string[] = [];
  lessons.forEach((l, i) => {
    const id = `l${i + 1}`;
    writing.push(lessonBlock(l, id, coverage === "full"));
    sources.push({
      id,
      kind: l.kind === "practice" ? "practice" : "lesson",
      title:
        l.takeaways?.title ||
        (l.kind === "practice" ? "Practice entry" : "Lesson") +
          (l.coach_name ? ` with ${l.coach_name}` : ""),
      href: `/journal#journal-entry-${l.id}`,
      when: l.created_at,
    });
  });
  coachEntries.forEach((e, i) => {
    const id = `c${i + 1}`;
    writing.push(coachEntryBlock(e, id, coverage === "full"));
    sources.push({
      id,
      kind: "coach",
      title: e.takeaways?.title || `From your coach ${e.coach_name}`,
      href: "/journal",
      when: e.shared_at,
    });
  });
  notes.forEach((n, i) => {
    const id = `n${i + 1}`;
    const meta = input.matchTitles.get(n.match_id);
    const title =
      meta?.title ??
      deriveMatchTitle({
        opponentName: n.opponent_name,
        venue: n.venue,
        playedAt: n.played_at,
      });
    writing.push(noteBlock(n, id, title));
    sources.push({
      id,
      kind: "note",
      title,
      href: n.point_id
        ? `/match/${n.match_id}?p=${n.point_id}`
        : `/match/${n.match_id}`,
      when: n.created_at,
    });
  });
  if (writing.length > 0) {
    const header =
      coverage === "full"
        ? "## WHAT YOU HAVE WRITTEN"
        : "## WHAT YOU HAVE WRITTEN (lesson transcripts left out to fit)";
    sections.push(`${header}\n\n${writing.join("\n\n")}\n`);
  }

  // These two sections get ids of their own. Without them a question like
  // "what am I working on" has nothing citable to point at, and since an
  // uncited sentence is dropped, the model's only way to answer at all is
  // to attach whichever lesson id is nearest — which was observed, and
  // produces an answer footnoted to a source it did not come from.
  if (input.focusPoints.length > 0) {
    const lines = input.focusPoints.map(
      (f) => `- ${f.label}${f.done ? " (ticked off)" : ""}`,
    );
    sections.push(`## [w1] WHAT YOU ARE WORKING ON\n${lines.join("\n")}\n`);
    sources.push({
      id: "w1",
      kind: "working_on",
      title: "What you are working on",
      href: "/journal",
      when: new Date(0).toISOString(),
    });
  }

  if (input.tags.length > 0) {
    const lines = input.tags.map(
      (t) => `- ${t.label}: ${t.points} points, ${t.entries} journal entries`,
    );
    sections.push(`## [t1] YOUR TAGS\n${lines.join("\n")}\n`);
    sources.push({
      id: "t1",
      kind: "tags",
      title: "Your tags",
      href: "/journal",
      when: new Date(0).toISOString(),
    });
  }

  const text = sections.join("\n");
  return {
    text,
    sources,
    coverage,
    approxTokens: approxTokens(text),
    empty: writing.length === 0 && (input.stats?.matchesWithScores ?? 0) === 0,
  };
}

/**
 * Build the corpus, stepping down through the tiers until it fits.
 *
 * The order is deliberate. Dropping lesson TRANSCRIPTS first is the right
 * first cut because takeaways are the same lesson already distilled, about
 * twenty times smaller, and losing the raw words costs far less than
 * losing whole entries. Only when that is not enough does the window
 * shorten. A hard truncation backstops both, so a journal padded on
 * purpose runs into a wall rather than a bill.
 */
export function buildCorpus(input: CorpusInput): AskCorpus {
  const tiers: AskCoverage[] = ["full", "takeaways", "recent"];
  let built = buildAtCoverage(input, "full");
  for (const tier of tiers) {
    built = buildAtCoverage(input, tier);
    if (built.approxTokens <= MAX_CORPUS_TOKENS) return built;
  }
  // Still over after every tier: cut the text itself. Sources stay as they
  // are — a citation the answer cannot support is dropped later anyway,
  // and inventing a source id here would be worse than an unused one.
  //
  // The notice is measured and subtracted BEFORE slicing. Appending it
  // afterwards is how a hard ceiling ends up a few tokens soft, which
  // defeats the point of having one.
  const notice =
    "\n\n[This journal is larger than one answer can read. The oldest " +
    "material has been left out.]\n";
  const keep = Math.max(
    0,
    Math.floor((MAX_CORPUS_TOKENS - approxTokens(notice)) * 3.6),
  );
  const text = built.text.slice(0, keep) + notice;
  return { ...built, text, approxTokens: approxTokens(text) };
}
