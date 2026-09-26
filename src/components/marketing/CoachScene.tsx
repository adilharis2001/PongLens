"use client";

import { useEffect, useRef, useState } from "react";

/** A decorative slow-motion study: approach, hold the moment, then replay. */
export function CoachScene() {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduced(preference.matches);
    const updateVisibility = () => setHidden(document.hidden);
    setReady(true);
    updatePreference();
    updateVisibility();
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return <div ref={ref} className="coach-scene" data-ready={ready} data-running={ready && !paused && visible && !hidden && !reduced}>
    <div className="coach-art" aria-hidden="true">
      <svg className="coach-world" viewBox="0 0 800 680" fill="none">
        <defs>
          <radialGradient id="coach-ball-light" cx=".28" cy=".2" r=".85">
            <stop stopColor="#fffef7"/><stop offset=".4" stopColor="#f0f4ee"/>
            <stop offset=".72" stopColor="#b4cfca"/><stop offset=".92" stopColor="#397780"/><stop offset="1" stopColor="#103540"/>
          </radialGradient>
          <radialGradient id="coach-halo"><stop stopColor="#57e2e5" stopOpacity=".17"/><stop offset="1" stopColor="#57e2e5" stopOpacity="0"/></radialGradient>
          <linearGradient id="coach-trail-light" x1="80" y1="520" x2="720" y2="160" gradientUnits="userSpaceOnUse">
            <stop stopColor="#57e2e5" stopOpacity="0"/><stop offset=".45" stopColor="#57e2e5" stopOpacity=".5"/>
            <stop offset=".7" stopColor="#cefff4"/><stop offset="1" stopColor="#57e2e5" stopOpacity="0"/>
          </linearGradient>
          <pattern id="coach-ball-grain" width="13" height="17" patternUnits="userSpaceOnUse">
            <path d="M1 2h.4m7 1h.3m-4 4h.4m6 2h.3m-8 3h.4m5 3h.3" stroke="#284b48" strokeOpacity=".18" strokeLinecap="round" strokeWidth=".6"/>
          </pattern>
          <path id="coach-flight-line" d="M30 580C185 445 315 370 480 300S680 224 785 130" pathLength="100"/>
        </defs>
        <ellipse cx="480" cy="320" rx="320" ry="300" fill="url(#coach-halo)"/>
        <g stroke="url(#coach-trail-light)" className="coach-trails">
          <use href="#coach-flight-line" strokeWidth="1" opacity=".3" transform="translate(0 -24)"/>
          <use href="#coach-flight-line" strokeWidth="1" opacity=".65" transform="translate(0 -12)"/>
          <use href="#coach-flight-line" strokeWidth="2"/>
          <use href="#coach-flight-line" strokeWidth="1" opacity=".45" transform="translate(0 12)"/>
          <use href="#coach-flight-line" strokeWidth=".7" opacity=".2" transform="translate(0 24)"/>
        </g>
        <use href="#coach-flight-line" className="coach-trail-sweep" stroke="#cefff4" strokeWidth="3" strokeLinecap="round"/>
        <g className="coach-exposures" stroke="#79d6d8">
          <circle cx="207" cy="448" r="36" opacity=".12"/>
          <circle cx="297" cy="391" r="53" opacity=".2"/>
          <circle cx="386" cy="342" r="78" opacity=".26"/>
        </g>
        <g className="coach-focus" stroke="#7ce8e5">
          <circle cx="480" cy="300" r="156" strokeWidth=".8" opacity=".55"/>
          <circle cx="480" cy="300" r="175" strokeWidth=".8" strokeDasharray="1 13" opacity=".35"/>
          <path d="M310 172v-42h42m256 0h42v42m0 256v42h-42m-256 0h-42v-42" strokeWidth="1" opacity=".65"/>
          <path d="M480 115v14m0 342v14M295 300h14m342 0h14" strokeWidth="2"/>
        </g>
        <g className="coach-ball">
          <circle r="118" fill="url(#coach-ball-light)"/>
          <circle r="117" fill="url(#coach-ball-grain)"/>
          <path d="M-84-72C-56-107 1-124 52-103" stroke="#fff" strokeOpacity=".55" strokeWidth=".8"/>
        </g>
        <g className="coach-moment-line" transform="translate(260 568)">
          <path d="M0 0h370" stroke="#70c9d4" strokeOpacity=".16"/>
          <path d="M0-5V5m46-5v5m46-5v5m46-5v5m46-5v5m46-5v5m46-5v5m46-5v5m48-10V5" stroke="#70c9d4" strokeOpacity=".35"/>
          <circle className="coach-playhead" r="3" fill="#a3fff4"/>
        </g>
      </svg>
    </div>
    <button className="coach-pause" type="button" aria-label={paused ? "Play hero animation" : "Pause hero animation"} title={paused ? "Play hero animation" : "Pause hero animation"} onClick={()=>setPaused(value=>!value)}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
        {paused ? <path d="m7 4 9 6-9 6Z"/> : <path d="M5 4h3v12H5zm7 0h3v12h-3z"/>}
      </svg>
    </button>
  </div>;
}
