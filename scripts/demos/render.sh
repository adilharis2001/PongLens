#!/bin/bash
# Cut the captured raws (scripts/demos/raw/) into the small posterized
# loops the landing page ships (public/demo/). Re-run after capture.mjs.
#
#   bash scripts/demos/render.sh
set -euo pipefail
cd "$(dirname "$0")"
OUT=../../public/demo
mkdir -p "$OUT"

# clip <name> <src> <ss> <to> <width> <poster_at>
clip() {
  local name=$1 src=$2 ss=$3 to=$4 w=$5 pat=$6
  ffmpeg -y -v error -ss "$ss" -to "$to" -i "raw/$src" \
    -vf "scale=$w:-2,fade=t=in:st=0:d=0.25" \
    -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p \
    -movflags +faststart -an "$OUT/$name.mp4"
  ffmpeg -y -v error -ss "$pat" -i "raw/$src" \
    -vf "scale=$w:-2" -frames:v 1 -q:v 4 "$OUT/$name.jpg"
  ls -la "$OUT/$name.mp4" | awk '{printf "%-14s %6.2f MB\n", "'"$name"'", $5/1048576}'
}

# phone-portrait loops (raw 780x1688 -> 720 wide)
clip hero     hero.mp4     1.2 14.0 720 9.0
clip analyst  analyst.mp4  0.8 14.0 720 8.0
clip coach    coach.mp4    0.4 10.1 720 9.2
clip annotate annotate.mp4 0.8 11.6 720 7.0
clip score    score.mp4    0.4  9.0 720 8.0

# the actual exported reel (product output, landscape 1080p -> 960)
clip reel     reel.mp4     0.0  9.5 960 6.0

echo "done -> $OUT"
