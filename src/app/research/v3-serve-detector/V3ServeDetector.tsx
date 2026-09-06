"use client";

import { useEffect, useRef } from "react";
import { CSS } from "./styles";

export interface MatchMeta {
  match: string;
  matchId: string;
  title: string;
  venue: string | null;
  /** [originX, originY, width, height] of the review crop, in SOURCE pixels. */
  crop: [number, number, number, number];
  /** Seconds to ADD to a card time to find it in the production raw. */
  rawOffsetS: number;
  offsetErr: number;
  cards: number;
  points: number;
  ok: number;
  srvAgree: number;
  srvDisagree: number;
}

export interface Verdict {
  match_id: string;
  serve_s: number | string;
  verdict: string;
}

/**
 * The V3 card assembler's output, card by card, against Adil's scorekeeper.
 *
 * A port of the lab page this rule was built on. The logic is deliberately
 * imperative and kept close to the original: the page is a review tool whose
 * every detail was argued over against real footage, and a rewrite into
 * idiomatic React would have quietly changed what it draws.
 *
 * TWO THINGS DIFFER FROM THE LAB, both forced by using production's video.
 *
 * 1. The lab plays a 902x506 CROP of the source. Production stores only the
 *    raw, so the crop is reproduced here by scaling the raw and clipping it
 *    to that rectangle. Every overlay coordinate is in crop pixels and needs
 *    no conversion. It also means the browser's own controls sit outside the
 *    clip, so the page carries its own play and scrub bar.
 *
 * 2. This match was processed with a trim, so a card's time is NOT a time in
 *    the raw. The job row says the trim was 243s; ffmpeg snapped it to the
 *    keyframe at 242.133s, and using the recorded number would put every card
 *    0.87s late. The real offset is measured frame by frame at export time
 *    and carried in meta.json as rawOffsetS.
 */
