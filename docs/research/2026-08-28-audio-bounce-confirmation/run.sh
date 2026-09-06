#!/bin/bash
# node with the repo's import resolver, from anywhere.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --experimental-strip-types --import "$HERE/register_hook.mjs" "$@"
