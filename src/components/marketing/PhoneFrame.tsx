/**
 * A minimal dark phone bezel around a real capture, with the site's neon
 * glow behind it. Pure CSS: the pixels inside are always the real app.
 */
export function PhoneFrame({
  children,
  className = "",
  glow = true,
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      {glow && (
        <div
          aria-hidden
          className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-cyan-glow/25 via-transparent to-magenta-glow/20 blur-2xl"
        />
      )}
      <div className="relative rounded-[2.4rem] border border-zinc-700/70 bg-zinc-900 p-2 shadow-2xl shadow-black/60">
        <div className="overflow-hidden rounded-[1.9rem] bg-ink">
          {children}
        </div>
      </div>
    </div>
  );
}
