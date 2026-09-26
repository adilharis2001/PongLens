"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** Decorative flight study. Frames are from the existing public walkthrough. */
export function RallyScene() {
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

  return <div ref={ref} className="rally-scene" data-ready={ready} data-running={ready && !paused && visible && !hidden && !reduced}>
    <div className="rally-art" aria-hidden="true">
      <div className="rally-aura" />
      <svg className="rally-world" viewBox="0 0 800 800" fill="none">
        <defs>
          <radialGradient id="rally-ball-light" cx=".3" cy=".22" r=".84">
            <stop stopColor="#fffef7"/><stop offset=".38" stopColor="#f3f5ef"/>
            <stop offset=".7" stopColor="#c3d3cd"/><stop offset=".9" stopColor="#568d91"/><stop offset="1" stopColor="#123c46"/>
          </radialGradient>
          <radialGradient id="rally-halo"><stop stopColor="#42e7de" stopOpacity=".12"/><stop offset="1" stopColor="#42e7de" stopOpacity="0"/></radialGradient>
          <linearGradient id="rally-light" x1="120" y1="620" x2="660" y2="220" gradientUnits="userSpaceOnUse">
            <stop stopColor="#33d5e2" stopOpacity="0"/><stop offset=".28" stopColor="#28a2b8" stopOpacity=".2"/>
            <stop offset=".66" stopColor="#76f6ee"/><stop offset="1" stopColor="#ccfff4" stopOpacity=".3"/>
          </linearGradient>
          <pattern id="rally-grain" width="13" height="17" patternUnits="userSpaceOnUse">
            <path d="M1 2h.4m7 1h.3m-4 4h.4m6 2h.3m-8 3h.4m5 3h.3" stroke="#284b48" strokeOpacity=".18" strokeLinecap="round" strokeWidth=".6"/>
          </pattern>
          <path id="rally-flight-path" pathLength="100" d="M80 650C140 340 335 110 540 195S710 525 380 570" />
        </defs>
        <ellipse cx="470" cy="390" rx="320" ry="310" fill="url(#rally-halo)" />
        <g className="rally-contours" stroke="url(#rally-light)">
          <use href="#rally-flight-path" strokeWidth="1" opacity=".25" transform="translate(-24 28)"/>
          <use href="#rally-flight-path" strokeWidth="1" opacity=".4" transform="translate(-12 14)"/>
          <use href="#rally-flight-path" strokeWidth="1.4" opacity=".65"/>
          <use href="#rally-flight-path" strokeWidth=".7" opacity=".2" transform="translate(12 -14)"/>
        </g>
        <use className="rally-light-run" href="#rally-flight-path" pathLength="100" stroke="#b8fff8" strokeWidth="2" strokeLinecap="round"/>
        <g className="rally-echo" stroke="#62deda" strokeWidth=".7" fill="none">
          <circle cx="213" cy="355" r="10"/><circle cx="335" cy="233" r="7"/><circle cx="495" cy="182" r="4"/>
        </g>
        <g className="rally-ball">
          <circle r="68" fill="url(#rally-ball-light)"/>
          <circle r="67" fill="url(#rally-grain)"/>
          <path d="M-47-43C-26-64 12-69 36-56" stroke="#fff" strokeOpacity=".58" strokeWidth=".65"/>
        </g>
        <g className="rally-ticks" stroke="#70c9d4" strokeWidth=".7" opacity=".35">
          <path d="M570 115h16m-8-8v16M680 570h16m-8-8v16M190 570h16m-8-8v16"/>
        </g>
      </svg>
      <div className="rally-frames">
        {[0,2,4].map((frame,index)=><div className="rally-frame" key={frame} style={{"--frame":index} as React.CSSProperties}>
          <Image src={`/showcase/cinematic/rally-${frame}.jpg`} width={320} height={180} sizes="(max-width:767px) 90px, 180px" alt="" />
          <span />
        </div>)}
      </div>
    </div>
    <button className="rally-pause" type="button" aria-label={paused ? "Play hero animation" : "Pause hero animation"} title={paused ? "Play hero animation" : "Pause hero animation"} onClick={()=>setPaused(value=>!value)}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
        {paused ? <path d="m7 4 9 6-9 6Z"/> : <path d="M5 4h3v12H5zm7 0h3v12h-3z"/>}
      </svg>
    </button>
  </div>;
}
