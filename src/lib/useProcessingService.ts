"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeServiceStatus, UNKNOWN_SERVICE, type ProcessingServiceStatus } from "./processingAvailability";
import { startProcessingPoller } from "./processingPoller";

/** Independent of a match/job: a queued job may never have had a worker. */
export function useProcessingService() {
  const [status, setStatus] = useState<ProcessingServiceStatus>(UNKNOWN_SERVICE);
  useEffect(() => {
    const client = createClient();
    const poll = startProcessingPoller({
      read: async (signal) => {
        const { data, error } = await client.rpc("processing_service_status").abortSignal(signal);
        return error ? UNKNOWN_SERVICE : normalizeServiceStatus(data);
      },
      publish: setStatus, unknown: UNKNOWN_SERVICE, visible: () => !document.hidden && navigator.onLine,
    });
    document.addEventListener("visibilitychange", poll.invalidate);
    window.addEventListener("online", poll.invalidate);
    window.addEventListener("offline", poll.invalidate);
    const { data: auth } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") poll.invalidate();
    });
    return () => {
      poll.stop();
      auth.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", poll.invalidate);
      window.removeEventListener("online", poll.invalidate);
      window.removeEventListener("offline", poll.invalidate);
    };
  }, []);
  return status;
}
