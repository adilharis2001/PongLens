/**
 * The mock "video frame": a neon side-view table in the same visual language
 * as NeonBallHero (dark arena, cyan table edge, magenta net, glowing ball) —
 * but pure SVG + CSS so it ships zero JS. The ball is an SVG circle at the
 * origin whose CSS transform is keyframed through the arc; transforms on SVG
 * children move in user units, so the motion scales with the viewBox.
 */
export function TableScene() {
  return (
    <svg
      viewBox="0 0 800 450"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      role="img"
      aria-label="Match footage preview: a glowing ball rallying over a table tennis net"
    >
      {/* faint perspective floor grid below the table */}
      <g stroke="#14141f" strokeWidth="1.5" fill="none">
        <line x1="0" y1="356" x2="800" y2="356" />
        <line x1="0" y1="382" x2="800" y2="382" />
        <line x1="-60" y1="450" x2="290" y2="318" />
        <line x1="150" y1="450" x2="355" y2="318" />
        <line x1="400" y1="450" x2="400" y2="318" />
        <line x1="650" y1="450" x2="445" y2="318" />
        <line x1="860" y1="450" x2="510" y2="318" />
      </g>
      {/* floor line */}
      <line x1="0" y1="410" x2="800" y2="410" stroke="#1e1e2c" strokeWidth="2" />

      {/* angled legs */}
      <g stroke="#1a1a28" strokeWidth="9" strokeLinecap="round">
        <line x1="168" y1="313" x2="146" y2="408" />
        <line x1="632" y1="313" x2="654" y2="408" />
      </g>

      {/* table-top slab (side view) */}
      <rect
        x="120"
        y="300"
        width="560"
        height="13"
        rx="4"
        fill="#12121c"
        stroke="#232338"
        strokeWidth="1"
      />
      {/* cyan top-edge highlight */}
      <line
        x1="125"
        y1="301"
        x2="675"
        y2="301"
        stroke="#22d3ee"
        strokeWidth="1.5"
        opacity="0.5"
        style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,.6))" }}
      />

      {/* magenta net */}
      <line
        x1="400"
        y1="300"
        x2="400"
        y2="278"
        stroke="#e879f9"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.6"
        style={{ filter: "drop-shadow(0 0 6px rgba(232,121,249,.8))" }}
      />
      <line
        x1="400"
        y1="299"
        x2="400"
        y2="279"
        stroke="rgba(224,242,254,.9)"
        strokeWidth="1.2"
      />
      <circle
        cx="400"
        cy="278"
        r="2.5"
        fill="#e879f9"
        style={{ filter: "drop-shadow(0 0 8px rgba(232,121,249,.9))" }}
      />

      {/* faint trajectory trail behind the ball */}
      <path
        d="M 110 258 Q 250 240 545 293 Q 620 258 690 258"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1"
        strokeDasharray="2 8"
        strokeLinecap="round"
        opacity="0.22"
      />

      {/* bounce flashes on the table surface */}
      <ellipse
        className="pv-bounce-a"
        cx="545"
        cy="297"
        rx="22"
        ry="6"
        fill="rgba(103,232,249,.8)"
        opacity="0"
      />
      <ellipse
        className="pv-bounce-b"
        cx="255"
        cy="297"
        rx="22"
        ry="6"
        fill="rgba(103,232,249,.8)"
        opacity="0"
      />

      {/* trailing ghost then the ball — circles at the origin, keyframed
          through the arc via CSS transforms (see PreviewStyles) */}
      <circle
        className="pv-ball"
        cx="0"
        cy="0"
        r="5"
        fill="rgba(34,211,238,.4)"
        style={{ animationDelay: "0.07s" }}
      />
      <circle
        className="pv-ball"
        cx="0"
        cy="0"
        r="7"
        fill="url(#pv-ball-fill)"
        style={{ filter: "drop-shadow(0 0 6px #22d3ee) drop-shadow(0 0 16px rgba(34,211,238,.5))" }}
      />
      <defs>
        <radialGradient id="pv-ball-fill" cx="0.35" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.75" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#0e9cb3" />
        </radialGradient>
      </defs>
    </svg>
  );
}
