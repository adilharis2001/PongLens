/** Bounded, visibility-aware status reads. Cancelled responses never revive old status. */
export function startProcessingPoller<T>({ read, publish, unknown, visible }: {
  read: (signal: AbortSignal) => PromiseLike<T>;
  publish: (value: T) => void;
  unknown: T;
  visible: () => boolean;
}) {
  let active = true;
  let request: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    request?.abort();
    request = null;
    clearTimeout(timeout);
  };
  const refresh = () => {
    if (!active || request || !visible()) return;
    const controller = new AbortController();
    request = controller;
    timeout = setTimeout(() => {
      if (request !== controller) return;
      cancel();
      publish(unknown);
    }, 8_000);
    void (async () => {
      try {
        const value = await read(controller.signal);
        if (active && request === controller && !controller.signal.aborted) publish(value);
      } catch {
        if (active && request === controller && !controller.signal.aborted) publish(unknown);
      } finally {
        if (request === controller) { clearTimeout(timeout); request = null; }
      }
    })();
  };
  const timer = setInterval(refresh, 15_000);
  refresh();
  return {
    refresh,
    invalidate() { if (active) { cancel(); publish(unknown); refresh(); } },
    stop() { active = false; clearInterval(timer); cancel(); },
  };
}
