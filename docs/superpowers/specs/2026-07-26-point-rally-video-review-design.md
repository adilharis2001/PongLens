# Point Rally Video Review Design

## Goal

Make the standalone placement comparison report reviewable point by point. Every
point row will show the existing v2 and v3 placement maps followed by a playable
video clip of that exact rally.

## User experience

- Each of the 17 point rows contains its own native video player beneath the
  before/after maps.
- Players show browser-native controls, never autoplay, and use
  `preload="metadata"` so the page does not eagerly decode every clip.
- Each player is labeled `Point N rally video`.
- A missing or failed clip must leave the maps and reconstruction details usable
  and show an explanatory fallback message.
- The existing ready/review/unavailable status and suppression behavior remain
  unchanged.

## Report generation

`worker/eval/render_placement_match.py` will accept an optional `--video` path.
When supplied, the generator will:

1. Read each point's existing `t0` and `t1` timestamps from the match JSON.
2. Use `ffmpeg` to create `point-NN.mp4` in the report output directory.
3. Re-encode each range so clip boundaries are frame-accurate rather than
   dependent on source keyframes.
4. Add the generated relative filename to the reconstruction record.
5. Render a video player in the matching point row.

When `--video` is omitted, report generation continues to work exactly as it
does today and no empty video player is rendered.

## Boundaries and portability

The report is an offline evaluation artifact. It does not write to Supabase,
R2, or production match records. The generated HTML, SVG files, JSON, and MP4
clips are self-contained inside the report directory, allowing the directory to
be opened locally or copied as a unit.

## Error handling

- A missing input video fails generation immediately with a clear path error.
- An unavailable `ffmpeg` binary or failed clip extraction reports the point
  number and command failure instead of silently producing a broken player.
- Invalid point ranges where `t1 <= t0` fail with the point number.
- HTML paths and labels are escaped before rendering.

## Verification

Automated coverage will verify:

- reports without `--video` preserve the current behavior;
- video-enabled reports render one video element per point;
- each player references the correct `point-NN.mp4`;
- clip filenames are recorded in `reconstructed-match.json`;
- extraction uses the point's `t0`/`t1` range; and
- unavailable or contradictory placement maps remain suppressed independently
  of the video.

The regenerated Vaibhab artifact will be checked for 17 point rows, 17 video
players, 17 readable MP4 clips, and unchanged placement status totals.
