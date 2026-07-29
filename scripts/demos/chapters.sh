#!/bin/bash
# Cut the recorded chapter videos into the loops the landing page's
# walkthrough band ships (public/demo/ch-*.mp4 + poster jpgs).
#
#   bash scripts/demos/chapters.sh
#
# Full pipeline: capture.mjs ch-* -> this.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../../public/demo
mkdir -p "$OUT"

# chapter <name> <head-trim seconds>
chapter() {
  local name=$1 ss=$2
  local src="raw/$name.mp4"
  local dur to
  dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$src")
  to=$(python3 -c "print(max(1.0, float('$dur') - 0.15))")
  ffmpeg -y -v error -ss "$ss" -to "$to" -i "$src" \
    -vf "scale=720:-2,fade=t=in:st=0:d=0.25" \
    -c:v libx264 -crf 25 -preset slow -pix_fmt yuv420p \
    -movflags +faststart -an "$OUT/$name.mp4"
  ffmpeg -y -v error -ss "$ss" -i "$src" \
    -vf "scale=720:-2" -frames:v 1 -q:v 4 "$OUT/$name.jpg"
  ls -la "$OUT/$name.mp4" | awk '{printf "%-14s %6.2f MB\n", "'"$name"'", $5/1048576}'
}

chapter ch-upload    0.5
chapter ch-review    0.6
chapter ch-score     0.5
chapter ch-placement 0.6
chapter ch-coach     0.6
chapter ch-journal   0.5

echo "done -> $OUT"
