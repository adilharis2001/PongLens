# PongLens iOS design system reference

Extracted 2026-08-17 from the web app (Tailwind v4 `@theme` in `src/app/globals.css`).
The web app is **dark-only** (`color-scheme: dark`, one `dark:` variant in the whole
codebase). The iOS app pins `.preferredColorScheme(.dark)` and builds no light variants.

## Colors

Brand tokens:

| Token | Hex | Role |
|---|---|---|
| ink | `#0A0A0F` | App background; text color on cyan buttons |
| surface | `#14141C` | Card / sheet fill |
| surface2 | `#1B1B26` | Raised: inputs, active nav pill, inner rows |
| edge | `#262633` | The border color — 1px, everywhere |
| cyan-glow | `#22D3EE` | Accent. "You" side. Primary action. AccentColor. |
| magenta-glow | `#E879F9` | "Them" / opponent side |
| magenta-soft | `#F0ABFC` | Opponent text (readable on dark) |

Text ramp (body default is `#FAFAFA`, not pure white):

| Web class | Hex | Meaning |
|---|---|---|
| white | `#FFFFFF` | Emphasis / active nav |
| zinc-100 | `#F4F4F5` | Card titles, strong values |
| zinc-200 | `#E4E4E7` | Primary body, list-row titles |
| zinc-300 | `#D4D4D8` | Secondary body, button labels |
| zinc-400 | `#9F9FA9` | Muted body, inactive controls |
| zinc-500 | `#71717B` | Captions, eyebrows, metadata (most-used) |
| zinc-600 | `#52525C` | Disabled / placeholder |

Semantic: warning `#FFB900` (amber-400) / text `#FFD230`; danger `#FF6467` (red-400) /
fill `#FB2C36`; success `#00D492` (emerald-400) / text `#5EE9B5`.

**Alpha triad convention** for tinted chips/fills: `10%` fill, `40%` border,
full-strength text. Overlays: ink at 40/60/70/80%, white 5% hover, black 60% scrim.

## Typography

Web uses Geist (variable). iOS uses the system font (SF Pro) — weights map 1:1.
Scale (px): page title 24 bold tracking −0.6 (30 at ≥sm); section heading 12 semibold
UPPERCASE tracking +0.6 color zinc-500 ("iOS grouped-screen convention"); card title
16–18 semibold; body/buttons 14 (the workhorse); captions 12; micro 11 medium
(score pills, segmented); tab labels 10 medium. `leading-relaxed` 1.625 for prose.
**Every score, duration, count, timestamp uses `.monospacedDigit()`** (tabular-nums
appears in 58 web files). The web's 16px-input rule is a Safari-zoom workaround —
drop it; native fields use 14pt.

## Shape

- Cards/modals/sheets: radius **16** (`.continuous`), 1px edge border, surface fill,
  padding 20 (16 compact, 24 modals). **No shadows on cards** — depth is border+fill.
- Inputs/nested rows: radius **12**, fill surface2 at 40% or ink at 40%.
- Buttons, chips, badges, avatars, segmented controls: **capsule**.
- All borders 1px. Dividers: edge at 60%.
- Page column: 20px side margins, 32px top.

## Components

- **Primary button**: capsule, cyan fill, ink text 14 semibold, px 20 / py 12, plus the
  `glow-cta` cyan halo: ring 1px cyan@40%, shadow radius 12 cyan@35%, radius 20 y4 cyan@18%.
  Hover/press intensifies.
- **Secondary**: capsule, 1px edge border, transparent, zinc-300 text 14 medium, px 16 / py 8.
- **Cyan ghost**: capsule, cyan@50% border, cyan@10% fill, cyan text 14 semibold.
- **Soft destructive** (cancel/decline/discard): secondary but zinc-400 text, amber border+text on press.
- **Explicit destructive**: capsule, red-500@40% border, red-500@10% fill, red-300 text.
- **Confirm-delete**: capsule red-500 fill, white text.
- **Rule (from CLAUDE.md): real actions get real buttons — nothing tappable is tiny grey text.**
- **Status chip**: capsule, tint triad + 6pt leading dot; gap 6, px 10 / py 2, text 12 medium.
  Not processed zinc / Queued cyan (pulsing dot) / Processing amber / Ready emerald / Failed red.
- **Score pill**: capsule, edge border, ink@50% fill, 11 semibold tabular. You=cyan,
  separator zinc-600, them=magenta-soft.
- **Text field**: radius 12, edge border, surface2@40% fill, px 16 / py 12, text 14
  zinc-100, placeholder zinc-500, focus = cyan@60% border (no ring).
- **Sheet**: native sheet, corner 16, surface background, drag indicator. Sheet action
  row: radius 12, edge border, ink@40% fill, p 14; 36pt tinted circle icon badge
  (cyan triad); title 14 semibold zinc-100; subtitle 12 zinc-500.
- **Toast**: centered capsule near bottom, edge border, ink@85% fill, text 12 zinc-300,
  auto-dismiss, no icon.
- **Nav**: 3 tabs — Home / Matches / Journal (+ Coaching conditionally). Upload is a FAB,
  never a tab. Active tab icon = filled variant, cyan; idle = stroked 1.8, zinc-500;
  labels 10 medium. Bar: ink@90% blur + 1px edge@70% top border.
- **FAB**: capsule (not circle) — icon 18pt stroke 2.2 + label, cyan fill, ink text,
  14 semibold, px 20 / py 14, glow + black shadow, bottom-right above the tab bar.

## Background

`.bg-arena` sits behind every signed-in screen (the app is not flat black):
over ink, a cyan ellipse `rgba(34,211,238,.12)` centered at (50%, −10%) and a magenta
ellipse `rgba(232,121,249,.07)` at (85%, 15%).

## Motion

- Hovers/presses are **color changes** (200ms), not transforms.
- `pulse-cyan`: queued dot, opacity 1↔0.75 + expanding ring, 1.8s loop.
- `ks-pop`: score increment scale 1→1.18→1, 260ms.
- `ks-fade`: 180ms fade+scale .97→1 (toasts, panels).
- Page transitions: use native NavigationStack; the web's `.page-enter` exists because
  the browser gives nothing for free.
- Respect Reduce Motion.

## Icons

The web has **no icon library** — 249 hand-authored 24×24 stroke SVGs, stroke 1.8
(nav/features) or 2.0 (small chrome), round caps/joins; active states switch to filled.
Default glyph size 16pt; 14pt small; 24pt nav. iOS: use SF Symbols with matching
weights where a symbol is a faithful match, re-draw bespoke shapes (logo lens ring:
circle r12 stroked cyan 2.5 + upper-left glint arc stroke 2 @ 50%).

Logo wordmark: "Pong" white + "Lens" cyan, 18 semibold tracking tight, beside the ring.
