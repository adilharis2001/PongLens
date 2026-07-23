import { AppWindow } from "./AppWindow";
import { CutTimeline } from "./CutTimeline";

/**
 * "See it before you upload" section for the marketing homepage: the
 * before/after cut timeline plus a stylized app-window mockup of the match
 * player. Entirely server-rendered — the only motion is the CSS keyframes
 * below, which the global prefers-reduced-motion rule silences.
 */

const KEYFRAMES = `
/* ball arc: contact -> apex -> far bounce -> contact (hold) -> back.
   SVG-child transforms move in user units, so this scales with the viewBox. */
@keyframes pv-rally {
  0%   { transform: translate(110px, 258px); }
  10%  { transform: translate(240px, 245px); }
  32%  { transform: translate(545px, 293px); }
  42%  { transform: translate(690px, 258px); }
  50%  { transform: translate(690px, 258px); }
  60%  { transform: translate(560px, 245px); }
  82%  { transform: translate(255px, 293px); }
  92%  { transform: translate(110px, 258px); }
  100% { transform: translate(110px, 258px); }
}
.pv-ball { animation: pv-rally 2.1s linear infinite; }

@keyframes pv-bounce-a {
  0%, 28%, 40%, 100% { opacity: 0; }
  32% { opacity: 0.9; }
}
@keyframes pv-bounce-b {
  0%, 78%, 90%, 100% { opacity: 0; }
  82% { opacity: 0.9; }
}
.pv-bounce-a { animation: pv-bounce-a 2.1s linear infinite; }
.pv-bounce-b { animation: pv-bounce-b 2.1s linear infinite; }

/* rally segments in the recording bar: slow staggered glow */
@keyframes pv-seg {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}
.pv-seg { animation: pv-seg 2.8s ease-in-out infinite; }

/* connector arrow: gentle downward pulse */
@keyframes pv-flow {
  0%, 100% { transform: translateY(0); opacity: 0.7; }
  50% { transform: translateY(3px); opacity: 1; }
}
.pv-flow { animation: pv-flow 2s ease-in-out infinite; }

/* sheen sweeping across the rally-cut bar */
@keyframes pv-sheen {
  0% { background-position: 200% 0; }
  100% { background-position: -100% 0; }
}
.pv-sheen {
  background-image: linear-gradient(
    100deg,
    transparent 35%,
    rgba(255, 255, 255, 0.3) 50%,
    transparent 65%
  );
  background-size: 200% 100%;
  animation: pv-sheen 3.2s ease-in-out infinite;
}
`;

export function ProductPreview() {
  return (
    <section id="preview" className="scroll-mt-20 py-20 sm:py-28">
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          From full recording to{" "}
          <span className="text-cyan-glow text-glow">pure play</span>
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-400">
          PongLens finds every rally in your footage, cuts out the waiting,
          and hands you a match you can actually study.
        </p>

        <div className="mt-14">
          <CutTimeline />
        </div>

        <div className="mt-16 sm:mt-20">
          <AppWindow />
        </div>
      </div>
    </section>
  );
}
