/**
 * A minimal dark bezel around a real capture, with the site's neon glow
 * behind it. Pure CSS: the pixels inside are always the real app.
 *
 * Two shapes. A phone's corners are very round and its bezel is even all
 * the way round; a landscape tablet at the same radius reads as a phone
 * lying on its side, which is the wrong object. The tablet is squarer and
 * its glow spreads less, because it is wider to begin with.
 */
export function PhoneFrame({
  children,
  className = "",
  glow = true,
  device = "phone",
}: {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  device?: "phone" | "tablet";
}) {
  const tablet = device === "tablet";
  return (
    <div className={`relative ${className}`}>
      {glow && (
        <div
          aria-hidden
          className={`absolute bg-gradient-to-br from-cyan-glow/25 via-transparent to-magenta-glow/20 blur-2xl ${
            tablet ? "-inset-6 rounded-[2rem]" : "-inset-8 rounded-[3rem]"
          }`}
        />
      )}
      <div
        className={`relative border border-zinc-700/70 bg-zinc-900 shadow-2xl shadow-black/60 ${
          tablet ? "rounded-[1.1rem] p-1.5" : "rounded-[2.4rem] p-2"
        }`}
      >
        <div
          className={`overflow-hidden bg-ink ${
            tablet ? "rounded-[0.7rem]" : "rounded-[1.9rem]"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
