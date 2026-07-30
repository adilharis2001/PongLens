# RTMPose match-structure operations

## Runtime contract

RTMPose is retained as dormant experimental infrastructure. Production
generation and every web-app consumer were disabled on 2026-07-30 after the
initial rollout did not generalize. The OpenAI table-calibration experiment
continues separately; nothing in this runbook should be treated as enabled
production behavior.

Current production worker:

```text
PONGLENS_RTMPOSE_STRUCTURE_ENABLED=false
PONGLENS_RTMPOSE_PY=/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python
PONGLENS_RTMPOSE_MODEL=/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
PONGLENS_RTMPOSE_BACKEND=onnxruntime
PONGLENS_RTMPOSE_DEVICE=mps
```

The production launchd plist omits the enable flag, so the worker defaults
to off. The former application rollout flags and consumers have been removed:
Keep Score asks for first server explicitly and does not apply detected
boundaries. Reintroducing either behavior requires a new reviewed rollout,
not merely changing an environment variable.

## Bootstrap and provenance

Use Python 3.11 or newer. The command now rejects older interpreters before
creating a partial environment.

```bash
/path/to/python3.12 worker/bootstrap_rtmpose.py \
  --root /Users/adil/Library/Caches/PongLens/rtmpose-production

shasum -a 256 \
  /Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx
```

Required checkpoint SHA-256:

```text
5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c
```

The isolated environment is pinned by `worker/requirements-rtmpose.txt`.
No YOLO package, checkpoint, import, or subprocess is involved.

## Persistence and authority

- Apply `supabase/migrations/051_match_structure_evidence.sql` before
  enabling worker generation.
- `match_structure.status = pending` distinguishes active generation from a
  historical match with no evidence.
- Inference failure writes a small `failed` artifact and normal match
  processing continues.
- Only summarized assignments, coverage, compute timing, and boundary
  references are stored. Raw frames and pose arrays are never persisted.
- Every evidence reference is mapped from worker index to the stable
  database point UUID before persistence.
- `first_server_source = user` and every point-level server/game override
  are authoritative and cannot be replaced by reprocessing.

## Acceptance result (Vaibhav blind match)

Run on 2026-07-29 with the production-isolated runtime:

- 125 point clips, 558 decoded frames;
- 123/125 high-confidence player assignments;
- first server: near, high confidence, 3–0 adjusted vote;
- 6 player-end changes;
- 20.22 seconds total: 2.00 model load, 6.41 decode, 10.49 inference,
  1.32 post-processing;
- exact checkpoint hash verified;
- all 125 point summaries and all boundary candidates mapped to stable point
  UUIDs;
- no raw frames or pose arrays in the database-shaped artifact.

Artifacts:

```text
/Users/adil/Desktop/PongLens-Reports/rtmpose-scoring-automation-20260729/
```

## Rollback state

The 2026-07-30 rollback removes the worker enablement from the production
launchd plist and removes the application consumers entirely. There are no
`NEXT_PUBLIC_RTMPOSE_*` switches left to flip. Stored evidence is deliberately
retained for continued experiments; user-entered first-server and game
corrections remain authoritative.
