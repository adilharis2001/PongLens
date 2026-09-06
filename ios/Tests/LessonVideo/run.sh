#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
OUTPUT_DIR=$(mktemp -d)
trap 'rm -rf "$OUTPUT_DIR"' EXIT
swiftc ../../PongLens/PongLens/Core/LessonVideo.swift main.swift -o "$OUTPUT_DIR/lesson-video-tests"
"$OUTPUT_DIR/lesson-video-tests"
