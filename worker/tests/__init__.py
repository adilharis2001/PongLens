"""Put worker/ on the import path before any test module loads.

The worker's modules are written to be run as scripts — the worker invokes
each stage as `python points_pipeline.py ...`, which puts worker/ on sys.path
for free — and several of them import their siblings absolutely with no
relative fallback: points_pipeline imports points_endon, which imports
points_v2, which imports table_coordinates. Production is unaffected, but a
test importing `worker.points_pipeline` as a package gets a bare
ModuleNotFoundError three levels down, and eleven test modules stop loading
at once because of it.

Fixing that properly means giving every one of those imports the
try-relative-then-absolute form the older modules already use. That is the
right change and it belongs to whoever owns those modules; doing it from here
would mean editing three files mid-edit in a shared checkout. This makes the
suite match how the code is actually run instead.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
