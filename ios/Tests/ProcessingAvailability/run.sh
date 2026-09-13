#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
AVAILABILITY_OUT=$(mktemp -d)/availability
swiftc -module-cache-path /private/tmp/ponglens-availability-swift-cache -o "$AVAILABILITY_OUT" ../../PongLens/PongLens/Core/ProcessingAvailability.swift ../../PongLens/PongLens/Core/ProcessingServiceStore.swift ../../PongLens/PongLens/Core/ProcessingFeedback.swift main.swift
"$AVAILABILITY_OUT"
