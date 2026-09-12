"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProcessingFeedback } from "./processingFeedback";

/** One owner-scoped read for all visible matches. Older servers fail quietly. */
export function useProcessingFeedback(matchIds: string[]) {
  const [feedback, setFeedback] = useState<Record<string, ProcessingFeedback>>({});
  const key = [...new Set(matchIds)].slice(0, 100).sort().join(",");
  useEffect(() => {
    let active = true;
    let pending = false;
    const ids = key ? key.split(",") : [];
    setFeedback({});
    if (!ids.length) return;
    const supabase = createClient();
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const { data, error } = await supabase.rpc("my_match_processing_feedback", { p_match_ids: ids });
        if (active) setFeedback(!error && Array.isArray(data)
          ? Object.fromEntries(data.filter((row) => ids.includes(row.match_id)).map((row) => [row.match_id, row]))
          : {});
      } catch {
        if (active) setFeedback({});
      } finally { pending = false; }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [key]);
  return feedback;
}
