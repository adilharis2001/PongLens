"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AddCueResult, FocusPoint } from "./WorkingOn";

/**
 * The Working-on list's data layer — every cue mutation in one place, and
 * every one of them SERVER-CONFIRMED before local state moves.
 *
 * The old writes were optimistic fire-and-forget, and a Supabase update
 * that fails row-level security (an expired session is enough) returns
 * success with zero rows changed — so a ticked cue looked retired, saved
 * nothing, and walked back onto the list on the next visit. The owner's
 * account showed the fossil record: cues retired repeatedly over weeks,
 * and not one retired row in the table.
 *
 * The rules that follow from that:
 *   - every write ends in .select() and counts the rows that came back;
 *     zero rows IS a failure, whatever the status code says;
 *   - state changes only after the row does — the UI's pending state
 *     covers the round-trip;
 *   - the list re-reads on tab focus, so two open surfaces (journal,
 *     dashboard) can't drift for long.
 *
 * The 5-cue cap and the duplicate rule are enforced here AND by a partial
 * unique index on active labels (073), so racing surfaces (lesson
 * takeaways, Recollect's add) can't sneak past the client checks.
 */
export function useFocusPoints(userId: string) {
  // null = first load in flight (the card shows nothing rather than a
  // flash of the empty-state line).
  const [cues, setCues] = useState<FocusPoint[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("focus_points")
      .select("id, label, retired_at, created_at")
      .order("created_at", { ascending: true });
    if (data) setCues(data as FocusPoint[]);
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, userId]);

  const addCue = useCallback(
    async (label: string): Promise<AddCueResult> => {
      const clean = label.trim().slice(0, 120);
      if (!clean) return "dup";
      const current = cues ?? [];
      const active = current.filter((c) => !c.retired_at);
      if (active.some((c) => c.label.toLowerCase() === clean.toLowerCase())) {
        return "dup";
      }
      if (active.length >= 5) return "full";
      const { data, error } = await createClient()
        .from("focus_points")
        .insert({ user_id: userId, label: clean })
        .select("id, label, retired_at, created_at")
        .single();
      if (error?.code === "23505") return "dup"; // active-label unique (073)
      if (error || !data) return "error";
      setCues((cs) => [...(cs ?? []), data as FocusPoint]);
      return "added";
    },
    [cues, userId]
  );

  const retireCue = useCallback(async (id: string): Promise<boolean> => {
    const now = new Date().toISOString();
    const { data, error } = await createClient()
      .from("focus_points")
      .update({ retired_at: now })
      .eq("id", id)
      .select("id");
    if (error || !data || data.length === 0) return false;
    setCues((cs) =>
      (cs ?? []).map((c) => (c.id === id ? { ...c, retired_at: now } : c))
    );
    return true;
  }, []);

  const restoreCue = useCallback(
    async (id: string): Promise<AddCueResult> => {
      const current = cues ?? [];
      if (current.filter((c) => !c.retired_at).length >= 5) return "full";
      const { data, error } = await createClient()
        .from("focus_points")
        .update({ retired_at: null })
        .eq("id", id)
        .select("id");
      if (error?.code === "23505") return "dup"; // same label active again
      if (error || !data || data.length === 0) return "error";
      setCues((cs) =>
        (cs ?? []).map((c) => (c.id === id ? { ...c, retired_at: null } : c))
      );
      return "added";
    },
    [cues]
  );

  /** Merge a cue created elsewhere (Recollect's add) into local state. */
  const mergeCue = useCallback((focus: FocusPoint) => {
    setCues((cs) =>
      (cs ?? []).some((c) => c.id === focus.id) ? cs : [...(cs ?? []), focus]
    );
  }, []);

  return { cues: cues ?? [], loaded: cues !== null, addCue, retireCue, restoreCue, mergeCue };
}
