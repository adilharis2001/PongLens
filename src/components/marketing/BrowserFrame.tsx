/**
 * A thin dark bezel around a desktop capture. The phone gets PhoneFrame;
 * a laptop-shaped capture in that bezel read as a phone on its side, so
 * this one is squarer, has a slim top bar and no glow. Pure CSS: the
 * pixels inside are always the real app.
 */
export function BrowserFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 shadow-2xl shadow-black/60 ${className}`}
    >
      <div
        aria-hidden
        className="flex h-6 items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-3"
      >
        <span className="h-2 w-2 rounded-full bg-zinc-700" />
        <span className="h-2 w-2 rounded-full bg-zinc-700" />
        <span className="h-2 w-2 rounded-full bg-zinc-700" />
      </div>
      <div className="bg-ink">{children}</div>
    </div>
  );
}
