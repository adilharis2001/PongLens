import { AppShell } from "@/components/AppShell";

/**
 * The reason opening My game felt like the app had hung.
 *
 * Without a loading file, the App Router keeps the PREVIOUS page on screen
 * until the server component has resolved and its payload has arrived. So
 * a tap on "My stats" in Account did nothing visible at all for as long as
 * that took: no spinner, no page change, no acknowledgement that the tap
 * had landed. It reads as a freeze, and it is the part people notice, even
 * though the counting that follows is the longer wait.
 *
 * This paints the frame immediately instead: the title, the two tabs and
 * the shape of what is coming. The real numbers replace it when the walk
 * is done.
 */
export default function Loading() {
  return (
    <AppShell avatarUrl={null}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My game</h1>
      <div className="mt-6 flex gap-1" aria-hidden="true">
        <span className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-white">
          My stats
        </span>
        <span className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-zinc-500">
          Tactics
        </span>
      </div>
      <p className="mt-6 text-sm text-zinc-500">Counting your points…</p>
      <div className="mt-4 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-edge bg-surface"
          />
        ))}
      </div>
    </AppShell>
  );
}
