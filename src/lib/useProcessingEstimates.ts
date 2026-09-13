"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startProcessingPoller } from "./processingPoller";
import type { ProcessingEstimate } from "./processingEstimate";

/** Bounded owner-only successor for jobs that do not yet have a match row. */
export function useProcessingEstimates(jobIds: string[], admin = false) {
  const [values, setValues] = useState<Record<string, ProcessingEstimate | null>>({});
  const key = [...new Set(jobIds)].slice(0, 100).sort().join(",");
  useEffect(() => {
    setValues({});
    if (!key) return;
    const ids = key.split(",");
    const client = createClient();
    const poll = startProcessingPoller<Record<string, ProcessingEstimate | null>>({
      read: async (signal) => {
        const { data, error } = await client.rpc(admin ? "admin_processing_estimates" : "my_processing_estimates", { p_job_ids: ids }).abortSignal(signal);
        return !error && Array.isArray(data) ? Object.fromEntries(data.filter((row) => ids.includes(row.job_id)).map((row) => [row.job_id, row.estimate])) : {};
      }, publish: setValues, unknown: {}, visible: () => !document.hidden && navigator.onLine,
    });
    document.addEventListener("visibilitychange", poll.invalidate);
    window.addEventListener("online", poll.invalidate);
    window.addEventListener("offline", poll.invalidate);
    const { data: auth } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") poll.invalidate();
    });
    return () => {
      poll.stop(); auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", poll.invalidate);
      window.removeEventListener("online", poll.invalidate);
      window.removeEventListener("offline", poll.invalidate);
    };
  }, [key, admin]);
  return values;
}
