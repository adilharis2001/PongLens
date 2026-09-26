"use client";
import { useEffect } from "react";

/** Progressive enhancement: every element is complete and visible without JS. */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".cinematic-landing");
    if (!root) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let cleanup = () => {};
    const setup = () => {
      cleanup();
      if (preference.matches) return;
      const animations = new Set<Animation>();
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const animation = el.animate(
            [{translate:"0 55px",opacity:0.35},{translate:"0 0",opacity:1}],
            {duration:1100,fill:"backwards",delay:el.classList.contains("analysis-card") ? Array.from(el.parentElement!.children).indexOf(el)%3*100 : 0,easing:"cubic-bezier(.16,1,.3,1)"},
          );
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
          observer.unobserve(el);
        });
      }, {threshold:0.12});
      root.querySelectorAll(".feature-media, .analysis-card, .clip-ribbon").forEach(el => observer.observe(el));
      const hero = root.querySelector<HTMLElement>(".cinematic-hero");
      const scene = root.querySelector<HTMLElement>(".rally-art, .coach-art");
      const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
      let frame = 0;
      let scrollFrame = 0;
      let heroVisible = true;
      const drawScroll = () => {
        scrollFrame = 0;
        if (!hero || !heroVisible) return;
        const bounds = hero.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, (64-bounds.top)/(window.matchMedia("(max-width: 767px)").matches ? 180 : bounds.height*.7)));
        hero.style.setProperty("--rally-progress", progress.toFixed(3));
      };
      const scroll = () => { if (!scrollFrame && heroVisible) scrollFrame = requestAnimationFrame(drawScroll); };
      const visibility = new IntersectionObserver(([entry]) => {heroVisible=entry.isIntersecting;if(heroVisible)scroll();});
      if (hero) visibility.observe(hero);
      window.addEventListener("scroll", scroll, {passive:true});
      window.addEventListener("resize", scroll, {passive:true});
      drawScroll();
      const move = (event: PointerEvent) => {
        if (!hero || !scene || !finePointer.matches) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const bounds = hero.getBoundingClientRect();
          const x = (event.clientX-bounds.left)/bounds.width - 0.5;
          const y = (event.clientY-bounds.top)/bounds.height - 0.5;
          scene.style.setProperty("--look-x", `${x*26}px`);
          scene.style.setProperty("--look-y", `${y*18}px`);
        });
      };
      const reset = () => { cancelAnimationFrame(frame); scene?.style.removeProperty("--look-x"); scene?.style.removeProperty("--look-y"); };
      hero?.addEventListener("pointermove",move,{passive:true});
      hero?.addEventListener("pointerleave",reset);
      cleanup=()=>{observer.disconnect();visibility.disconnect();cancelAnimationFrame(scrollFrame);window.removeEventListener("scroll",scroll);window.removeEventListener("resize",scroll);hero?.style.removeProperty("--rally-progress");animations.forEach(a=>a.cancel());reset();hero?.removeEventListener("pointermove",move);hero?.removeEventListener("pointerleave",reset);};
    };
    setup();
    preference.addEventListener("change",setup);
    return ()=>{cleanup();preference.removeEventListener("change",setup);};
  }, []);
  return null;
}
