# Music for the landing video

Drop one file here named **`bed.mp3`** and re-run the render. Nothing else
to change:

    node scripts/demos/landing/render.mjs mobile
    node scripts/demos/landing/render.mjs desktop

The renderer takes it from there: the track is dropped to a bed at -18dB,
ducked under the narration by sidechain compression so it lifts in the gaps
between lines rather than sitting flat under the voice, looped if it is
shorter than 90 seconds, trimmed if longer, and faded out with the picture.

## Where to get one

**Pixabay** (https://pixabay.com/music/) is the safest free source: its
licence allows commercial use with no attribution, which is what a landing
page needs. Search "corporate", "minimal", "ambient technology" or
"inspiring", and filter to two minutes or longer.

The file is not committed. It is not ours to redistribute, and the repo is
public — the licence permits us to USE the track, not to republish it.