export function V3ServeDetector({
  matches,
  initialVerdicts,
}: {
  matches: MatchMeta[];
  initialVerdicts: Verdict[];
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || !matches.length) return;
    const $ = <T extends HTMLElement>(id: string) =>
      el.querySelector(`#${id}`) as T;

    const VERDICT: Record<string, [string, string]> = {
      ok: ["v-ok", "Correct — one card of mine over one of yours"],
      extra: ["v-extra", "More than one card for this point"],
      missed: ["v-missed", "No card at all"],
      fused: ["v-fused", "Swallowed by the card next door"],
      junk_deleted: ["v-junk_deleted", "Sits on a card you deleted"],
      junk_unknown: ["v-junk_unknown", "Where you carded nothing"],
    };

    /* eslint-disable @typescript-eslint/no-explicit-any */
    let DATA: any = null;
    let OV: any = null;
    let PPL: any = null;
    let META: MatchMeta = matches[0];
    let filter = "all";
    let selected: HTMLElement | null = null;
    let stopAt: number | null = null;
    let playMode = "both";
    let lastPlayed: [any, HTMLElement] | null = null;
    let ovT: Float64Array | null = null;
    let bnT: Float64Array | null = null;
    let svT: Float64Array | null = null;
    let ppT: Float64Array | null = null;
    let raf = 0;
    let SCALE = 1;
    let OFF = 0;
    let dead = false;

    const CALLS = new Map<string, string>();
    for (const v of initialVerdicts)
      CALLS.set(`${v.match_id}|${Number(v.serve_s).toFixed(1)}`, v.verdict);

    const vid = $<HTMLVideoElement>("vid");
    const clip = $<HTMLDivElement>("clip");
    const tbody = $<HTMLTableSectionElement>("tbody");
    const vlabel = $<HTMLDivElement>("vlabel");
    const ov = $<HTMLCanvasElement>("ov");
    const ctx = ov.getContext("2d")!;
    const scrub = $<HTMLInputElement>("scrub");
    const clock = $<HTMLSpanElement>("clock");
    const playBtn = $<HTMLButtonElement>("playbtn");
    const h1 = el.querySelector("h1") as HTMLElement;

    /** Card time -> time in the raw, and back. */
    const toRaw = (t: number) => t + OFF;
    const nowT = () => vid.currentTime - OFF;

    function fmt(s: number) {
      // Round to a tenth BEFORE splitting off the minutes: testing r < 10 on
      // the unrounded value and then calling toFixed(1) printed 129.96 as
      // "2:010.0" — the test saw 9.96 and padded, toFixed rounded it to 10.0.
      const t = Math.round(s * 10) / 10;
      const m = Math.floor(t / 60);
      const r = t - m * 60;
      return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
    }

    function bounds(r: any): [number, number] {
      const ts: number[] = [];
      for (const m of r.mine) ts.push(m.t0, m.t1);
      if (r.swall) ts.push(r.swall.t0, r.swall.t1);
      if (r.prod_t0 != null) ts.push(r.prod_t0, r.prod_t1);
      if (r.tap != null) ts.push(r.tap, r.tap + 2.5);
      // Every row has at least one of the three above, so this is never
      // empty — Math.min of nothing is Infinity, which once put a marker at
      // left:-150%, outside its own box and over in the first column.
      return [Math.max(0, Math.min(...ts) - 1.0), Math.max(...ts)];
    }

    function name(r: any) {
      return r.app_no != null
        ? "card " + r.app_no
        : r.verdict === "junk_deleted"
          ? "a card you deleted"
          : "card " + r.mine[0].n + " of mine";
    }

    function span(r: any, mode: string): [number, number] | null {
      if (mode === "mine") {
        const ts: number[] = [];
        for (const m of r.mine) ts.push(m.t0, m.t1);
        if (!ts.length && r.swall) ts.push(r.swall.t0, r.swall.t1);
        return ts.length ? [Math.min(...ts), Math.max(...ts)] : null;
      }
      if (mode === "prod") return r.prod_t0 == null ? null : [r.prod_t0, r.prod_t1];
      return null;
    }

    function play(r: any, tr: HTMLElement) {
      lastPlayed = [r, tr];
      const exact = span(r, playMode);
      const [ua, ub] = bounds(r);
      const [a, b] = exact || [ua, ub + 0.5];
      stopAt = b;
      vid.currentTime = toRaw(a);
      vid.play().catch(() => {});

      const who = !exact
        ? playMode === "mine"
          ? "no card of mine here, so this is the whole stretch"
          : playMode === "prod"
            ? "you carded nothing here, so this is the whole stretch"
            : "both cards, with a second of run-up"
        : playMode === "mine"
          ? "my card exactly, no run-up"
          : "your card exactly, no run-up";

      let tail = "";
      if (r.tap != null)
        tail =
          Math.abs(r.tap - b) < 0.05
            ? ", ending on your winner press"
            : r.tap > b
              ? ", stopping " + (r.tap - b).toFixed(1) + "s BEFORE you pressed the winner"
              : ", running " + (b - r.tap).toFixed(1) + "s past your winner press";

      vlabel.textContent =
        name(r) + " — " + fmt(a) + " to " + fmt(b) + " (" + (b - a).toFixed(1) +
        "s) — " + who + tail + ". It stops there; press play to keep going.";
      if (selected) selected.classList.remove("sel");
      selected = tr;
      tr.classList.add("sel");
    }

    function timeline(r: any) {
      const [a, b0] = bounds(r);
      const W = Math.max(b0 - a, 0.5);
      const at = (x: number) => (((x - a) / W) * 100).toFixed(2) + "%";
      const wd = (x: number, y: number) =>
        ((Math.max(y - x, 0) / W) * 100).toFixed(2) + "%";
      let h = '<div class="tl">';
      if (r.prod_t0 != null)
        h += '<d class="' + (r.verdict === "junk_deleted" ? "del" : "") +
          '" style="left:' + at(r.prod_t0) + ";width:" + wd(r.prod_t0, r.prod_t1) + '"></d>';
      for (const m of r.mine)
        h += '<i class="' + (m.holds_tap ? "hastap" : "") + '" style="left:' +
          at(m.t0) + ";width:" + wd(m.t0, m.t1) + '"></i>';
      if (r.swall)
        h += '<s style="left:' + at(r.swall.t0) + ";width:" +
          wd(r.swall.t0, r.swall.t1) + '"></s>';
      for (const [d0, d1] of DATA.dead || [])
        if (d1 >= a && d0 <= b0)
          h += '<q style="left:' + at(Math.max(d0, a)) + ";width:" +
            wd(Math.max(d0, a), Math.min(d1, b0)) + '"></q>';
      if (r.tap != null) h += '<u style="left:' + at(r.tap) + '"></u>';
      h += '</div><div class="tlkey">solid bars are my cards' +
        (r.prod_t0 != null
          ? ", the dashed box is " +
            (r.verdict === "junk_deleted" ? "the card you deleted" : "production’s own card")
          : "") +
        (r.tap != null ? ", the yellow line is where you pressed the winner" : "") +
        ", pink is the ball going dead</div>";
      return h;
    }

    function verdictKey(r: any): number | null {
      const m0 = r.mine && r.mine[0];
      return m0 && m0.serve_s != null ? Math.round(m0.serve_s * 10) / 10 : null;
    }

    async function saveVerdict(key: number, v: string | null) {
      const k = `${META.matchId}|${key.toFixed(1)}`;
      if (v === null) CALLS.delete(k);
      else CALLS.set(k, v);
      try {
        await fetch("/api/research/v3-verdict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: META.matchId, serveS: key, verdict: v }),
        });
      } catch {
        /* the call is already on screen; a failed save is retried by clicking again */
      }
    }

    function render() {
      tbody.replaceChildren();
      const rows = DATA.rows.filter((r: any) =>
        filter === "all"
          ? true
          : filter === "bad"
            ? r.verdict !== "ok" || r.holds_press === false
            : filter === "nopress"
              ? r.holds_press === false
              : filter === "srv_disagree"
                ? r.srv === "disagree"
                : filter === "called_false"
                  ? CALLS.get(`${META.matchId}|${(verdictKey(r) ?? -1).toFixed(1)}`) === "false"
                  : r.verdict === filter,
      );
      for (const r of rows) {
        const tr = document.createElement("tr");
        tr.className = "row" + (r.kind === "junk" ? " junk" : "");
        // A card whose rally chain accepted no net crossing never watched the
        // ball cross, so it does not know when its point ended. Worth saying
        // on the card: it is the one thing you cannot see by looking at it.
        const blindHtml = (b: any) =>
          !b || b.cross > 0
            ? ""
            : '<span class="blind' + (b.held ? " held" : "") + '">' +
              (b.held ? "held open — " : "") +
              "never saw the ball cross the net, " +
              (b.bounces === 1 ? "1 bounce" : b.bounces + " bounces") + " seen</span>";
        const cardHtml = (m: any) =>
          '<span class="card' + (m.holds_tap ? " hastap" : "") + '">' +
          "<b>my card " + m.n + '</b> <span class="t">' + fmt(m.t0) + "&ndash;" + fmt(m.t1) +
          '</span> <span class="seek">(' + (m.t1 - m.t0).toFixed(1) + "s)</span></span>" +
          blindHtml(m.blind);
        const mine = r.mine.length
          ? r.mine.map(cardHtml).join("")
          : r.swall
            ? '<span class="none">nothing of its own</span><br>' +
              '<span class="card" style="border-color:#4e2f5c"><b>my card ' + r.swall.n +
              '</b> <span class="t">' + fmt(r.swall.t0) + "&ndash;" + fmt(r.swall.t1) +
              '</span> <span class="seek">crosses it</span></span>'
            : '<span class="none">nothing</span>';

        let truth: string;
        if (r.kind === "point") {
          const w =
            r.winner === "user"
              ? '<span class="won">you won</span>'
              : r.winner === "opponent"
                ? '<span class="lost">opponent won</span>'
                : "";
          truth =
            '<span class="pt">your card ' + r.app_no + "</span> " +
            '<span class="sub2">&middot; game ' + r.game + "</span><br>" +
            '<span class="sub2 t">' + fmt(r.prod_t0) + "&ndash;" + fmt(r.prod_t1) + "</span><br>" +
            (r.tap != null ? '<span class="t">scored at ' + fmt(r.tap) + "</span><br>" : "") + w;
        } else if (r.verdict === "junk_deleted") {
          truth =
            '<span class="pt">a card you deleted</span><br>' +
            '<span class="sub2 t">' + fmt(r.prod_t0) + "&ndash;" + fmt(r.prod_t1) + "</span><br>" +
            '<span class="lost">you threw this one away</span>';
        } else {
          truth = '<span class="none">production made no card here</span>';
        }

        let srv: string;
        const endOf = (side: string) => (side === "near" ? "near end" : "far end");
        // A card with no scored point behind it can only be given the END the
        // serve landed on: naming a player needs the game, and the players
        // change ends every game.
        const who = (side: string, nm: string | null) =>
          nm
            ? "<b>" + nm + '</b> <span class="end">(' + endOf(side) + ")</span>"
            : "<b>" + endOf(side) + "</b>";
        if (!r.geo && !r.rot) {
          srv = '<span class="none">no serve read</span>';
        } else {
          srv =
            '<div class="srv"><span class="lbl">my rule:</span> ' +
            (r.geo
              ? who(r.geo, r.geo_name)
              : '<span class="none">' +
                (r.verdict === "fused" ? "no card of its own" : "no card") + "</span>");
          const m0 = r.mine && r.mine[0];
          if (m0 && m0.serve_s != null) {
            // Four readings, in the order they are trusted. The first is the
            // only one right every time it speaks: walk the ball track back
            // from the serve's first bounce to the hands it left. It exists
            // because a neighbouring table's ball drifted through the near
            // player's box on card 47 and the hold-based reading believed it.
            srv += m0.origin
              ? '<br><span class="how">traced back from the serve\u2019s first bounce to their hands</span>'
              : m0.dwell
              ? '<br><span class="how">from the ball sitting in their box &middot; ' +
                m0.runs[m0.dwell] + " frames unbroken" +
                (m0.runs[m0.dwell === "near" ? "far" : "near"]
                  ? " against " + m0.runs[m0.dwell === "near" ? "far" : "near"]
                  : "") + "</span>"
              // The third reading: the ball was in one player's hands and
              // never in the other's. Weaker than the one above, and it only
              // speaks when the other end has nothing at all to show.
              : m0.asym
                ? '<br><span class="how">seen only in their hands &middot; ' +
                  m0.runs[m0.asym] + " frames against none at the other end</span>"
                // When the walk back from the first bounce breaks before reaching
                // anyone, WHERE it broke still says which end the ball came from.
                : m0.emerged
                  ? '<br><span class="how">from the end the ball came out of, where the track broke</span>"
                : '<br><span class="how">from the first bounce we could see</span>';
          }
          // A card the rotation's own shape corrected. Said out loud rather
          // than applied silently: the reading and the correction disagree,
          // and which one was trusted is exactly what you want to see.
          if (r.geo_fixed)
            srv +=
              '<br><span class="how">corrected against the rotation\u2019s shape \u2014 ' +
              "the reading itself said " +
              (r.geo_raw === "near" ? "near end" : "far end") + "</span>";
          srv += r.rot
            ? '<br><span class="lbl">your scoring:</span> ' + who(r.rot, r.rot_name)
            : '<br><span class="none">you marked no point here</span>';
          if (r.srv === "agree") srv += '<br><span class="tag agree">agrees</span>';
          if (r.srv === "disagree") srv += '<br><span class="tag disagree">wrong server</span>';
          srv += "</div>";
        }

        const [cls, label] = VERDICT[r.verdict];
        // A point can be "correct" — exactly one card of mine — and still have
        // a card that stops before the point was decided. That is the one thing
        // the verdicts above cannot say, so it gets its own badge.
        const nopress =
          r.holds_press === false
            ? '<span class="chip v-missed" title="no card of mine contains the moment ' +
              'you pressed the winner">misses your press</span>'
            : "";
        const key = verdictKey(r);
        const call = key == null ? null : CALLS.get(`${META.matchId}|${key.toFixed(1)}`);
        const vd =
          key == null
            ? ""
            : '<div class="vd">' +
              ["genuine", "false", "unsure"]
                .map(
                  (v) =>
                    '<button data-v="' + v + '" aria-pressed="' + (call === v) + '">' +
                    (v === "genuine" ? "a real serve" : v === "false" ? "not a serve" : "unsure") +
                    "</button>",
                )
                .join("") +
              "</div>";
        tr.innerHTML =
          "<td>" + mine + "</td><td>" + truth + "</td><td>" + srv + "</td>" +
          '<td><span class="chip ' + cls + '">' + label + "</span>" + nopress +
          (r.note ? '<div class="why">' + r.note + "</div>" : "") +
          timeline(r) + vd + "</td>";
        tr.addEventListener("click", () => play(r, tr));
        if (key != null) {
          for (const b of Array.from(tr.querySelectorAll(".vd button"))) {
            b.addEventListener("click", (ev) => {
              ev.stopPropagation();
              const v = (b as HTMLElement).dataset.v!;
              const now = CALLS.get(`${META.matchId}|${key.toFixed(1)}`);
              const next = now === v ? null : v;
              saveVerdict(key, next);
              for (const o of Array.from(tr.querySelectorAll(".vd button")))
                o.setAttribute(
                  "aria-pressed",
                  String(next !== null && (o as HTMLElement).dataset.v === next),
                );
            });
          }
        }
        tbody.appendChild(tr);
      }
      ($("empty") as HTMLElement).hidden = rows.length > 0;
    }

    // -----------------------------------------------------------------
    // The overlay. Everything it draws comes from the run that made the
    // cards: the calibrated table quad, the ball track BlurBall produced,
    // and the bounces points_v2's own detector found in that track.
    //
    // Coordinates are CROP pixels. The video is scaled and clipped to that
    // same rectangle, so one scale factor converts both and there is no
    // letterboxing to work around.
    // -----------------------------------------------------------------
    const TRAIL = 0.8, BOUNCE_HOLD = 0.35, SERVE_HOLD = 0.6;
    const on = (id: string) => ($(id) as HTMLInputElement).checked;

    function lower(arr: Float64Array, x: number) {
      let lo = 0, hi = arr.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (arr[m] < x) lo = m + 1;
        else hi = m;
      }
      return lo;
    }

    function layout() {
      const [ox, oy, cw, ch] = META.crop;
      const vw = vid.videoWidth || 1920, vh = vid.videoHeight || 1080;
      const availW = clip.parentElement?.clientWidth || 1;
      const maxH = Math.max(200, window.innerHeight * 0.4);
      const s = Math.min(availW / cw, maxH / ch);
      SCALE = s;
      // The clip box IS the crop rectangle, centred in a black strip, so
      // the letterboxing sits either side exactly as it did in the lab.
      clip.style.width = cw * s + "px";
      clip.style.height = ch * s + "px";
      vid.style.width = vw * s + "px";
      vid.style.height = vh * s + "px";
      vid.style.left = -ox * s + "px";
      vid.style.top = -oy * s + "px";
    }

    function draw() {
      raf = 0;
      if (!OV) return;
      const dpr = window.devicePixelRatio || 1;
      const ew = clip.clientWidth, eh = clip.clientHeight;
      if (ov.width !== Math.round(ew * dpr) || ov.height !== Math.round(eh * dpr)) {
        ov.width = Math.round(ew * dpr);
        ov.height = Math.round(eh * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ew, eh);
      if (!on("ovOn")) return;
      const s = SCALE;
      const X = (x: number) => x * s, Y = (y: number) => y * s;
      const t = nowT();

      if (on("ovTable")) {
        const c = OV.corners;
        const order = ["A_near_1", "B_near_2", "C_far_2", "D_far_1"];
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#3fe0c8";
        ctx.beginPath();
        order.forEach((k, i) =>
          i ? ctx.lineTo(X(c[k][0]), Y(c[k][1])) : ctx.moveTo(X(c[k][0]), Y(c[k][1])),
        );
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "#3fe0c8";
        ctx.font = "600 10px -apple-system,system-ui,sans-serif";
        for (const k of order) {
          ctx.beginPath();
          ctx.arc(X(c[k][0]), Y(c[k][1]), 2.5, 0, 7);
          ctx.fill();
        }
        ctx.fillText("near", X(c.A_near_1[0]) + 4, Y(c.A_near_1[1]) + 12);
        ctx.fillText("far", X(c.D_far_1[0]) + 4, Y(c.D_far_1[1]) - 5);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#e7ecf3";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(X(OV.net[0][0]), Y(OV.net[0][1]));
        ctx.lineTo(X(OV.net[1][0]), Y(OV.net[1][1]));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (on("ovBall") && ovT) {
        const a = lower(ovT, t - TRAIL), b = lower(ovT, t + 0.05);
        let prev: number[] | null = null;
        for (let i = a; i < b; i++) {
          const [tt, x, y, onT] = OV.ball[i];
          const al = Math.max(0.12, 1 - (t - tt) / TRAIL);
          if (prev && tt - prev[0] < 0.12) {
            ctx.strokeStyle = "rgba(122,212,255," + (al * 0.5).toFixed(2) + ")";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(X(prev[1]), Y(prev[2]));
            ctx.lineTo(X(x), Y(y));
            ctx.stroke();
          }
          const last = i === b - 1;
          ctx.beginPath();
          ctx.arc(X(x), Y(y), last ? 5 : 2.2, 0, 7);
          if (onT) {
            ctx.fillStyle = "rgba(122,212,255," + al.toFixed(2) + ")";
            ctx.fill();
          } else {
            ctx.strokeStyle = "rgba(139,151,167," + al.toFixed(2) + ")";
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
          if (last) {
            ctx.strokeStyle = "rgba(255,255,255,.9)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(X(x), Y(y), 8, 0, 7);
            ctx.stroke();
          }
          prev = [tt, x, y];
        }
      }

      if (on("ovBounce") && bnT) {
        const a = lower(bnT, t - BOUNCE_HOLD), b = lower(bnT, t + BOUNCE_HOLD);
        ctx.font = "600 10px -apple-system,system-ui,sans-serif";
        for (let i = a; i < b; i++) {
          const [tt, x, y, onT, , v, shoe] = OV.bounces[i];
          // A bounce inside the box of somebody who is not one of the two
          // players — a person in the background fetching a ball is exactly
          // what the ball detector is looking for. Marked rather than
          // removed: the cards are still built on every bounce.
          if (shoe && on("ovShoe")) continue;
          const al = Math.max(0.25, 1 - Math.abs(t - tt) / BOUNCE_HOLD);
          const col = shoe ? "150,150,160" : onT ? "127,212,160" : "255,176,138";
          ctx.strokeStyle = "rgba(" + col + "," + al.toFixed(2) + ")";
          ctx.lineWidth = 2;
          const r = 6 + 10 * Math.max(0, 1 - Math.abs(t - tt) / BOUNCE_HOLD);
          ctx.beginPath();
          ctx.arc(X(x), Y(y), r, 0, 7);
          ctx.stroke();
          if (Math.abs(t - tt) < 0.2) {
            ctx.fillStyle = "rgba(" + col + ",.95)";
            ctx.fillText(
              shoe
                ? "in someone's box"
                : onT
                  ? v < OV.table[1] / 2
                    ? "bounce · near half"
                    : "bounce · far half"
                  : "bounce · off the table",
              X(x) + r + 4,
              Y(y) + 3,
            );
          }
        }
      }

      if (on("ovPeople") && PPL && ppT) {
        // choose_players is a per-frame decision, so the nearest sampled
        // frame is the honest thing to draw. Holding the last box forward
        // would paint a player standing still while the video shows them move.
        let i = lower(ppT, t);
        if (i >= ppT.length || (i > 0 && ppT[i] - t > t - ppT[i - 1])) i--;
        if (i >= 0 && Math.abs(ppT[i] - t) < 0.25) {
          const ppl = PPL.frames[i][1];
          const tallest: Record<string, [number[], number]> = {};
          for (const [b, end, h] of ppl)
            if (!tallest[end] || h > tallest[end][1]) tallest[end] = [b, h];
          const box = (b: number[] | null, col: string, label: string | null, faint: boolean) => {
            if (!b) return;
            ctx.lineWidth = faint ? 1 : 2;
            ctx.setLineDash(faint ? [3, 3] : []);
            ctx.globalAlpha = faint ? 0.45 : 1;
            ctx.strokeStyle = col;
            ctx.strokeRect(X(b[0]), Y(b[1]), (b[2] - b[0]) * s, (b[3] - b[1]) * s);
            ctx.setLineDash([]);
            if (label) {
              ctx.fillStyle = col;
              ctx.font = "600 11px -apple-system,system-ui,sans-serif";
              ctx.fillText(label, X(b[0]), Y(b[1]) - 4);
            }
            ctx.globalAlpha = 1;
          };
          for (const [b, end] of ppl)
            if (!(tallest[end] && tallest[end][0] === b))
              box(b, end === "near" ? "#ffd479" : "#c9a0ff", null, true);
          if (tallest.near) box(tallest.near[0], "#ffd479", "near player", false);
          if (tallest.far) box(tallest.far[0], "#c9a0ff", "far player", false);
        }
      }

      if (on("ovServe") && svT) {
        const a = lower(svT, t - SERVE_HOLD), b = lower(svT, t + 0.05);
        for (let i = a; i < b; i++) {
          const [at, , side, used, kept, why] = OV.serves[i];
          const al = Math.max(0.3, 1 - (t - at) / SERVE_HOLD);
          // Four states. Two are throw-outs, told apart because they are
          // different mistakes: one is a ball that never bounced again, the
          // other a ball that bounced across and was then caught and held.
          const col = kept === 0 ? "244,140,140" : used ? "255,212,121" : "150,160,175";
          ctx.fillStyle = "rgba(" + col + "," + al.toFixed(2) + ")";
          ctx.font = "600 13px -apple-system,system-ui,sans-serif";
          ctx.fillText(
            why === 0
              ? "THROWN OUT — nothing bounced after it (" + side + " half)"
              : why === -1
                ? "THROWN OUT — passed across, then held (" + side + " half)"
                : "SERVE accepted — " + side + " half" +
                  (used ? " — opened a card" : " — inside a rally, no card"),
            10,
            20,
          );
        }
      }
    }

    function tick() {
      draw();
      if (!vid.paused && !vid.ended && !dead) raf = requestAnimationFrame(tick);
    }
    function kick() {
      if (!raf && !dead) raf = requestAnimationFrame(tick);
    }

    function onTime() {
      if (stopAt !== null && nowT() >= stopAt) {
        stopAt = null;
        vid.pause();
      }
      const t = nowT();
      if (!scrub.matches(":active")) scrub.value = String(Math.max(0, t));
      clock.textContent = fmt(Math.max(0, t));
      kick();
    }

    vid.addEventListener("timeupdate", onTime);
    for (const e of ["play", "seeked", "pause", "loadedmetadata"])
      vid.addEventListener(e, kick);
    vid.addEventListener("loadedmetadata", () => {
      layout();
      scrub.min = "0";
      scrub.max = String(Math.max(1, vid.duration - OFF));
      kick();
    });
    vid.addEventListener("play", () => (playBtn.textContent = "Pause"));
    vid.addEventListener("pause", () => (playBtn.textContent = "Play"));
    const onResize = () => {
      layout();
      kick();
    };
    window.addEventListener("resize", onResize);
    for (const id of ["ovOn", "ovTable", "ovBall", "ovBounce", "ovServe", "ovPeople", "ovShoe"])
      ($(id) as HTMLElement).addEventListener("change", kick);

    // SPEED. Two ways, because they answer different questions: the buttons
    // set a speed you keep, and holding the picture borrows one for a moment.
    //
    // Holding the LEFT of the picture plays at a tenth speed and the RIGHT at
    // double,
    // which needs no target to hit and no second control to find — the half
    // you are already looking at is the button.
    let speed = 1;
    const hint = $<HTMLDivElement>("holdhint");
    const spdButtons = Array.from(el.querySelectorAll(".spd")) as HTMLElement[];
    const setSpeed = (v: number, remember: boolean) => {
      speed = v;
      vid.playbackRate = v;
      for (const b of spdButtons)
        b.setAttribute("aria-pressed", String(Number(b.dataset.s) === v));
      if (remember) {
        try {
          localStorage.setItem("v3.speed", String(v));
        } catch {
          /* no storage in a private window; the choice still holds for this visit */
        }
      }
    };
    try {
      const v = Number(localStorage.getItem("v3.speed"));
      if (v > 0) setSpeed(v, false);
    } catch {
      /* ignore */
    }
    for (const b of spdButtons)
      b.addEventListener("click", () => setSpeed(Number(b.dataset.s), true));

    let holding = false;
    const onHold = (e: PointerEvent) => {
      const r = clip.getBoundingClientRect();
      holding = true;
      const slow = e.clientX - r.left < r.width / 2;
      vid.playbackRate = slow ? 0.1 : 2;
      hint.textContent = slow ? "0.1× while held" : "2× while held";
      clip.classList.add("holding");
      try {
        clip.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a convenience, not a requirement */
      }
      if (vid.paused) vid.play().catch(() => {});
    };
    const onRelease = () => {
      if (!holding) return;
      holding = false;
      vid.playbackRate = speed;          // back to the speed you chose
      clip.classList.remove("holding");
    };
    clip.addEventListener("pointerdown", onHold);
    for (const ev of ["pointerup", "pointercancel", "pointerleave"])
      clip.addEventListener(ev, onRelease);
    // The browser resets playbackRate when the source changes.
    vid.addEventListener("loadedmetadata", () => {
      vid.playbackRate = speed;
    });

    // Putting the video away, so the table gets the whole window. Remembered,
    // because the answer to "do I want the video right now" holds for a whole
    // sitting rather than for one card.
    //
    // It PAUSES on the way out: a <video> that is merely display:none keeps
    // playing, and with sound.
    const vidToggle = $<HTMLButtonElement>("vidtoggle");
    const setVideo = (hide: boolean) => {
      el.classList.toggle("novideo", hide);
      vidToggle.textContent = hide ? "Show the video" : "Hide the video";
      if (hide) {
        stopAt = null;
        vid.pause();
      }
      try {
        localStorage.setItem("v3.novideo", hide ? "1" : "0");
      } catch {
        /* a private window has no storage; the toggle still works for this visit */
      }
    };
    let hidden0 = false;
    try {
      hidden0 = localStorage.getItem("v3.novideo") === "1";
    } catch {
      hidden0 = false;
    }
    setVideo(hidden0);
    vidToggle.addEventListener("click", () => setVideo(!el.classList.contains("novideo")));

    playBtn.addEventListener("click", () => {
      stopAt = null;
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
    });
    scrub.addEventListener("input", () => {
      stopAt = null;
      vid.currentTime = toRaw(Number(scrub.value));
    });

    for (const b of Array.from(el.querySelectorAll("#playbar button"))) {
      b.addEventListener("click", () => {
        playMode = (b as HTMLElement).dataset.p!;
        for (const o of Array.from(el.querySelectorAll("#playbar button")))
          o.setAttribute("aria-pressed", String(o === b));
        // Re-play whatever is on screen in the new mode, so switching is a
        // comparison rather than a setting you then have to go and apply.
        if (lastPlayed) play(lastPlayed[0], lastPlayed[1]);
      });
    }
    for (const b of Array.from(el.querySelectorAll("#filters button"))) {
      b.addEventListener("click", () => {
        filter = (b as HTMLElement).dataset.f!;
        for (const o of Array.from(el.querySelectorAll("#filters button")))
          o.setAttribute("aria-pressed", String(o === b));
        render();
      });
    }

    async function loadMatch(meta: MatchMeta) {
      META = meta;
      OFF = meta.rawOffsetS || 0;
      const base = `/research/v3-serve-detector/${meta.matchId}`;
      OV = null;
      PPL = null;
      DATA = null;
      tbody.replaceChildren();
      vlabel.textContent = "Loading …";

      const [cmp, ovj, ppl] = await Promise.all([
        fetch(`${base}/compare.json`).then((r) => r.json()),
        fetch(`${base}/overlay.json`).then((r) => r.json()),
        fetch(`${base}/people.json`).then((r) => r.json()),
      ]);
      if (dead) return;
      OV = ovj;
      ovT = Float64Array.from(ovj.ball, (r: any) => r[0]);
      bnT = Float64Array.from(ovj.bounces, (r: any) => r[0]);
      svT = Float64Array.from(ovj.serves, (r: any) => r[0]);
      PPL = ppl;
      ppT = Float64Array.from(ppl.frames, (r: any) => r[0]);
      DATA = cmp;

      const s = cmp.summary;
      const pct = Math.round((100 * s.srv_agree) / (s.srv_agree + s.srv_disagree));
      ($("summary") as HTMLElement).innerHTML =
        '<span class="chip">' + s.cards + " cards of mine</span>" +
        '<span class="chip">' + s.points + " cards you kept</span>" +
        '<span class="chip">' + s.deleted + " cards you deleted</span>" +
        '<span class="chip v-ok"><b>' + s.on_kept + "</b> of mine sit on a card you kept</span>" +
        '<span class="chip v-junk_deleted"><b>' + s.on_deleted + "</b> on one you deleted</span>" +
        '<span class="chip v-junk_unknown"><b>' + s.nowhere + "</b> where you carded nothing</span>" +
        '<span class="chip v-ok"><b>' + s.ok + "</b> correct</span>" +
        '<span class="chip v-extra"><b>' + s.extra + "</b> too many</span>" +
        '<span class="chip v-missed"><b>' + s.missed + "</b> no card</span>" +
        '<span class="chip v-fused"><b>' + s.fused + "</b> swallowed</span>" +
        '<span class="chip v-missed"><b>' + s.short + "</b> miss your winner press</span>" +
        '<span class="chip" style="border-color:#7a3358;color:#ff7ab6">dead-ball split ON — ' +
        s.dead_runs + " dead balls found</span>" +
        '<span class="chip" style="border-color:#7a3358;color:#ff7ab6">' +
        s.serves_raw + " serve detections, " + s.serves_hand +
        " thrown out as a pass-and-hold</span>" +
        '<span class="chip" style="border-color:#7a3358;color:#ff7ab6">' +
        s.blind_cards + " cards never saw the ball cross the net, " +
        s.blind_held + " held open longer</span>" +
        '<span class="chip v-ok"><b>' + s.srv_agree + "</b> right server</span>" +
        (s.srv_fixed
          ? '<span class="chip"><b>' + s.srv_fixed +
            "</b> corrected by the rotation\u2019s shape</span>"
          : "") +
        '<span class="chip v-missed"><b>' + s.srv_disagree + "</b> wrong server</span>" +
        '<span class="chip"><b>' + s.srv_by_dwell +
        "</b> read from the ball in a player’s box, <b>" + s.srv_by_bounce +
        "</b> from a bounce</span>" +
        '<span class="chip">server correct on ' + pct + "% of the " +
        (s.srv_agree + s.srv_disagree) + " cards that could be checked</span>";
      h1.textContent =
        "My cards against your scorekeeper — " + meta.title +
        (meta.venue ? " · " + meta.venue : "");
      vlabel.textContent = "Click any row to play it.";
      render();

      // The signed link is fetched, never put in the page's URL: it is a
      // time-limited credential for the original upload.
      try {
        const r = await fetch("/api/admin/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: meta.matchId, raw: true }),
        });
        const j = await r.json();
        if (!dead && j.url) {
          vid.src = j.url;
          vid.load();
        } else if (!dead) {
          vlabel.textContent =
            "The cards are below, but the original upload could not be signed" +
            (j.error ? " (" + j.error + ")" : "") + ", so there is no video to play.";
        }
      } catch {
        /* the table is still usable without the video */
      }
    }

    for (const b of Array.from(el.querySelectorAll("#matchbar button"))) {
      b.addEventListener("click", () => {
        for (const o of Array.from(el.querySelectorAll("#matchbar button")))
          o.setAttribute("aria-pressed", String(o === b));
        const m = matches.find((x) => x.matchId === (b as HTMLElement).dataset.m);
        if (m) loadMatch(m);
      });
    }

    loadMatch(matches[0]);

    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      // A <video> removed from the document keeps playing with sound.
      vid.pause();
    };
  }, [matches, initialVerdicts]);

  if (!matches.length) {
    return (
      <div className="v3">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <header>
          <h1>V3 serve detector</h1>
        </header>
        <div id="empty">
          No match has been exported yet. Run the lab&apos;s export_prod.py to add one.
        </div>
      </div>
    );
  }

  return (
    <div className="v3" ref={root}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div id="matchbar">
        <span className="lab">Match</span>
        {matches.map((m, i) => (
          <button key={m.matchId} data-m={m.matchId} aria-pressed={i === 0}>
            {m.title}
            {m.venue ? ` · ${m.venue}` : ""}
          </button>
        ))}
      </div>
      <div id="topbar">
        <header>
          <h1>My cards against your scorekeeper</h1>
          <div id="summary" />
          <div id="filters">
            <button data-f="all" aria-pressed="true">Everything</button>
            <button data-f="bad" aria-pressed="false">Only the problems</button>
            <button data-f="missed" aria-pressed="false">No card</button>
            <button data-f="fused" aria-pressed="false">Swallowed</button>
            <button data-f="extra" aria-pressed="false">Too many cards</button>
            <button data-f="junk_deleted" aria-pressed="false">On a card you deleted</button>
            <button data-f="junk_unknown" aria-pressed="false">Where you carded nothing</button>
            <button data-f="nopress" aria-pressed="false">Misses your winner press</button>
            <button data-f="srv_disagree" aria-pressed="false">Wrong server</button>
            <button data-f="called_false" aria-pressed="false">You called it not a serve</button>
            <button data-f="ok" aria-pressed="false">Correct</button>
          </div>
          <div id="viewbar">
            <button id="vidtoggle">Hide the video</button>
            <span className="lab">Speed</span>
            <button className="spd" data-s="0.25">0.25×</button>
            <button className="spd" data-s="0.5">0.5×</button>
            <button className="spd" data-s="1" aria-pressed="true">1×</button>
            <button className="spd" data-s="2">2×</button>
            <span className="lab">
              or hold the left of the picture for slow, the right for fast
            </span>
          </div>
        </header>
        <div id="videowrap">
          <div id="clip">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video id="vid" preload="metadata" playsInline />
            <canvas id="ov" />
            <div id="holdhint" />
          </div>
        </div>
        <div id="transport">
          <button id="playbtn">Play</button>
          <input id="scrub" type="range" min="0" max="1" step="0.033" defaultValue="0" />
          <span id="clock">0:00.0</span>
        </div>
        <div id="ovbar">
          <label><input type="checkbox" id="ovOn" defaultChecked /> Overlay</label>
          <label><input type="checkbox" id="ovTable" defaultChecked /> Table and net</label>
          <label><input type="checkbox" id="ovBall" defaultChecked /> Ball</label>
          <label><input type="checkbox" id="ovBounce" defaultChecked /> Bounces</label>
          <label><input type="checkbox" id="ovServe" defaultChecked /> Serves</label>
          <label><input type="checkbox" id="ovPeople" defaultChecked /> Players</label>
          <label><input type="checkbox" id="ovShoe" /> Hide bounces inside a bystander&apos;s box</label>
          <span className="key"><i className="sw" style={{ background: "#ffd479" }} />near player</span>
          <span className="key"><i className="sw" style={{ background: "#c9a0ff" }} />far player</span>
          <span className="key"><i className="sw" style={{ background: "#7fd4a0" }} />bounce on the table</span>
          <span className="key"><i className="sw" style={{ background: "#ffb08a" }} />bounce off it</span>
          <span className="key"><i className="sw" style={{ background: "#7ad4ff" }} />ball on the table</span>
          <span className="key"><i className="sw" style={{ background: "#8b97a7" }} />ball off it</span>
        </div>
        <div id="playbar">
          <span className="lab">Play</span>
          <button data-p="mine" aria-pressed="false">My card only</button>
          <button data-p="prod" aria-pressed="false">Your card only</button>
          <button data-p="both" aria-pressed="true">Both, with a run-up</button>
        </div>
        <div id="vlabel">Click any row to play it.</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: "26%" }}>What my rule produced</th>
            <th style={{ width: "21%" }}>Your scorekeeper</th>
            <th style={{ width: "18%" }}>Who served</th>
            <th style={{ width: "35%" }}>How they line up</th>
          </tr>
        </thead>
        <tbody id="tbody" />
      </table>
      <div id="empty" hidden>Nothing in this filter.</div>
    </div>
  );
}
