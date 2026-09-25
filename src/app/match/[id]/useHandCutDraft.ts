"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DraftSave } from "./MarkPoints";
import { normalizeMarks, type CutMode, type Mark } from "./handCut";

/**
 * A match's hand-cut draft: the marks made so far, the pass they were made
 * in, and the saving that never overwrites a newer copy. One hook for the
 * unprocessed page and for marking a processed match again, so the two
 * cannot drift on the rules below.
 */
export function useHandCutDraft(matchId: string, userId: string, enabled: boolean) {
  const [marks, setMarks] = useState<Mark[]>([]);
  /** Cutting only, or cutting and scoring: the owner's own choice, kept
   *  on the row so reopening does not have to guess at it. */
  const [mode, setMode] = useState<CutMode | null>(null);
  /** The row was sent (claim_hand_cut froze it). A sent draft is the cut
   *  that made the match, not marking in progress. */
  const [submitted, setSubmitted] = useState(false);
  /**
   * The row is still what start_recut wrote from a processed match's
   * points, untouched (20260925133555). Opening the marker and closing it
   * again is looking, not marking, so a prefilled draft counts as nothing
   * marked yet. The database clears the flag on the first save that
   * changes the marks, whichever app made it.
   */
  const [prefilled, setPrefilled] = useState(false);
  /**
   * Does the hand-cut backend exist yet?
   *
   * Self-disabling rather than config-gated: the draft read below answers
   * it. Until the migration runs the table is missing, the read errors,
   * this stays false and the row never appears — so the code can ship
   * ahead of the schema without offering anyone a button that cannot
   * finish. It reveals itself the moment the migration lands.
   */
  const [ready, setReady] = useState(false);
  /**
   * The draft row's updated_at as this page last read or wrote it, or null
   * when there is no row.
   *
   * Every save is conditional on it: a write lands only if the row still
   * carries the stamp this page knows, so a draft saved since on another
   * device (the iPhone marks the same row) is never overwritten. The
   * newer draft wins, and this page stops saving until it is reopened.
   */
  const stamp = useRef<string | null>(null);
  /** Saves run one at a time, so each carries the stamp the last left. */
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  /** Each opening of the marker is a session; a conflict ends saving for
   *  the session it happened in, and reopening starts a fresh one. */
  const markerSession = useRef(0);
  const conflictSession = useRef(-1);

  /**
   * Marking already done on this match, so re-opening resumes rather than
   * starting over. Read in either stored shape (normalizeMarks): a draft
   * handed back after a failed cut holds the short form claim_hand_cut
   * was sent, which cast straight to marks read as every point called.
   *
   * Resolves false when the read failed. A missing table (the migration
   * has not run yet) is not an error the player should be shown: it
   * simply means no draft, and the feature stays hidden.
   */
  const load = useCallback(async (): Promise<boolean> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("hand_cut_drafts")
      .select("marks, mode, updated_at, submitted_at, prefilled")
      .eq("match_id", matchId)
      .maybeSingle();
    if (error) return false;
    const row = data as {
      marks?: unknown;
      mode?: string | null;
      updated_at?: string | null;
      submitted_at?: string | null;
      prefilled?: boolean | null;
    } | null;
    setMarks(normalizeMarks(row?.marks));
    setMode(row?.mode === "cut" || row?.mode === "score" ? row.mode : null);
    setSubmitted(row?.submitted_at != null);
    setPrefilled(row?.prefilled === true);
    stamp.current = row?.updated_at ?? null;
    return true;
  }, [matchId]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void load().then((ok) => {
      if (active && ok) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [enabled, load]);

  /**
   * Take a draft the database has just written (start_recut) as the one
   * this page knows, stamp included, so the saves that follow are
   * conditional updates of that row.
   *
   * start_recut hands back either the player's own unsent draft or a
   * fresh prefill, and its answer does not say which, so the flag is read
   * from the row at exactly that stamp. A save that lands first carries
   * its own flag and wins.
   */
  const adopt = useCallback(
    (raw: unknown, recorded: unknown, updatedAt: string | null): Mark[] => {
      const next = normalizeMarks(raw);
      setMarks(next);
      setMode(recorded === "cut" || recorded === "score" ? recorded : null);
      setSubmitted(false);
      stamp.current = updatedAt;
      if (updatedAt) {
        void createClient()
          .from("hand_cut_drafts")
          .select("prefilled")
          .eq("match_id", matchId)
          .eq("updated_at", updatedAt)
          .maybeSingle()
          .then(({ data }) => {
            if (data && stamp.current === updatedAt) {
              setPrefilled((data as { prefilled?: boolean | null }).prefilled === true);
            }
          });
      }
      return next;
    },
    [matchId],
  );

  /** A new opening of the marker. */
  const beginSession = useCallback(() => {
    markerSession.current += 1;
  }, []);

  /**
   * Write the draft, but never over a newer one.
   *
   * A plain insert when there is no row yet and an update conditional on
   * the stamp otherwise, never an upsert: an upsert's conflict branch
   * rewrites match_id and user_id too, and the owner may only update
   * marks, mode and updated_at (20260909181000), so every upsert after
   * the first was refused. Resolves "conflict" when another device got
   * there first; rejects on a network or server failure, which the
   * marker retries on its next save.
   */
  const save = useCallback(
    (next: Mark[], nextMode: CutMode | null): Promise<DraftSave> => {
      const session = markerSession.current;
      const conflict = (): DraftSave => {
        conflictSession.current = session;
        // Read the newer draft now, so the row's count and the next
        // opening show it.
        void load();
        return "conflict";
      };
      const write = async (): Promise<DraftSave> => {
        if (conflictSession.current === session) return "conflict";
        const supabase = createClient();
        const now = new Date().toISOString();
        const known = stamp.current;
        if (known === null) {
          const { data, error: insertError } = await supabase
            .from("hand_cut_drafts")
            .insert({ match_id: matchId, user_id: userId, marks: next, mode: nextMode, updated_at: now })
            .select("updated_at, prefilled")
            .single();
          if (insertError) {
            // The row appeared since this page last looked.
            if (insertError.code === "23505") return conflict();
            throw insertError;
          }
          const row = data as { updated_at: string; prefilled?: boolean | null };
          stamp.current = row.updated_at;
          setPrefilled(row.prefilled === true);
        } else {
          const { data, error: updateError } = await supabase
            .from("hand_cut_drafts")
            .update({ marks: next, mode: nextMode, updated_at: now })
            .eq("match_id", matchId)
            .eq("updated_at", known)
            .select("updated_at, prefilled");
          if (updateError) throw updateError;
          const rows = (data ?? []) as { updated_at: string; prefilled?: boolean | null }[];
          // Nothing matched: the row was saved since (or sent, or gone).
          if (rows.length === 0) return conflict();
          stamp.current = rows[0].updated_at;
          // The trigger's verdict: still the untouched prefill, or marked.
          setPrefilled(rows[0].prefilled === true);
        }
        setMarks(next);
        setMode(nextMode);
        return "saved";
      };
      const run = saveQueue.current.then(write, write);
      saveQueue.current = run.catch(() => undefined);
      return run;
    },
    [matchId, userId, load],
  );

  return { marks, mode, submitted, prefilled, ready, load, adopt, beginSession, save };
}
