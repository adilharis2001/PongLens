#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
IMPORT_OBSERVATION_OUT=$(mktemp -d)/observation
swiftc -module-cache-path /private/tmp/ponglens-availability-swift-cache -o "$IMPORT_OBSERVATION_OUT" ../../PongLens/PongLens/Core/ImportedProcessingObservation.swift main.swift
"$IMPORT_OBSERVATION_OUT"
