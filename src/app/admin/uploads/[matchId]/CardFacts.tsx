"use client";

import type { CardReading } from "../pointReadings";

/**
 * What every sensor and every rule said about one card.
 *
 * The same grid /research/serve-accuracy puts under its player, moved here
 * so a question about a real upload does not need a hand-listed match and a
 * checked-in ball track. The rules are the research page's own, imported
 * rather than reimplemented, so the two pages cannot answer differently.
 *
 * The shape of it is one claim per box, each naming who said it. "Off table
 * says you won" and "Ball died says no call" are different facts and the
 * disagreement between them is the interesting one; collapsing to a single
 * verdict would hide exactly what this is for.
 */

const RULE_LABEL: Record<string, string> = {
  "ball died": "Ball died says",
  "off table": "Off table says",
  "no return": "No return says",
};

/**
 * Whoever the verdict points at.
 *
 * With no recorded side, "user" is not a person — it is the near end of the
 * table, because that is the frame the reading was taken in. Naming a player
 * there would be a guess with a name on it.
 */
function name(
  who: "user" | "opponent" | null,
  names: { user: string; opponent: string },
  sideKnown: boolean
): string {
  if (who === null) return "";
  if (!sideKnown) return who === "user" ? "the near player" : "the far player";
  return who === "user" ? names.user : names.opponent;
}

export function CardFacts({
  reading,
  names,
}: {
  reading: CardReading;
  names: { user: string; opponent: string };
}) {
  const r = reading;
  const called = r.winner !== null;

  return (
    <div className="mt-3 rounded-2xl border border-edge bg-surface-2/40 p-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="You tapped">
          {!r.sideKnown ? (
            <span className="text-zinc-500">no end recorded</span>
          ) : r.tapped ? (
            <span className="text-zinc-200">{name(r.tapped, names, r.sideKnown)}</span>
          ) : (
            <span className="text-zinc-500">not scored</span>
          )}
        </Fact>

        <Fact label="The call">
          {called ? (
            <>
              <span
                className={
                  r.agrees === false ? "text-amber-300" : "text-zinc-200"
                }
              >
                {name(r.winner, names, r.sideKnown)}
              </span>
              {r.why && (
                <span className="block text-xs text-zinc-500">{r.why}</span>
              )}
              {r.agrees === false && (
                <span className="block text-xs text-amber-300/80">
                  disagrees with your tap
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-zinc-500">no call</span>
              {r.refusal && (
                <span className="block text-xs text-zinc-600">{r.refusal}</span>
              )}
            </>
          )}
        </Fact>

        <Fact label="Worker called">
          {r.worker?.winner ? (
            <>
              <span className="text-zinc-300">
                {name(r.worker.winner, names, r.sideKnown)}
              </span>
              {r.worker.how && (
                <span className="block text-xs text-zinc-500">
                  {r.worker.how}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-500">no call</span>
          )}
        </Fact>

        <Fact label="Serve speed">
          {r.speed ? (
            <>
              <span className="text-zinc-200 tabular-nums">
                {r.speed.kmh} km/h
              </span>
              <span className="block text-xs text-zinc-500 tabular-nums">
                {r.speed.metres.toFixed(2)} m in {r.speed.frames}f
              </span>
            </>
          ) : (
            <span className="text-zinc-500">not measurable</span>
          )}
        </Fact>

        {/* The three rules, always all three, answered or silent. Reading
            which one stayed quiet is half the diagnosis. */}
        {r.rules.map((rule) => (
          <Fact key={rule.name} label={RULE_LABEL[rule.name] ?? rule.name}>
            {rule.verdict ? (
              <>
                <span
                  className={
                    r.rule === rule.name ? "text-cyan-glow" : "text-zinc-300"
                  }
                >
                  {name(rule.verdict, names, r.sideKnown)}
                </span>
                {rule.why && (
                  <span className="block text-xs text-zinc-500">
                    {rule.why}
                  </span>
                )}
              </>
            ) : (
              <span className="text-zinc-600">no call</span>
            )}
          </Fact>
        ))}

        <Fact label="Touches">
          <span className="text-zinc-300 tabular-nums">
            {r.touches.bounces} bounce{r.touches.bounces === 1 ? "" : "s"}
          </span>
          <span className="block text-xs text-zinc-500 tabular-nums">
            {r.touches.onTable} on the table · {r.touches.contacts} contact
            {r.touches.contacts === 1 ? "" : "s"}
          </span>
        </Fact>

        <Fact label="Rally length">
          <span className="text-zinc-300 tabular-nums">
            {r.rally.seconds !== null ? `${r.rally.seconds.toFixed(1)}s` : "—"}
          </span>
          <span className="block text-xs text-zinc-500 tabular-nums">
            {r.rally.hits ?? "—"} hits · {r.rally.shots} shots ·{" "}
            {r.rally.contacts} contacts
          </span>
        </Fact>

        <Fact label="Serve">
          <span className="text-zinc-300">
            {r.serveBounces === "both"
              ? "both bounces detected"
              : r.serveBounces === "first"
                ? "only the first bounce"
                : r.serveBounces === "landing"
                  ? "only the landing"
                  : "neither bounce"}
          </span>
          {r.serveLandsTheirHalf !== null && (
            <span className="block text-xs text-zinc-500">
              lands {r.serveLandsTheirHalf ? "their" : "your"} half
            </span>
          )}
        </Fact>

        <Fact label="Last landing">
          {r.lastLanding ? (
            <>
              <span className="text-zinc-300">
                {r.lastLanding.theirHalf ? "their" : "your"} half
              </span>
              <span className="block text-xs text-zinc-500 tabular-nums">
                {r.lastLanding.shotsAfter} touch
                {r.lastLanding.shotsAfter === 1 ? "" : "es"} after
              </span>
            </>
          ) : (
            <span className="text-zinc-500">not placed</span>
          )}
        </Fact>

        <Fact label="Put back by the flights">
          {r.recovered.length > 0 ? (
            <>
              <span className="text-zinc-300 tabular-nums">
                {r.recovered.length} event
                {r.recovered.length === 1 ? "" : "s"}
              </span>
              <span className="block text-xs text-zinc-500 tabular-nums">
                {r.recovered
                  .slice(0, 2)
                  .map(
                    (e) =>
                      `${e.kind} at ${e.at.toFixed(2)}s`
                      + (e.theirHalf === null
                        ? ""
                        : e.theirHalf
                          ? " their half"
                          : " your half")
                  )
                  .join(", ")}
                {r.repairTrusted === false && " — not trusted"}
              </span>
            </>
          ) : (
            <span className="text-zinc-500">nothing recovered</span>
          )}
        </Fact>

        <Fact label="Ball track">
          {r.hasTrack ? (
            <span className="text-zinc-300">read</span>
          ) : (
            <span className="text-zinc-500">
              not stored — two rules cannot run
            </span>
          )}
        </Fact>

        {r.rejection && (
          <Fact label="Placement map">
            <span className="text-zinc-400">no dot</span>
            <span className="block text-xs text-zinc-500">{r.rejection.replace(/_/g, " ")}</span>
          </Fact>
        )}
      </dl>

      {r.worker?.reason && (
        <p className="mt-3 text-xs text-zinc-600">
          Worker&rsquo;s reason: {r.worker.reason}
          {r.worker.hits !== null && ` · ${r.worker.hits} hits`}
        </p>
      )}
      {r.disagree && (
        <p className="mt-2 text-xs text-amber-300/80">
          Two rules answered and named different players. The first one in
          the ladder is the call.
        </p>
      )}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
