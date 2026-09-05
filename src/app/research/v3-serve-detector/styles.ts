/**
 * The review page's styling, lifted from the lab page it is a port of.
 *
 * Every selector is scoped under `.v3` because this page renders outside
 * AppShell but still inside the app's document: the original sheet styled
 * bare `body`, `table`, `th` and `td`, which would have reached anything
 * else on the page.
 */
export const CSS = `
.v3 { color-scheme: dark; margin:0; background:#0b0d10; color:#e7ecf3; min-height:100vh;
      font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
.v3 #topbar { position:sticky; top:0; z-index:6; background:#0b0d10;
              box-shadow:0 8px 20px -10px #000; }
.v3 header { padding:12px 16px 10px; border-bottom:1px solid #222831; }
.v3 h1 { margin:0 0 9px; font-size:16px; font-weight:600; }
.v3 #summary { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
.v3 .chip { border:1px solid #2a323d; border-radius:999px; padding:3px 11px;
            font-size:12.5px; background:#141922; white-space:nowrap; }
.v3 .chip b { font-weight:650; }
.v3 .v-ok    { color:#7fd4a0; border-color:#2c4a3a; }
.v3 .v-extra { color:#ffc978; border-color:#584526; }
.v3 .v-missed{ color:#ff9a9a; border-color:#5d2f2f; }
.v3 .v-fused { color:#e6a3ff; border-color:#4e2f5c; }
.v3 .v-junk_deleted { color:#c0c8d4; border-color:#3a424e; }
.v3 .v-junk_unknown { color:#ffb08a; border-color:#5e3a2a; }
.v3 #filters { display:flex; flex-wrap:wrap; gap:6px; }
.v3 #filters button, .v3 #matchbar button { font:inherit; font-size:12.5px; cursor:pointer;
  padding:4px 12px; border-radius:999px; border:1px solid #2a323d; background:#141922;
  color:#c7d2e0; }
.v3 #filters button[aria-pressed="true"], .v3 #matchbar button[aria-pressed="true"] {
  background:#e7ecf3; color:#0b0d10; border-color:#e7ecf3; }
.v3 #matchbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center;
                padding:8px 16px; border-bottom:1px solid #222831; }
.v3 #matchbar .lab { color:#8b97a7; font-size:12.5px; margin-right:2px; }
.v3 #videowrap { background:#000; display:flex; justify-content:center; }
.v3 #clip { position:relative; overflow:hidden; }
/* max-width:none is load-bearing. Tailwind's preflight sets
   img/video max-width:100% and height:auto, which clamps the scaled
   video to the clip's width and squashes the picture horizontally while the
   overlay keeps drawing at the true scale — so the table quad runs off the
   side of the video. The zoom here is deliberate: the video is scaled up and
   clipped to reproduce the review crop. */
.v3 #clip video { position:absolute; display:block; background:#000;
                  max-width:none; max-height:none; }
.v3 #ov { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.v3 #ovbar { display:flex; flex-wrap:wrap; align-items:center; gap:10px;
             padding:6px 16px; border-bottom:1px solid #222831; font-size:12.5px; }
.v3 #ovbar label { display:inline-flex; align-items:center; gap:5px; color:#c7d2e0;
                   cursor:pointer; white-space:nowrap; }
.v3 #ovbar input { accent-color:#7fd4a0; margin:0; }
.v3 .key { display:inline-flex; align-items:center; gap:5px; color:#8b97a7; }
.v3 .sw { width:11px; height:11px; border-radius:50%; display:inline-block; }
.v3 #transport { display:flex; align-items:center; gap:10px; padding:6px 16px;
                 border-bottom:1px solid #222831; font-size:12.5px; }
.v3 #transport button { font:inherit; font-size:12.5px; cursor:pointer; padding:3px 13px;
  border-radius:999px; border:1px solid #2a323d; background:#141922; color:#c7d2e0; }
.v3 #transport input[type=range] { flex:1; accent-color:#7fd4a0; }
.v3 #clock { color:#8b97a7; font-variant-numeric:tabular-nums; white-space:nowrap; }
.v3 #playbar { display:flex; flex-wrap:wrap; align-items:center; gap:6px;
               padding:6px 16px; border-bottom:1px solid #222831; font-size:12.5px; }
.v3 #playbar span.lab { color:#8b97a7; margin-right:2px; }
.v3 #playbar button { font:inherit; font-size:12.5px; cursor:pointer; padding:3px 11px;
  border-radius:999px; border:1px solid #2a323d; background:#141922; color:#c7d2e0; }
.v3 #playbar button[aria-pressed="true"] { background:#e7ecf3; color:#0b0d10;
  border-color:#e7ecf3; }
.v3 #vlabel { padding:6px 16px; font-size:12.5px; color:#8b97a7;
              border-bottom:1px solid #222831; }
.v3 table { border-collapse:collapse; width:100%; }
.v3 th { text-align:left; font-size:11.5px; text-transform:uppercase; letter-spacing:.6px;
         color:#8b97a7; font-weight:600; padding:10px 16px; border-bottom:1px solid #222831; }
.v3 td { padding:9px 16px; border-bottom:1px solid #161b22; vertical-align:top; }
.v3 tr.row { cursor:pointer; }
.v3 tr.row:hover td { background:#131820; }
.v3 tr.row.sel td { background:#1b2432; }
.v3 tr.junk td { background:#0e1014; }
.v3 tr.junk:hover td { background:#141820; }
.v3 .t { font-variant-numeric:tabular-nums; }
.v3 .card { display:inline-block; border:1px solid #2a323d; border-radius:6px;
            padding:1px 7px; margin:1px 4px 1px 0; background:#141922; font-size:12.5px; }
.v3 .card.hastap { border-color:#2c4a3a; }
.v3 .card b { color:#9fb3cc; font-weight:600; }
.v3 .seek { color:#6f7d8f; font-size:12px; }
.v3 .none { color:#6f7d8f; font-style:italic; }
.v3 .why { font-size:12.5px; color:#8b97a7; margin-top:4px; }
.v3 .pt { color:#e7ecf3; font-size:12.5px; font-weight:650; }
.v3 .sub2 { color:#8b97a7; font-size:12.5px; }
.v3 .won { color:#7fd4a0; } .v3 .lost { color:#ff9a9a; }
.v3 .srv { font-size:12.5px; line-height:1.65; }
.v3 .srv .lbl { color:#6f7d8f; }
.v3 .srv .how { color:#7d8896; font-size:11px; line-height:1.5; }
.v3 .srv b { font-weight:650; color:#e7ecf3; }
.v3 .srv .end { color:#8b97a7; }
.v3 .blind { display:block; margin:3px 0 6px; font-size:11px; color:#7d8896;
             line-height:1.5; }
.v3 .blind.held { color:#ffb08a; }
.v3 .tag { display:inline-block; margin-top:4px; border-radius:999px;
           padding:1px 9px; font-size:11.5px; border:1px solid #2a323d; }
.v3 .tag.agree { color:#7fd4a0; border-color:#2c4a3a; background:#12211a; }
.v3 .tag.disagree { color:#ff9a9a; border-color:#5d2f2f; background:#1f1213; }
.v3 .tl { position:relative; height:16px; margin-top:7px; border-radius:3px;
          background:#161b22; border:1px solid #222831; }
.v3 .tl i { position:absolute; top:2px; bottom:2px; border-radius:2px; background:#3d5a7a; }
.v3 .tl i.hastap { background:#2f6f4f; }
.v3 .tl u { position:absolute; top:-2px; bottom:-2px; width:2px; background:#ffd479; }
.v3 .tl s { position:absolute; top:2px; bottom:2px; border-radius:2px;
            background:#5c3b6b; text-decoration:none; }
.v3 .tl d { position:absolute; top:0; bottom:0; border-radius:3px;
            border:1px dashed #6c7a8c; }
.v3 .tl d.del { border-color:#7a5a3a; }
.v3 .tl q { position:absolute; top:-2px; bottom:-2px; min-width:2px; background:#ff7ab6; }
.v3 .tlkey { font-size:11px; color:#6f7d8f; margin-top:3px; }
.v3 #empty { padding:24px 16px; color:#8b97a7; }
.v3 .vd { display:flex; gap:4px; margin-top:7px; }
.v3 .vd button { font:inherit; font-size:11.5px; cursor:pointer; padding:2px 9px;
  border-radius:999px; border:1px solid #2a323d; background:#141922; color:#8b97a7; }
.v3 .vd button[aria-pressed="true"][data-v="genuine"] { background:#12211a; color:#7fd4a0;
  border-color:#2c4a3a; }
.v3 .vd button[aria-pressed="true"][data-v="false"] { background:#1f1213; color:#ff9a9a;
  border-color:#5d2f2f; }
.v3 .vd button[aria-pressed="true"][data-v="unsure"] { background:#1d1a12; color:#ffc978;
  border-color:#584526; }
`;
