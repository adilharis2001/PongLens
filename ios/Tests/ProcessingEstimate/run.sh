#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
ESTIMATE_OUT=$(mktemp -d)/estimate
swiftc -module-cache-path /private/tmp/ponglens-availability-swift-cache -o "$ESTIMATE_OUT" ../../PongLens/PongLens/Core/ProcessingEstimate.swift main.swift
"$ESTIMATE_OUT"
