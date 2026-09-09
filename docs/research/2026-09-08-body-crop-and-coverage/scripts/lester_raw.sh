#!/bin/zsh
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
cd $S/poseretest || exit 1
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python - <<'PY'
import os, sys, subprocess
sys.path.insert(0, os.path.expanduser("~/Library/Caches/PongLens/serve-study")); sys.path.insert(0, ".")
import r2util, db
full = "77fc4dee-3de6-47d6-a2df-df85e239535c"
rp = db.q("select raw_path from matches where id = %s", (full,))[0]["raw_path"]
print("raw key:", rp, flush=True)
url = r2util.presign(rp)
subprocess.run(["curl", "-sSL", "-o", "crop/77fc4dee_raw.mov", url], check=True)
print("downloaded", os.path.getsize("crop/77fc4dee_raw.mov") // 1_000_000, "MB", flush=True)
PY
echo "RAW DONE $?"
