"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ProcessingFeedback } from "./processingFeedback";
import { startProcessingPoller } from "./processingPoller";

/** One owner-scoped read for all visible matches. Older servers fail quietly. */
export function useProcessingFeedback(matchIds: string[]) {
  const [feedback, setFeedback] = useState<Record<string, ProcessingFeedback>>({});
  const key = [...new Set(matchIds)].slice(0, 100).sort().join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    setFeedback({});
    if (!ids.length) return;
    const supabase = createClient();
    const poll = startProcessingPoller<Record<string, ProcessingFeedback>>({
      read: async (signal) => {
        const { data, error } = await supabase.rpc("my_match_processing_feedback", { p_match_ids: ids }).abortSignal(signal);
        return !error && Array.isArray(data)
          ? Object.fromEntries(data.filter((row) => ids.includes(row.match_id)).map((row) => [row.match_id, row]))
          : {};
      },
      publish: setFeedback, unknown: {}, visible: () => !document.hidden && navigator.onLine,
    });
    document.addEventListener("visibilitychange", poll.invalidate);
    window.addEventListener("online", poll.invalidate);
    window.addEventListener("offline", poll.invalidate);
    const { data: auth } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") poll.invalidate();
    });
    return () => {
      poll.stop();
      auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", poll.invalidate);
      window.removeEventListener("online", poll.invalidate);
      window.removeEventListener("offline", poll.invalidate);
    };
  }, [key]);
  return feedback;
}
