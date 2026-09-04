# Modal Backup Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cost-limited Modal overflow worker while keeping the Mac Studio primary and guaranteeing that both locations run one verified PongLens pipeline release.

**Architecture:** Package the mutable worker closure as one immutable release with Mac and Linux/CUDA runtimes, then make Supabase the race-safe control plane for worker heartbeats, leases, attempts, budget reservations, and broad user estimates. The Mac continues reading `pgmq`; a one-minute Modal dispatcher claims only eligible R2-backed `deadspace_cut` jobs and starts one T4 function, with every published artifact keyed by attempt so an expired worker cannot overwrite a newer result.

**Tech Stack:** Python 3.12, PyTorch, OpenCV, FFmpeg/FFprobe, psycopg2, boto3/R2, Modal Functions and Volumes, Supabase Postgres/pgmq, Next.js 15, React 19, TypeScript, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-04-modal-backup-worker-design.md`

## Global Constraints

- The Mac Studio remains the primary processing worker.
- Modal is overflow/outage capacity, not the default lane.
- Mac and Modal run one immutable `pipeline_release_id`; cloud dispatch is disabled whenever either worker reports a different release or model checksum.
- A release contains the same worker source, stage order, model source and weights, thresholds, feature flags, refusal rules, and output schema in both locations.
- Hardware packaging may differ between Apple MPS and NVIDIA CUDA; semantic parity is required, byte-identical encodes are not.
- Initial cloud eligibility is limited to R2-backed `deadspace_cut` jobs, including every points and placement stage selected by the user.
- `youtube_import`, `content_check`, `placement_generate`, `placement_retry`, `reclip`, `reel`, and legacy Supabase Storage inputs remain Mac-only.
- Cloud concurrency is exactly one T4 worker, `min_containers=0`, with a two-hour function timeout.
- Automatic overflow requires projected Mac work above 43,200 seconds, or a Mac heartbeat older than 900 seconds plus an oldest eligible wait above 1,800 seconds.
- Each cloud attempt reserves $1.50; new attempts stop at $3 per UTC day or $20 per calendar billing month.
- Keep the Modal workspace usage limit at $25–$30 and net spend limit at $0 or $1.
- Budget or cloud unavailability leaves jobs queued for the Mac; it never turns them into user-visible failures.
- No customer video enters Modal before privacy, provider-disclosure, and table-keypoint licensing gates pass.
- Automatic dispatch remains disabled until 20 successful manual customer canaries pass the correctness and cost gates.
- Production releases are built from committed, clean source. A mutable TTVid checkout or absolute research path is never a production dependency.
- Preserve unrelated working-tree changes and execute this plan from an isolated worktree.

## Planned file structure

### Portable runtime and releases

- `worker/blurball_infer.py` — PongLens-owned BlurBall wrapper with one `auto|mps|cuda|cpu` device contract.
- `worker/runtime_config.py` — secret lookup and platform-specific paths; no pipeline behavior lives here.
- `worker/pipeline_release.py` — manifest types, canonical release digest, startup checksum verification, and config application.
- `worker/release/pipeline.toml` — reviewed behavioral inputs and current model/source hashes.
- `worker/release/requirements-pipeline-mac.txt` — pinned Apple-silicon pipeline runtime.
- `worker/release/requirements-pipeline-modal.txt` — pinned Linux/CUDA pipeline runtime.
- `worker/release/requirements-table-mac.txt` — pinned Apple-silicon table-model runtime.
- `worker/release/requirements-table-modal.txt` — pinned Linux table-model runtime.
- `worker/release/build_release.py` — builds a sealed bundle and generated `pipeline-release.json` from a clean commit.
- `worker/release/install_mac.py` — installs a bundle into a versioned macOS directory and atomically changes `current`.
- `worker/release/promote.py` — disables cloud, promotes one release in Supabase, activates both locations, and verifies matching heartbeats.

### Control plane and execution

- `supabase/migrations/164_modal_worker_control.sql` — releases, worker heartbeats, job attempts, leases, dispatch settings, budget reservations, and owner/admin RPCs.
- `src/lib/processing/workerMigration.test.ts` — SQL contract checks for migration 164.
- `worker/job_control.py` — typed claims, lease renewal, guarded job updates, retry/recovery, and heartbeats.
- `worker/output_publish.py` — attempt-scoped R2 paths and lease-guarded publication transactions.
- `worker/processing_estimate.py` — work estimates, queue projection, display windows, and measured coefficient updates.
- `worker/modal_policy.py` — pure eligibility and budget decisions used by tests and dispatcher logging.
- `worker/modal_app.py` — scheduled dispatcher and one T4 video function.
- `worker/worker_alerts.py` — idempotent alerts for stale, mismatched, failed, and capped workers.

### Verification and product surfaces

- `worker/parity.py` — semantic Mac/Modal result comparison.
- `worker/release/parity-fixtures.json` — named short, points/placement, and upper-bound fixtures with tolerances.
- `worker/tests/` — focused tests for every Python module above plus Mac/cloud integration contracts.
- `src/app/admin/workers/` — worker health, release, queue, attempt, and budget page.
- `src/app/api/admin/workers/route.ts` — admin-only cloud mode and manual-canary actions.
- `src/lib/processing/estimate.ts` — broad user-facing estimate labels.
- `src/lib/processing/estimate.test.ts` — copy and time-boundary tests.
- `src/app/legal/legalCopy.test.ts` — privacy/terms/provider contract.
- `docs/modal-worker-operations.md` — account setup, secrets, deployment, promotion, rollback, and incident runbook.

---

### Task 1: Seal the pipeline identity and remove workstation-only runtime paths

**Files:**
- Create: `worker/blurball_infer.py`
- Create: `worker/runtime_config.py`
- Create: `worker/pipeline_release.py`
- Create: `worker/release/pipeline.toml`
- Create: `worker/release/requirements-pipeline-mac.txt`
- Create: `worker/release/requirements-pipeline-modal.txt`
- Create: `worker/release/requirements-table-mac.txt`
- Create: `worker/release/requirements-table-modal.txt`
- Create: `worker/tests/test_runtime_config.py`
- Create: `worker/tests/test_pipeline_release.py`
- Create: `worker/tests/test_blurball_infer.py`
- Modify: `THIRD_PARTY_LICENSES.md`
- Modify: `worker/worker.py:70-110`
- Modify: `worker/points_pipeline.py:1396-1403`
- Modify: `worker/table_keypoints.py:61-68`

**Interfaces:**
- `RuntimeConfig.load(platform: Literal["mac", "modal"]) -> RuntimeConfig`
- `PipelineRelease.load(path: Path) -> PipelineRelease`
- `PipelineRelease.from_payload(payload: Mapping[str, object]) -> PipelineRelease`
- `PipelineRelease.verify(runtime: RuntimeConfig) -> VerificationReport`
- `PipelineRelease.apply_behavior_env() -> None`
- `select_device(requested: str) -> torch.device`
- `VerificationReport.ready` is true only when every declared artifact hash and runtime contract matches.

- [ ] **Step 1: Resolve the table-keypoint source and checkpoint rights**

Read the licence in the private upstream source directory, trace the exact
checkpoint's download/provenance record, and verify both against the upstream
repository or publisher. Record the source commit, GPL-3.0 obligations,
checkpoint provenance, and whether storage/execution by Modal is permitted in
`THIRD_PARTY_LICENSES.md`. If checkpoint permission remains unstated, keep
`license_gate_passed=false`: local implementation may continue, but no model
file, private fixture, or customer video may be uploaded to Modal.

- [ ] **Step 2: Write failing runtime and release tests**

Test these exact behaviors:

```python
def test_modal_requires_explicit_runtime_root(self):
    with patch.dict(os.environ, {}, clear=True):
        with self.assertRaisesRegex(RuntimeError, "PONGLENS_RUNTIME_ROOT"):
            RuntimeConfig.load("modal")

def test_release_id_is_canonical_and_verifies_artifacts(self):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        artifact = root / "blurball.pt"
        artifact.write_bytes(b"sealed")
        release = PipelineRelease.from_payload(release_payload(artifact))
        self.assertEqual(release.release_id, release.with_reordered_keys().release_id)
        self.assertTrue(release.verify(runtime_for(root)).ready)
        artifact.write_bytes(b"changed")
        self.assertFalse(release.verify(runtime_for(root)).ready)

def test_auto_device_prefers_cuda_then_mps_then_cpu(self):
    with patch.object(torch.cuda, "is_available", return_value=True):
        self.assertEqual(select_device("auto").type, "cuda")
```

Define `release_payload()` and `runtime_for()` as private test helpers in
`test_pipeline_release.py`; each creates every declared artifact inside its
temporary directory and calculates its expected SHA-256.

- [ ] **Step 3: Run the tests and confirm missing modules fail**

Run:

```bash
python3 -m unittest worker.tests.test_runtime_config worker.tests.test_pipeline_release worker.tests.test_blurball_infer -v
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 4: Bring the BlurBall wrapper into PongLens and add CUDA**

Copy the current logic from `/Users/adil/Desktop/Projects/TTVid/vendor/blurball_infer.py` into `worker/blurball_infer.py`, replace its absolute repository path with `PONGLENS_BLURBALL_HOME`, and use this device rule:

```python
def select_device(requested: str):
    if requested == "auto":
        if torch.cuda.is_available():
            requested = "cuda"
        elif torch.backends.mps.is_available():
            requested = "mps"
        else:
            requested = "cpu"
    if requested not in {"cuda", "mps", "cpu"}:
        raise ValueError(f"unsupported BlurBall device: {requested}")
    return torch.device(requested)
```

Keep the same preprocessing, checkpoint loading, postprocessor, tracker,
defaults (`step=3`, threshold `0.5`, batch `8`), and JSONL output schema.

- [ ] **Step 5: Implement platform-only runtime configuration**

Define this immutable shape in `runtime_config.py`:

```python
@dataclass(frozen=True)
class RuntimeConfig:
    platform: Literal["mac", "modal"]
    runtime_root: Path
    pipeline_python: Path
    table_python: Path
    blurball_home: Path
    blurball_weights: Path
    table_keypoint_home: Path
    rtmpose_model: Path
    ffmpeg: str
    ffprobe: str
```

On Mac, secrets may still fall back to Keychain. On Modal, every secret and
path must be present in the environment and Keychain lookup must never run.
The Modal lane accepts only R2 inputs, so it uses the restricted
`ponglens_worker` database login and does not receive the Supabase service-role
JWT used by the Mac's legacy Supabase Storage path.
Remove the `TTVID`, `VENV_PY`, and external `BLURBALL_INFER` constants from
`worker.py`; derive every subprocess command from `RuntimeConfig`.

- [ ] **Step 6: Define the behavioral release input**

Start `worker/release/pipeline.toml` with the investigated baseline:

```toml
schema_version = 1
output_schema_version = 1

[blurball]
repo_commit = "2f0f5496f7ba4b5b1a36790749935121b2ce972d"
wrapper_sha256 = "cb2e1af40792d9379e6a1fd86843671a4abb93239e8b7be7a4a6c18a9aa9f781"
weights_sha256 = "3545206c7155194ea654899d33579c88c9fd8e82c632cbdbae3b0c0ec3f2985f"
step = 3
threshold = 0.5
batch = 8

[table_keypoints]
model = "segformerpp_b0"
weights_sha256 = "d7deef52395949ac1d013ad86ca6335166fd1edd8ff090896562f86c0a084394"
frames = 16
device = "cpu"

[rtmpose]
enabled = false
model_sha256 = "5c0a4bf67953e6d2ac43ce15e77dc9d5d354ae18430a47d2c5963a7bc5683e3c"

[gates]
content_model = "gpt-5-nano"
content_frames = 12
content_min_positive = 3
broadcast_cut_score = 0.30
broadcast_cut_frames = 5

[placement]
vision_model = "gpt-5.6-sol"
fallback_model = "gpt-5.6-luna"
```

Generate the wrapper hash from the new PongLens-owned file before the first
candidate build; the old value must deliberately fail verification until the
reviewed source hash is updated.

- [ ] **Step 7: Pin both platform dependency sets**

Keep separate Python 3.12 locks for the main pipeline and GPL table-keypoint
process, because they already use separate environments and have different
OpenCV/ML dependency graphs. Seed the Mac locks from the live environments:

```bash
/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python -m pip freeze
/Users/adil/Library/Caches/PongLens/table-keypoints/venv/bin/python -m pip freeze
```

Capture each command's complete output and create its corresponding lock with
`apply_patch`; do not use shell redirection to edit repository files.

Create the two Modal locks from clean Python 3.12 Linux environments, keeping
the same application package versions and using CUDA PyTorch plus
`opencv-python-headless`. Every package line must use `==`; reject editable,
local-path, Git-HEAD, and unpinned entries. Verify all four with:

```bash
python3.12 -m pip install --dry-run -r worker/release/requirements-pipeline-mac.txt
python3.12 -m pip install --dry-run -r worker/release/requirements-table-mac.txt
python3.12 -m pip install --dry-run -r worker/release/requirements-pipeline-modal.txt
python3.12 -m pip install --dry-run -r worker/release/requirements-table-modal.txt
```

Expected: both dependency graphs resolve without an unpinned requirement.

- [ ] **Step 8: Implement canonical manifest verification and behavior loading**

The release ID is `sha256` over canonical JSON excluding `release_id` itself:

```python
def canonical_sha256(payload: Mapping[str, object]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()
```

`apply_behavior_env()` sets every pipeline-affecting value from the manifest
and rejects a conflicting process environment value. Secrets and physical
paths are excluded from the release digest.

- [ ] **Step 9: Run focused tests and a short dual-device smoke test**

Run:

```bash
python3 -m unittest worker.tests.test_runtime_config worker.tests.test_pipeline_release worker.tests.test_blurball_infer -v
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 1 -pix_fmt yuv420p /tmp/ponglens-parity-short.mp4
PONGLENS_BLURBALL_HOME=/Users/adil/Desktop/Projects/TTVid/vendor/blurball \
  /Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python \
  worker/blurball_infer.py --video /tmp/ponglens-parity-short.mp4 \
  --out /tmp/ponglens-blurball-smoke.jsonl --max-frames 30 --device auto
```

Expected: tests PASS and the smoke output contains 30 JSONL records.

- [ ] **Step 10: Commit the portable runtime**

```bash
git add THIRD_PARTY_LICENSES.md worker/blurball_infer.py worker/runtime_config.py worker/pipeline_release.py worker/release/pipeline.toml worker/release/requirements-pipeline-mac.txt worker/release/requirements-pipeline-modal.txt worker/release/requirements-table-mac.txt worker/release/requirements-table-modal.txt worker/tests/test_runtime_config.py worker/tests/test_pipeline_release.py worker/tests/test_blurball_infer.py worker/worker.py worker/points_pipeline.py worker/table_keypoints.py
git commit -m "Package the video pipeline as one release"
```

---

### Task 2: Add the Supabase worker control plane and atomic leases

**Files:**
- Create: `supabase/migrations/164_modal_worker_control.sql`
- Create: `src/lib/processing/workerMigration.test.ts`
- Create: `worker/tests/test_job_control_db.py`
- Modify: `package.json`

**Interfaces:**
- `public.report_worker_heartbeat(p_worker_id text, p_lane text, p_release_id text, p_healthy boolean, p_details jsonb) -> boolean`
- `public.claim_processing_job(p_job_id uuid, p_lane text, p_worker_id text, p_release_id text, p_lease_seconds integer) -> jsonb`
- `public.claim_cloud_candidate(p_worker_id text, p_release_id text, p_lease_seconds integer) -> jsonb`
- `public.renew_job_lease(p_attempt_id uuid, p_lease_token uuid, p_lease_seconds integer) -> timestamptz`
- `public.release_job_for_retry(p_attempt_id uuid, p_lease_token uuid, p_reason text) -> boolean`
- `public.complete_job_attempt(p_attempt_id uuid, p_lease_token uuid, p_metered_cost_usd numeric) -> boolean`
- `public.recover_expired_job_attempts() -> integer`
- `public.request_cloud_canary(p_job_id uuid) -> boolean`
- `public.set_cloud_dispatch_mode(p_mode text) -> boolean`
- `public.set_worker_rollout_gate(p_gate text, p_passed boolean, p_evidence jsonb) -> boolean`
- `public.get_worker_control_dashboard() -> jsonb`

- [ ] **Step 1: Write the failing SQL contract test**

The Node test reads migration 164 and requires all tables, constraints,
indexes, revokes, and functions. Include race-sensitive assertions:

```ts
assert.match(sql, /create table public\.pipeline_releases/);
assert.match(sql, /create table public\.worker_heartbeats/);
assert.match(sql, /create table public\.job_attempts/);
assert.match(sql, /create table public\.worker_alert_deliveries/);
assert.match(sql, /active_attempt_id uuid/);
assert.match(sql, /lease_token uuid not null unique/);
assert.match(sql, /for update skip locked/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /reserved_cost_usd numeric/);
assert.match(sql, /revoke all .* anon, authenticated/);
```

- [ ] **Step 2: Add and run the worker-control test command**

Add:

```json
"test:worker-control": "node --test --experimental-strip-types src/lib/processing/*.test.ts"
```

Run `npm run test:worker-control`.

Expected: FAIL because migration 164 does not exist.

- [ ] **Step 3: Create the release, heartbeat, attempt, and control tables**

Migration 164 must create:

```sql
create table public.pipeline_releases (
  release_id text primary key,
  manifest_sha256 text not null unique,
  manifest jsonb not null,
  status text not null check (status in ('candidate','active','retired')),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create table public.worker_heartbeats (
  worker_id text primary key,
  lane text not null check (lane in ('mac','modal')),
  release_id text not null references public.pipeline_releases(release_id),
  healthy boolean not null,
  details jsonb not null default '{}'::jsonb,
  heartbeat_at timestamptz not null default now()
);

create table public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  lane text not null check (lane in ('mac','modal')),
  worker_id text not null,
  release_id text not null references public.pipeline_releases(release_id),
  lease_token uuid not null default gen_random_uuid() unique,
  lease_expires_at timestamptz not null,
  status text not null check (status in
    ('claimed','running','publishing','succeeded','retryable','failed','abandoned')),
  attempt_number integer not null,
  provider_invocation_id text,
  manual_canary boolean not null default false,
  reserved_cost_usd numeric(8,4) not null default 0,
  metered_cost_usd numeric(10,6),
  error_kind text,
  details jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (job_id, attempt_number)
);

create table public.worker_alert_deliveries (
  alert_key text primary key,
  kind text not null,
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  sent_at timestamptz,
  send_attempts integer not null default 0
);
```

`alert_key` is a deterministic digest of alert kind, affected worker or
attempt, and incident generation. Inserting the same key twice is a no-op.
Alert delivery uses the same key as Resend's `Idempotency-Key`, records the
provider response, and retries only pending rows inside Resend's documented
24-hour idempotency window.

Add one singleton control table and seed row:

```sql
create table public.processing_control (
  singleton boolean primary key default true check (singleton),
  active_release_id text references public.pipeline_releases(release_id),
  cloud_mode text not null default 'disabled'
    check (cloud_mode in ('disabled','manual','automatic')),
  reservation_usd numeric(8,4) not null default 1.50,
  daily_cap_usd numeric(8,4) not null default 3.00,
  monthly_cap_usd numeric(8,4) not null default 20.00,
  max_cloud_concurrency integer not null default 1
    check (max_cloud_concurrency = 1),
  backlog_trigger_s integer not null default 43200,
  mac_stale_s integer not null default 900,
  oldest_wait_s integer not null default 1800,
  privacy_gate_passed boolean not null default false,
  license_gate_passed boolean not null default false,
  parity_gate_passed boolean not null default false,
  successful_cloud_canaries integer not null default 0,
  latest_dispatch_reason text,
  gate_evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.processing_control(singleton) values (true);
```

Only a successful attempt created from an explicit manual canary request may
increment `successful_cloud_canaries`, and `(job_id, attempt_number)` keeps a
replayed completion from incrementing it twice.

- [ ] **Step 4: Extend jobs with execution and estimate fields**

Add these nullable fields without changing existing user reads:

```sql
alter table public.jobs
  add column active_attempt_id uuid references public.job_attempts(id) on delete set null,
  add column execution_lane text check (execution_lane in ('mac','modal')),
  add column pipeline_release_id text references public.pipeline_releases(release_id),
  add column source_duration_s double precision,
  add column source_fps double precision,
  add column source_width integer,
  add column source_height integer,
  add column source_size_bytes bigint,
  add column source_metadata_verified_at timestamptz,
  add column estimated_work_seconds integer,
  add column eta_earliest_at timestamptz,
  add column eta_latest_at timestamptz,
  add column cloud_requested_at timestamptz;
```

Add indexes over `(status, kind, created_at)`, live attempt expiry, heartbeat
lane/time, and Modal attempt date/cost.

- [ ] **Step 5: Implement one transaction-safe claim path**

Both claim functions must lock the job and the singleton control row. A claim
succeeds only for `status='queued'`, no live active attempt, and a worker
release equal to the active release. `claim_cloud_candidate` additionally
uses `FOR UPDATE SKIP LOCKED`, checks R2 input, kind, feature support,
heartbeat/backlog trigger, concurrency, and atomic daily/monthly reservation.

Return this stable JSON shape:

```json
{
  "attempt_id": "uuid",
  "lease_token": "uuid",
  "attempt_number": 1,
  "lane": "modal",
  "worker_id": "modal-dispatcher",
  "release_id": "sha256",
  "job": {
    "id": "uuid",
    "user_id": "uuid",
    "kind": "deadspace_cut",
    "input_path": "r2://ponglens-raw/key",
    "options": {}
  }
}
```

- [ ] **Step 6: Implement lease lifecycle and stale recovery**

`renew_job_lease` succeeds only for the active attempt and matching token.
`release_job_for_retry` marks the attempt retryable, clears the active attempt,
sets the job back to queued, and sends a new `pgmq` message with the next
generation. `complete_job_attempt` atomically marks success and clears the
active attempt. Recovery uses an advisory transaction lock so two dispatchers
cannot recover the same expired lease.

- [ ] **Step 7: Protect control operations and patch cancellation**

Create a `ponglens_worker` login role with `BYPASSRLS`, no membership in
`postgres`, `service_role`, or other privileged roles, and no password in the
migration. Grant schema usage only on `public`, `pgmq`, `auth`, and `storage`;
read only on `auth.users` and `storage.objects`; and the exact DML required on
`app_config`, `app_roles`, `cost_provider_snapshots`, `cost_usage_events`,
`email_suppressions`, `feedback_items`, `jobs`, `job_attempts`, `matches`,
`match_reels`, `notifications`, `pipeline_releases`, `processing_control`,
`processing_ledger`, `qa_bug_messages`, `qa_bugs`, `storage_ledger`,
`tag_reels`, `tags`, `worker_alert_deliveries`, `worker_heartbeats`, and
`points`. Grant execute only on
the worker/control functions and the existing cost/queue functions the worker
calls. A source-contract test must fail whenever worker SQL introduces another
table without a matching explicit grant.

Revoke all new tables/functions from `anon` and `authenticated`. Grant worker
RPCs only to `ponglens_worker` and `service_role`. `request_cloud_canary`,
`set_cloud_dispatch_mode`, `set_worker_rollout_gate`, and
`get_worker_control_dashboard` must call `public.is_admin()` before reading or
changing global state. Replace
`cancel_queued_processing` so its row lock is ordered consistently with claim
and it can never cancel a live attempt.

- [ ] **Step 8: Reset local Supabase and run race tests**

Add a test helper that opens two database connections and proves:

```python
with ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(claim_same_job, ["mac-a", "modal-a"]))
self.assertEqual(sum(result is not None for result in results), 1)
```

Run:

```bash
supabase db reset --local
npm run test:worker-control
python3 -m unittest worker.tests.test_job_control_db -v
```

Expected: PASS; one owner under claim/claim and claim/cancel races.

- [ ] **Step 9: Commit the control plane**

```bash
git add supabase/migrations/164_modal_worker_control.sql src/lib/processing/workerMigration.test.ts worker/tests/test_job_control_db.py package.json
git commit -m "Add atomic worker leases and cloud controls"
```

---

### Task 3: Make the Mac worker lease-aware and publish heartbeats

**Files:**
- Create: `worker/job_control.py`
- Create: `worker/tests/test_job_control.py`
- Create: `worker/tests/test_worker_claim_contract.py`
- Modify: `worker/worker.py:500-540`
- Modify: `worker/worker.py:6830-7750`

**Interfaces:**
- `JobClaim.from_rpc(payload: Mapping[str, object]) -> JobClaim`
- `JobController.claim_mac(job_id: str, worker_id: str, release_id: str) -> JobClaim | None`
- `JobController.renew(claim: JobClaim) -> datetime`
- `JobController.update_job(claim: JobClaim, **fields) -> bool`
- `JobController.retry(claim: JobClaim, reason: str) -> None`
- `JobController.fail(claim: JobClaim, reason: str, terminal: bool) -> None`
- `JobController.complete(claim: JobClaim, metered_cost_usd: Decimal | None) -> None`
- `LeaseHeartbeat(controller, claim, every_s=30, lease_s=120)` is a context manager.

- [ ] **Step 1: Write failing unit and source-contract tests**

Require a lost lease to abort guarded writes and require `worker.py` to stop
containing the unsafe SQL:

```python
def test_guarded_update_raises_after_lease_loss(self):
    controller = fake_controller(renewed=False)
    with self.assertRaises(LeaseLost):
        controller.update_job(CLAIM, progress=50)

def test_worker_has_no_non_cancelled_processing_claim(self):
    source = Path("worker/worker.py").read_text()
    self.assertNotIn("status <> 'cancelled' returning id", source)
    self.assertIn("claim_mac(", source)
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
python3 -m unittest worker.tests.test_job_control worker.tests.test_worker_claim_contract -v
```

Expected: FAIL because `job_control.py` is absent and the old claim remains.

- [ ] **Step 3: Implement typed claims and guarded updates**

Use explicit ownership, never module-global current-job state:

```python
@dataclass(frozen=True)
class JobClaim:
    attempt_id: str
    lease_token: str
    attempt_number: int
    lane: Literal["mac", "modal"]
    worker_id: str
    release_id: str
    job: Mapping[str, object]
```

`update_job` builds its `SET` list only from an internal allowlist and uses
this ownership predicate in the same statement:

```sql
update public.jobs as j
set progress = %s
from public.job_attempts as a
where j.id = %s
  and j.active_attempt_id = a.id
  and a.id = %s
  and a.lease_token = %s
  and a.lease_expires_at > now()
```

Zero updated rows raises `LeaseLost`.

- [ ] **Step 4: Add the lease-renewal context manager**

Use a separate database connection in one daemon thread. Renew every 30
seconds for a 120-second lease. `__exit__` stops and joins the thread. If a
renewal fails twice or the RPC reports no ownership, set a thread-safe lost
flag checked by `raise_if_lost()` before every stage and publication.

- [ ] **Step 5: Replace the Mac claim and update calls**

The Mac loop still reads one `pgmq` message. It then calls `claim_mac` with
`worker_id="mac-studio"` and the verified release ID. If claim returns `None`,
archive the stale queue message and do nothing. Pass the returned `JobClaim`
into `execute_claimed_job`; replace every processing-path
`update_job(conn, job_id, **fields)` call with
`controller.update_job(claim, **fields)`.

Wrap each claimed execution in a structured logger adapter carrying
`job_id`, `attempt_id`, `lane`, `worker_id`, and `release_id`. Every stage log
adds `stage`; tests must reject execution-path log calls missing any of these
fields. The same adapter is imported by Modal, so incident logs have one
shape on both lanes.

- [ ] **Step 6: Preserve deterministic and transient failure semantics**

Map outcomes explicitly:

```python
except UserFacingError as error:
    controller.fail(claim, str(error), terminal=True)
    archive_message(conn, msg_id)
except LeaseLost:
    log.warning("attempt lost its lease; no publication allowed")
except Exception as error:
    controller.retry(claim, type(error).__name__)
```

The Mac's second failed attempt remains the poison-message terminal outcome.
Modal operational failures always return to the Mac queue and do not consume a
second cloud reservation automatically.

- [ ] **Step 7: Add the Mac heartbeat loop**

Every 30 seconds report worker ID, lane, release ID, health, manifest digest,
model checksum status, current attempt ID, and current stage. A worker with a
failed release verification reports `healthy=false` and never reads `pgmq`.

- [ ] **Step 8: Run focused tests and a foreground no-job smoke test**

Run:

```bash
python3 -m unittest worker.tests.test_job_control worker.tests.test_worker_claim_contract -v
PONGLENS_PIPELINE_RELEASE=worker/release/test-release.json python3 worker/worker.py --health-check
```

Expected: tests PASS and health check prints one JSON object containing
`worker_id`, `lane`, `release_id`, `healthy`, and `checksums`.

- [ ] **Step 9: Commit the lease-aware Mac worker**

```bash
git add worker/job_control.py worker/tests/test_job_control.py worker/tests/test_worker_claim_contract.py worker/worker.py
git commit -m "Guard Mac processing with renewable leases"
```

---

### Task 4: Make output publication attempt-safe and record stage timing

**Files:**
- Create: `worker/output_publish.py`
- Create: `worker/tests/test_output_publish.py`
- Create: `worker/tests/test_attempt_publication.py`
- Modify: `worker/worker.py:3500-4785`
- Modify: `worker/cost_meter.py`
- Modify: `worker/tests/test_cost_meter.py`

**Interfaces:**
- `AttemptPublisher(job_id, attempt_id, user_id, match_id=None)`
- `AttemptPublisher.result_uri() -> str`
- `AttemptPublisher.points_prefix() -> str`
- `owned_publication(conn, claim)` is a transaction context manager.
- `StageTimer.record(stage: str, elapsed_s: float, profile: VideoProfile) -> None`

- [ ] **Step 1: Write failing publisher and ownership tests**

Test unique output identities and expired publication refusal:

```python
def test_attempt_paths_never_collide(self):
    a = AttemptPublisher("job", "attempt-a", "user", "match")
    b = AttemptPublisher("job", "attempt-b", "user", "match")
    self.assertNotEqual(a.result_uri(), b.result_uri())
    self.assertNotEqual(a.points_prefix(), b.points_prefix())

def test_publication_rolls_back_when_lease_is_not_owned(self):
    with self.assertRaises(LeaseLost):
        with owned_publication(expired_connection(), CLAIM):
            self.fail("body must not run")
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
python3 -m unittest worker.tests.test_output_publish worker.tests.test_attempt_publication worker.tests.test_cost_meter -v
```

Expected: FAIL because attempt publishing is not implemented.

- [ ] **Step 3: Use immutable attempt-scoped R2 paths**

Use these final keys directly; do not overwrite a shared key:

```python
result = f"results/{user_id}/{job_id}/{attempt_id}.mp4"
points = f"points/{user_id}/{match_id}/{attempt_id}/"
temporary = f"attempts/{job_id}/{attempt_id}/"
```

Database rows point only to the successful attempt's result and points prefix.
An abandoned attempt's objects remain unreferenced and are removed after a
two-day grace period by the retention sweep.

- [ ] **Step 4: Add the lease-guarded publication transaction**

`owned_publication` disables autocommit, locks `jobs` and its active
`job_attempts` row, validates ID/token/expiry, performs the match/point/job
writes, and commits. It rolls back and restores the prior autocommit value on
every exception.

- [ ] **Step 5: Delay authoritative match mutation until outputs exist**

Refactor `run_points_stage` into preparation and publication:

```python
prepared = prepare_points_result(
    claim=claim,
    publisher=publisher,
    input_video=input_video,
    blurball_output=blurball_output,
    options=options,
)
with owned_publication(conn, claim):
    publish_points_result(conn, claim, prepared)
```

Preparation may upload attempt-scoped clips, `match.json`, thumbnails, and
diagnostics but may not delete existing points or mark the match ready. The
publication transaction performs the delete/insert replacement, updates all
match fields, links the successful attempt paths, and records storage ledger
rows exactly once using attempt-scoped idempotency keys.

- [ ] **Step 6: Guard cut-only, failure, refund, and side-change writes**

Cut-only completion and points failure use `owned_publication`. Post-ready
side-change work keeps the lease alive and checks ownership before its match
update. An expired attempt may leave unreferenced R2 objects but cannot alter
the user-visible match, refund, notification, or job state.

- [ ] **Step 7: Record stage timing without personal identifiers**

Extend cost metadata to allow `lane`, `release_id`, and `stage`; keep raw job,
match, filename, user, object key, and email values forbidden. Use
`stable_key(job_id, attempt_id, stage)` only as the idempotency identity.
Persist per-attempt stage durations in `job_attempts.details` for the estimator
and write aggregate Modal/Mac compute events to the existing cost ledger.

- [ ] **Step 8: Test crash points and idempotent replay**

Exercise death after source download, BlurBall, cut upload, points upload, DB
publication, notification, and side-change. For each fixture, rerun the job and
assert one active job result, one point set, one notification, one refund at
most, and no stale-attempt database paths.

Run:

```bash
python3 -m unittest worker.tests.test_output_publish worker.tests.test_attempt_publication worker.tests.test_cost_meter -v
```

Expected: PASS.

- [ ] **Step 9: Commit attempt-safe publication**

```bash
git add worker/output_publish.py worker/tests/test_output_publish.py worker/tests/test_attempt_publication.py worker/worker.py worker/cost_meter.py worker/tests/test_cost_meter.py
git commit -m "Make worker publication attempt safe"
```

---

### Task 5: Estimate queue work and enforce application budgets

**Files:**
- Create: `worker/processing_estimate.py`
- Create: `worker/modal_policy.py`
- Create: `worker/tests/test_processing_estimate.py`
- Create: `worker/tests/test_modal_policy.py`
- Modify: `worker/worker.py`
- Modify: `src/app/dashboard/UploadCard.tsx:455-460`
- Modify: `src/app/dashboard/UploadCard.tsx:785-815`
- Modify: `supabase/migrations/164_modal_worker_control.sql`
- Modify: `src/lib/processing/workerMigration.test.ts`

**Interfaces:**
- `VideoProfile(duration_s, fps, width, height, points, placement)`
- `estimate_work_seconds(profile: VideoProfile, coefficients: Coefficients) -> int`
- `project_queue(jobs: Sequence[QueuedWork], current: ActiveWork | None) -> QueueProjection`
- `cloud_reason(snapshot: DispatchSnapshot) -> DispatchDecision`
- `record_verified_profile(claim, profile) -> None`
- `refresh_job_estimates(conn, release_id: str) -> int`

- [ ] **Step 1: Write failing estimator and policy boundary tests**

Pin all threshold edges:

```python
def test_sixty_fps_starts_at_twice_thirty_fps(self):
    thirty = estimate_work_seconds(profile(fps=30), INITIAL)
    sixty = estimate_work_seconds(profile(fps=60), INITIAL)
    self.assertGreater(sixty, thirty * 1.9)

def test_cloud_starts_only_above_twelve_hours(self):
    self.assertFalse(cloud_reason(snapshot(backlog_s=43_200)).dispatch)
    self.assertTrue(cloud_reason(snapshot(backlog_s=43_201)).dispatch)

def test_outage_needs_both_stale_heartbeat_and_wait(self):
    self.assertFalse(
        cloud_reason(snapshot(mac_age_s=901, oldest_wait_s=1_800)).dispatch
    )
    self.assertTrue(
        cloud_reason(snapshot(mac_age_s=901, oldest_wait_s=1_801)).dispatch
    )
```

Define `profile()` and `snapshot()` in the respective test modules with safe,
eligible defaults so each test changes only the boundary named in its title.

- [ ] **Step 2: Run tests and confirm missing modules fail**

Run:

```bash
python3 -m unittest worker.tests.test_processing_estimate worker.tests.test_modal_policy -v
```

Expected: FAIL because the estimator and policy do not exist.

- [ ] **Step 3: Implement the conservative first estimate**

Use this explicit initial model until ten successful active-release jobs exist:

```python
fps_factor = min(4.0, max(0.5, profile.fps / 30.0))
seconds = 120 + profile.duration_s * fps_factor
if profile.points:
    seconds += profile.duration_s * 0.25
if profile.placement:
    seconds += 180
return round(min(seconds, 8 * 3600))
```

After ten jobs, use release-specific median stage seconds per source minute,
retaining a 25% safety margin. A new release begins with the conservative
coefficients and learns independently; timing from an older model release
never silently changes a new release's routing.

- [ ] **Step 4: Probe and persist the verified video profile**

Extend `uploadRef` with `size` and include the browser-known
`source_duration_s: durationS` and `source_size_bytes: up.size` in the direct
upload's job insert. The database clamps these unverified hints to 2,700
seconds and 2 GiB and uses them only for the first queue estimate.

After every source download, run one FFprobe JSON command for duration,
`avg_frame_rate`, width, and height, record file size, and call the guarded
profile RPC. The browser-supplied duration/size may seed an early display but
is marked unverified and clamped to product limits; dispatch decisions prefer
verified metadata when present.

- [ ] **Step 5: Recompute queue projections and broad ETA windows**

Oldest eligible job receives the current job's predicted remaining seconds;
each later job adds work ahead. Store:

```python
eta_earliest = now + timedelta(seconds=max(300, work_ahead * 0.75))
eta_latest = now + timedelta(seconds=max(1800, (work_ahead + own_work) * 1.50))
```

Refresh after job creation, claim, verified probe, stage completion, terminal
state, and each one-minute dispatcher run.

- [ ] **Step 6: Make cloud eligibility and budget reservation atomic**

`claim_cloud_candidate` must reserve $1.50 inside the same transaction that
creates the attempt. Sum reservations for UTC day and `date_trunc('month',
now())`; use `>` so exactly $3.00/day or $20.00/month is allowed but another
reservation is not. Reconcile the reservation to the metered estimate when an
attempt finishes. No failure automatically creates another cloud attempt.

- [ ] **Step 7: Cover budget, release, lane, and job-kind refusal reasons**

`DispatchDecision.reason` is one of:

```python
"eligible", "disabled", "manual_only", "mac_healthy",
"backlog_below_threshold", "release_mismatch", "model_mismatch",
"cloud_busy", "daily_cap", "monthly_cap", "unsupported_kind",
"unsupported_storage", "unsupported_options", "cloud_unhealthy"
```

Persist the latest reason for the admin page; never expose it to users.

- [ ] **Step 8: Run focused and database tests**

Run:

```bash
python3 -m unittest worker.tests.test_processing_estimate worker.tests.test_modal_policy -v
supabase db reset --local
npm run test:worker-control
python3 -m unittest worker.tests.test_job_control_db -v
```

Expected: PASS, including concurrent dispatchers never exceeding one active
Modal attempt or either cost cap.

- [ ] **Step 9: Commit estimates and budgets**

```bash
git add worker/processing_estimate.py worker/modal_policy.py worker/tests/test_processing_estimate.py worker/tests/test_modal_policy.py worker/worker.py src/app/dashboard/UploadCard.tsx supabase/migrations/164_modal_worker_control.sql src/lib/processing/workerMigration.test.ts
git commit -m "Add queue estimates and cloud budget policy"
```

---

### Task 6: Build the Modal dispatcher and T4 worker

**Files:**
- Create: `worker/modal_app.py`
- Create: `worker/modal_runtime.py`
- Create: `worker/tests/test_modal_app_contract.py`
- Create: `worker/tests/test_modal_runtime.py`
- Modify: `worker/release/requirements-pipeline-modal.txt`
- Modify: `worker/release/requirements-table-modal.txt`

**Interfaces:**
- Modal app name: `ponglens-video-overflow`
- Modal secret name: `ponglens-worker-runtime`
- Modal model volume: `ponglens-models`
- `dispatch_overflow() -> None` runs every minute on CPU.
- `run_cloud_job(claim_payload: dict) -> None` runs on one T4.
- `release_health() -> Mapping[str, object]` verifies the sealed release without customer data.
- `recover_expired_job_attempts() -> int` calls the recovery RPC.
- `refresh_job_estimates() -> int` updates queued estimates through the shared estimator.
- `claim_cloud_candidate() -> JobClaim | None` calls the only cloud-claim RPC.
- `execute_claimed_job(claim: JobClaim, platform="modal")` is the same entry point used by the Mac after claim.
- `record_provider_invocation(claim: JobClaim, provider_invocation_id: str) -> None`
- `assert_lease_owned(claim: JobClaim) -> None` performs a cheap database check before costly startup work.

- [ ] **Step 1: Write the failing Modal contract tests**

Read `modal_app.py` as source so unit tests do not need Modal credentials:

```python
self.assertIn('modal.App("ponglens-video-overflow")', source)
self.assertIn("modal.Period(minutes=1)", source)
self.assertIn('gpu="T4"', source)
self.assertIn("max_containers=1", source)
self.assertIn("min_containers=0", source)
self.assertIn("timeout=2 * 3600", source)
self.assertIn("retries=0", source)
self.assertIn("run_cloud_job.spawn", source)
```

- [ ] **Step 2: Run tests and confirm the app is absent**

Run:

```bash
python3 -m unittest worker.tests.test_modal_app_contract worker.tests.test_modal_runtime -v
```

Expected: FAIL because the Modal modules do not exist.

- [ ] **Step 3: Define the immutable Modal image**

Do not create the remote model volume or deploy this image unless Task 1
recorded permission for Modal storage/execution and
`license_gate_passed=true`.

Use the supported Modal APIs:

```python
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install_from_requirements("worker/release/requirements-pipeline-modal.txt")
    .add_local_file(
        "worker/release/requirements-table-modal.txt",
        "/root/requirements-table-modal.txt",
        copy=True,
    )
    .run_commands(
        "python -m venv /opt/table-venv",
        "/opt/table-venv/bin/pip install -r /root/requirements-table-modal.txt",
    )
    .add_local_dir("worker", "/opt/ponglens/worker", copy=True)
)
```

These are bundle-relative paths by design. Production promotion runs
`modal deploy` with the sealed `dist/<release_id>` bundle as its working
directory; a contract test fails if deployment runs from the mutable checkout.

Add `worker/release/requirements-table-modal.txt` to the image before the
`run_commands` layer so `/root/requirements-table-modal.txt` exists. Set
`PONGLENS_TABLE_KEYPOINT_PY=/opt/table-venv/bin/python` in the runtime paths.

Mount `modal.Volume.from_name("ponglens-models", create_if_missing=False)` at
`/models` read-only in application behavior and set the runtime model root to
`/models/<release_id>`; reject an unversioned checkpoint path. Verify every
source/checkpoint hash against the release before heartbeat or claim. Customer
media uses only the function's 20 GiB ephemeral disk and is removed in
`finally`.

- [ ] **Step 4: Implement the scheduled dispatcher**

```python
@app.function(
    image=image,
    secrets=[runtime_secret],
    schedule=modal.Period(minutes=1),
    timeout=60,
    min_containers=0,
    max_containers=1,
)
def dispatch_overflow():
    recover_expired_job_attempts()
    refresh_job_estimates()
    claim = claim_cloud_candidate()
    if claim is not None:
        call = run_cloud_job.spawn(claim)
        record_provider_invocation(claim, call.object_id)
```

The dispatcher emits one structured refusal reason when it does not dispatch;
it does not download video or require a GPU.

- [ ] **Step 5: Implement the one-job T4 function**

```python
@app.function(
    image=image,
    secrets=[runtime_secret],
    volumes={"/models": model_volume},
    gpu="T4",
    cpu=2.0,
    memory=8192,
    ephemeral_disk=20 * 1024,
    timeout=2 * 3600,
    retries=0,
    min_containers=0,
    max_containers=1,
    scaledown_window=60,
)
def run_cloud_job(claim_payload: dict):
    claim = JobClaim.from_rpc(claim_payload)
    assert_lease_owned(claim)
    execute_claimed_job(claim, platform="modal")
```

The ownership check runs before model loading or video download. If Modal
reschedules an invocation after a container crash, an expired or recovered
claim exits immediately without GPU-heavy setup or a second publication path.

On `UserFacingError`, preserve the Mac's deterministic terminal result. On
capacity, startup, timeout, network, or unknown operational failure, release
the job to the Mac and send a fresh `pgmq` message. Always reconcile metered
cost and delete ephemeral files.

- [ ] **Step 6: Prove cloud eligibility cannot widen accidentally**

Tests pass each job kind, storage scheme, options combination, release state,
and budget state through the dispatcher. Only R2 `deadspace_cut` jobs with
supported options may reach `.spawn()`. Explicitly assert that YouTube and all
auxiliary kinds remain local.

- [ ] **Step 7: Run local tests and a Modal container smoke test with no customer data**

Run:

```bash
python3 -m unittest worker.tests.test_modal_app_contract worker.tests.test_modal_runtime worker.tests.test_modal_policy -v
modal run --env=dev worker/modal_app.py::release_health
```

Expected: unit tests PASS; the remote health function returns matching release
ID, FFmpeg version, CUDA availability, T4 name, and all model checksums.

- [ ] **Step 8: Commit the Modal application**

```bash
git add worker/modal_app.py worker/modal_runtime.py worker/tests/test_modal_app_contract.py worker/tests/test_modal_runtime.py worker/release/requirements-pipeline-modal.txt worker/release/requirements-table-modal.txt
git commit -m "Add the cost-limited Modal overflow worker"
```

---

### Task 7: Build releases, install the Mac artifact, and enforce parity

**Files:**
- Create: `worker/release/build_release.py`
- Create: `worker/release/install_mac.py`
- Create: `worker/release/promote.py`
- Create: `worker/parity.py`
- Create: `worker/release/parity-fixtures.json`
- Create: `worker/tests/test_build_release.py`
- Create: `worker/tests/test_install_mac.py`
- Create: `worker/tests/test_parity.py`
- Modify: `worker/com.adil.ponglens-worker.plist`
- Modify: `worker/README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- `build_release(repo: Path, output: Path) -> BuiltRelease`
- `install_mac(bundle: Path, root: Path) -> Path`
- `compare_results(mac: Path, modal: Path, tolerances: Tolerances) -> ParityReport`
- `promote_release(release_id: str, prior_cloud_mode: str) -> None`
- Mac install root: `/Users/adil/Library/Application Support/PongLensWorker/releases/<release_id>`
- Mac active link: `/Users/adil/Library/Application Support/PongLensWorker/current`

- [ ] **Step 1: Write failing build, install, and parity tests**

Require dirty-source refusal, atomic symlink replacement, and semantic rather
than byte comparison:

```python
def test_build_refuses_dirty_worker_source(self):
    with temporary_git_repo() as tmp_repo:
        (tmp_repo / "worker/worker.py").write_text("changed")
        with self.assertRaisesRegex(RuntimeError, "clean committed source"):
            build_release(tmp_repo, tmp_repo / "dist")

def test_parity_accepts_encoding_difference_with_same_spans(self):
    report = compare_results(MAC_RESULT, MODAL_RESULT, DEFAULT_TOLERANCES)
    self.assertTrue(report.passed)
    self.assertFalse(report.video_sha256_equal)
```

Define `temporary_git_repo()` in `test_build_release.py`; it creates a minimal
repository, commits the fixture worker tree, yields it, and removes it on exit.

- [ ] **Step 2: Run tests and confirm missing tooling fails**

Run:

```bash
python3 -m unittest worker.tests.test_build_release worker.tests.test_install_mac worker.tests.test_parity -v
```

Expected: FAIL because release tooling is absent.

- [ ] **Step 3: Build a sealed source bundle from Git, not the live directory**

`build_release.py` verifies the repository is clean, uses `git archive HEAD` to
create the source tree, copies only checksum-matching private model artifacts,
records both requirements digests and FFmpeg compatibility, writes canonical
`pipeline-release.json`, and names the output directory with its release ID.
It also writes that one ID plus a newline to `dist/current-release-id`. It must
fail when any declared source/model/lock hash differs.

- [ ] **Step 4: Install and activate a versioned Mac release**

`install_mac.py` creates the pipeline and table-model virtual environments in
the release directory, installs only pinned requirements, runs health and
short fixture checks, then atomically replaces `current` with `os.replace()`.
Keep at least the current and previous complete release. Change the launchd
wrapper/plist instructions to execute `current/worker/worker.py`, never the
Desktop checkout.

- [ ] **Step 5: Define parity fixtures and tolerances**

Use three private R2 fixture references in `parity-fixtures.json`:

```json
{
  "schema_version": 1,
  "fixtures": [
    {"name": "short-30fps", "source_env": "PONGLENS_PARITY_SHORT_R2_URI", "profile": "short", "points": false, "placement": false},
    {"name": "points-placement", "source_env": "PONGLENS_PARITY_POINTS_R2_URI", "profile": "normal", "points": true, "placement": true},
    {"name": "upper-bound-45m-60fps", "source_env": "PONGLENS_PARITY_UPPER_BOUND_R2_URI", "profile": "release-only", "points": true, "placement": true}
  ],
  "tolerances": {
    "point_count_delta": 0,
    "boundary_seconds": 0.10,
    "cut_duration_seconds": 0.25,
    "placement_coordinate_meters": 0.08
  }
}
```

The first implementation must measure current Mac repeat-run variance. If any
listed tolerance is tighter than the Mac's own repeatability, widen it only in
a reviewed fixture commit that includes the evidence report.

- [ ] **Step 6: Compare every semantic output**

The comparator checks gate decisions, stage/fallback status, point count,
boundaries, cut spans/duration, calibration status, placement status and
coordinates, schema versions, and required artifacts. It records video hashes
for diagnosis but never requires equality.

- [ ] **Step 7: Implement safe promotion and rollback**

Promotion performs this order:

```text
1. Set cloud mode to disabled.
2. Register the candidate manifest in Supabase.
3. Upload the candidate model directory to `/models/<release_id>` and deploy
   the candidate Modal app from inside its sealed bundle with its release tag.
4. Install and health-check the matching Mac bundle.
5. Run short and points/placement parity fixtures.
6. Set active_release_id to the candidate.
7. Restart the Mac release and wait for matching Mac and Modal heartbeats.
8. Restore the prior cloud mode only when both are healthy and equal.
```

Rollback selects the prior sealed bundle and Modal deployment, repeats the
same disabled-cloud sequence, and never edits an artifact in place.
`promote.py` passes `cwd=bundle.path` to the deploy subprocess and refuses any
bundle whose directory name, manifest release ID, or manifest hash disagree.
Update `CLAUDE.md` and the worker README with the exact build/promote commands
and preserve the explicit rule that every worker/model change is incomplete
until the same sealed release is installed on both Mac and Modal.

- [ ] **Step 8: Run the release tool tests and two local repeatability runs**

Run:

```bash
python3 -m unittest worker.tests.test_build_release worker.tests.test_install_mac worker.tests.test_parity -v
python3 worker/parity.py compare --left /tmp/ponglens-mac-run-1 --right /tmp/ponglens-mac-run-2 --fixtures worker/release/parity-fixtures.json
```

Expected: tests PASS and the Mac-vs-Mac report passes every declared semantic
tolerance.

- [ ] **Step 9: Commit release and parity tooling**

```bash
git add worker/release/build_release.py worker/release/install_mac.py worker/release/promote.py worker/parity.py worker/release/parity-fixtures.json worker/tests/test_build_release.py worker/tests/test_install_mac.py worker/tests/test_parity.py worker/com.adil.ponglens-worker.plist worker/README.md CLAUDE.md
git commit -m "Add paired release and parity tooling"
```

---

### Task 8: Add the private worker operations dashboard

**Files:**
- Create: `src/app/admin/workers/page.tsx`
- Create: `src/app/admin/workers/WorkerControlSection.tsx`
- Create: `src/app/admin/workers/workerControlView.ts`
- Create: `src/app/admin/workers/workerControlView.test.ts`
- Create: `src/app/api/admin/workers/route.ts`
- Create: `worker/worker_alerts.py`
- Create: `worker/tests/test_worker_alerts.py`
- Modify: `worker/modal_app.py`
- Modify: `src/app/admin/adminPageView.ts`
- Modify: `src/app/admin/adminPageView.test.ts`
- Modify: `supabase/migrations/164_modal_worker_control.sql`
- Modify: `package.json`

**Interfaces:**
- `get_worker_control_dashboard()` returns releases, heartbeats, projection,
  active/recent attempts, budget usage, latest refusal reason, and eligible
  manual-canary jobs.
- `workerHealth(snapshot, now) -> "healthy" | "stale" | "mismatch" | "down"`
- `collect_worker_alerts(snapshot: WorkerSnapshot, now: datetime) -> list[WorkerAlert]`
- `deliver_pending_alerts(conn, resend: AlertSender) -> int`
- POST `/api/admin/workers` accepts `{action:"mode", mode}` or
  `{action:"canary", jobId}`.

- [ ] **Step 1: Write failing view and admin-route tests**

Require the hub route and safe status derivation:

```ts
assert.ok(ADMIN_PAGES.some((page) => page.href === "/admin/workers"));
assert.equal(workerHealth(freshMatching, now), "healthy");
assert.equal(workerHealth(staleMac, now), "stale");
assert.equal(workerHealth(releaseMismatch, now), "mismatch");
```

In `test_worker_alerts.py`, require one incident generation and one stable
alert key for each of: expired active lease, two Modal operational crashes
within five attempts, release mismatch, Mac heartbeat older than 15 minutes,
and exhausted daily or monthly application budget. Prove repeated dispatcher
ticks do not create a second outbox row, and a simulated Resend retry reuses
the same provider idempotency key.

- [ ] **Step 2: Run the worker-control tests and confirm failure**

Extend `test:worker-control` with `src/app/admin/workers/*.test.ts`, then run
`npm run test:worker-control`. Do not add the legal-copy path until its test
file is created in Task 10.

Expected: FAIL because the admin worker page and view model do not exist.

- [ ] **Step 3: Extend the owner-only dashboard RPC**

Return no secrets, signed URLs, filenames, user emails, or raw manifest paths.
Return worker ID/lane/health/release/checksum summaries, current job and hashed
attempt identity, oldest queue age, projected seconds, cloud mode/reason,
daily/monthly reserved and metered totals, cap values, and five recent
failures/recoveries.

- [ ] **Step 4: Build the workers page**

Show four calm sections: `Workers`, `Queue`, `Cloud budget`, and `Recent
attempts`. Surface release mismatch and stale Mac heartbeat in red; budget and
automatic-dispatch eligibility in cyan/amber. Do not expose controls to any
non-admin response path.

- [ ] **Step 5: Add explicit operator actions**

The route calls `requireAdmin()` before parsing input. Supported modes are
`disabled`, `manual`, and `automatic`. Manual canary selection lists only jobs
which the database already considers cloud-eligible. Require a second button
press client-side for enabling `automatic`; the server still validates that 20
successful canaries and all release/privacy/license gates are recorded.

- [ ] **Step 6: Run tests, lint, and an admin authorization smoke test**

Before the UI checks, implement `worker_alerts.py` as a database-backed
outbox. The CPU dispatcher calls it once per minute after recovery and budget
refresh; it sends only to the configured operator address and includes IDs,
release, lane, stage, threshold, and timestamps—not video names, signed URLs,
user email, or customer content. Successful sends set `sent_at`; failed sends
increment `send_attempts` and remain pending for a bounded retry.

Run:

```bash
npm run test:worker-control
python3 -m unittest worker.tests.test_worker_alerts -v
npx eslint src/app/admin/workers src/app/api/admin/workers/route.ts src/app/admin/adminPageView.ts
curl -i -X POST http://localhost:3000/api/admin/workers -H 'content-type: application/json' --data '{"action":"mode","mode":"automatic"}'
```

Expected: tests/lint PASS and an unauthenticated request returns 401 or the
project's normal login redirect, never worker state.

- [ ] **Step 7: Commit operator visibility and controls**

```bash
git add src/app/admin/workers src/app/api/admin/workers/route.ts src/app/admin/adminPageView.ts src/app/admin/adminPageView.test.ts worker/worker_alerts.py worker/tests/test_worker_alerts.py worker/modal_app.py supabase/migrations/164_modal_worker_control.sql package.json
git commit -m "Add backup worker operations controls"
```

---

### Task 9: Show users honest processing windows

**Files:**
- Create: `src/lib/processing/estimate.ts`
- Create: `src/lib/processing/estimate.test.ts`
- Modify: `src/lib/types.ts:1-35`
- Modify: `src/app/dashboard/UploadCard.tsx:398-420`
- Modify: `src/app/dashboard/UploadCard.tsx:1640-1710`
- Modify: `src/app/dashboard/HomeOverview.tsx`
- Modify: `src/app/dashboard/shared.tsx`
- Modify: `src/app/matches/MatchLibrary.tsx`

**Interfaces:**
- `processingWindow(job: Pick<Job, "status" | "eta_earliest_at" | "eta_latest_at">, now?: Date) -> string | null`
- `Job` adds execution lane and estimate fields, but the lane is not shown to users.

- [ ] **Step 1: Write failing copy and boundary tests**

Use broad, non-contractual labels:

```ts
assert.equal(processingWindow(jobIn(2, 5), NOW), "Expected later today");
assert.equal(processingWindow(jobIn(18, 30), NOW), "Expected tomorrow");
assert.equal(processingWindow(jobIn(40, 60), NOW), "Expected in 2–3 days");
assert.equal(processingWindow(doneJob, NOW), null);
```

Define `jobIn(earliestHours, latestHours)` in the test file to return a queued
job whose ISO bounds are offsets from fixed `NOW`; define `doneJob` with status
`done` and the same bounds.

Assert the function never returns minutes, an exact clock time, `same day`,
`within 6 hours`, or `20 minutes`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
node --test --experimental-strip-types src/lib/processing/estimate.test.ts
```

Expected: FAIL because `estimate.ts` does not exist.

- [ ] **Step 3: Implement broad estimate labels**

Use the server-provided earliest/latest window. If either bound is absent,
show `We'll email you when it's ready.` For present bounds, map the latest
bound to `Expected later today`, `Expected tomorrow`, `Expected in 2–3 days`,
or `Expected in a few days`; do not reveal cloud lane or imply priority.

- [ ] **Step 4: Carry estimate fields through job reads**

Extend `Job` with:

```ts
execution_lane?: "mac" | "modal" | null;
pipeline_release_id?: string | null;
estimated_work_seconds?: number | null;
eta_earliest_at?: string | null;
eta_latest_at?: string | null;
```

Update explicit Supabase selects in `UploadCard`, `HomeOverview`, and
`MatchLibrary`. Keep the existing live upload byte/rate ETA unchanged; file
size governs that phase, while the queued window begins after upload.

- [ ] **Step 5: Render the window on all active-upload surfaces**

After queueing, use:

```tsx
<p className="mt-1 text-xs text-zinc-500">
  {processingWindow(job) ?? "We'll email you when it's ready."}
</p>
```

Show the same derivation on the home active-work card and match-library card.
Continue showing progress percentage while actively processing; place the
broad window below it rather than replacing truthful progress.

- [ ] **Step 6: Run upload tests and lint changed surfaces**

Run:

```bash
npm run test:upload
node --test --experimental-strip-types src/lib/processing/estimate.test.ts
npx eslint src/lib/processing/estimate.ts src/app/dashboard/UploadCard.tsx src/app/dashboard/HomeOverview.tsx src/app/dashboard/shared.tsx src/app/matches/MatchLibrary.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit processing windows**

```bash
git add src/lib/processing/estimate.ts src/lib/processing/estimate.test.ts src/lib/types.ts src/app/dashboard/UploadCard.tsx src/app/dashboard/HomeOverview.tsx src/app/dashboard/shared.tsx src/app/matches/MatchLibrary.tsx
git commit -m "Show broad processing estimates after upload"
```

---

### Task 10: Complete privacy, provider, licensing, and operations gates

**Files:**
- Create: `src/app/legal/legalCopy.test.ts`
- Create: `docs/modal-worker-operations.md`
- Modify: `src/app/privacy/page.tsx:96-110`
- Modify: `src/app/privacy/page.tsx:230-265`
- Modify: `src/app/terms/page.tsx:60-120`
- Modify: `worker/README.md`
- Modify: `package.json`

**Interfaces:**
- `processing_control.privacy_gate_passed`, `license_gate_passed`, and
  `parity_gate_passed` must all be true before mode can become `manual` or
  `automatic`.
- Operations use Modal workspace ID `ac-YIjqZNnFVeSZR29PIdlELS`, app
  `ponglens-video-overflow`, environment `main`, secret
  `ponglens-worker-runtime`, and volume `ponglens-models`.

- [ ] **Step 1: Write the failing legal-copy contract test**

Require the privacy page to name Modal and temporary overflow processing, the
provider list to describe its role, and the terms to remove the under-30-minute
claim:

```ts
assert.match(privacy, /Modal-managed cloud infrastructure/);
assert.match(privacy, /removed from the temporary cloud worker/);
assert.match(privacy, /<strong>Modal<\/strong>/);
assert.doesNotMatch(terms, /Typical processing takes under 30 minutes/);
assert.match(terms, /video length, frame rate, options selected/);
```

- [ ] **Step 2: Run the legal test and confirm current copy fails**

Append `src/app/legal/legalCopy.test.ts` to `test:worker-control`, then run
`npm run test:worker-control`.

Expected: FAIL on the current workstation-only privacy statement and timing
claim.

- [ ] **Step 3: Update the privacy explanation and provider list**

Use this substance in the existing natural style:

```text
Video processing normally runs on the operator's private workstation. When
that workstation has more work than it can handle or is unavailable, the same
processing may run temporarily on Modal-managed cloud infrastructure. The
video is downloaded from private Cloudflare R2 storage, processed, returned to
private storage, and removed from the temporary cloud worker when the job ends.
```

Add Modal to service providers as temporary overflow video compute. Keep the
existing OpenAI frame disclosure and all other provider descriptions intact.

- [ ] **Step 4: Replace the optimistic terms estimate**

Replace the under-30-minute sentence with:

```text
Processing time depends on the video's length and frame rate, the options you
selected, and how many matches are ahead of it. Any estimate shown in PongLens
is a guide, not a guarantee. We email you when the match is ready.
```

State that processing may occur on the operator workstation or a contracted
cloud compute provider named in the Privacy Policy.

- [ ] **Step 5: Confirm the recorded table-keypoint gate before deployment**

Re-read the source/checkpoint decision recorded in Task 1 and attach its
evidence reference through `set_worker_rollout_gate`. If the checkpoint still
has no permission covering storage/execution by a cloud service provider,
leave `license_gate_passed=false`; do not upload that model to Modal and do not
enable cloud processing. GPL source alone is not treated as a reason to omit
the model or publish a reduced pipeline.

- [ ] **Step 6: Write the complete operator runbook**

Document exact commands and expected checks:

```bash
python3 -m pip install modal
modal setup
modal config show
modal environment list --json
modal volume create ponglens-models --env main
PIPELINE_RELEASE_ID="$(sed -n '1p' dist/current-release-id)"
modal volume put --env main ponglens-models \
  "dist/$PIPELINE_RELEASE_ID/models" "/$PIPELINE_RELEASE_ID/"
modal secret create ponglens-worker-runtime --env main \
  DATABASE_URL="$(security find-generic-password -a openclaw -s ponglens-worker-db-url -w)" \
  R2_ACCOUNT_ID="$(security find-generic-password -a openclaw -s ponglens-r2-account -w)" \
  R2_ACCESS_KEY_ID="$(security find-generic-password -a openclaw -s ponglens-modal-r2-key-id -w)" \
  R2_SECRET_ACCESS_KEY="$(security find-generic-password -a openclaw -s ponglens-modal-r2-secret -w)" \
  OPENAI_API_KEY="$(security find-generic-password -a openclaw -s openai-api-key -w)" \
  PONGLENS_RESEND_KEY="$(security find-generic-password -a openclaw -s ponglens-resend-key -w)"
(cd "dist/$PIPELINE_RELEASE_ID" && modal deploy --env main \
  --name ponglens-video-overflow --tag "$PIPELINE_RELEASE_ID" worker/modal_app.py)
modal app logs --env main ponglens-video-overflow
```

The runbook must instruct the operator to assign a strong password to the
otherwise passwordless `ponglens_worker` role through an interactive `psql`
`\password ponglens_worker` session, save its pooler URL as Keychain service
`ponglens-worker-db-url`, obtain values from Keychain without printing them,
create R2 credentials scoped to `ponglens-raw` read and `ponglens-media`
read/write/delete, verify the active
Modal profile/workspace before writes, run health/parity canaries, disable
cloud, promote, roll back, inspect costs, and respond to an expired lease.
Never paste secrets into the repository, task transcript, or shell history.

For the first release, do not pin a Modal region: record that global scheduling
was chosen to avoid a regional price multiplier. Document the data-residency
implication in the provider review. If policy later requires a fixed region,
disable cloud first and review the new region, price, DPA impact, and release
manifest before redeploying.

- [ ] **Step 7: Verify provider account limits manually**

On Modal's Usage & billing page, verify gross workspace usage limit is no more
than $30 and net spend limit is $0 or $1. Capture only the non-secret numeric
settings in the rollout record. The application remains capped at $20 even if
Modal later raises the account maximum. The runbook must also say that the
provider spend limit can stop compute while persistent Volume storage may keep
accruing: inspect that line item monthly and retain only the active and one
rollback model release after proving neither is referenced by a deployment.

- [ ] **Step 8: Run legal tests and documentation checks**

Run:

```bash
npm run test:worker-control
rg -n "Typical processing takes under 30 minutes|operator-controlled hardware: a private workstation" src/app/privacy/page.tsx src/app/terms/page.tsx
rg -n "Modal|rollback|disable|lease|\$20|\$1.50|pipeline_release_id" docs/modal-worker-operations.md
```

Expected: tests PASS; the first `rg` has no matches and the runbook contains
every operational control.

- [ ] **Step 9: Commit disclosures and operations documentation**

```bash
git add src/app/legal/legalCopy.test.ts src/app/privacy/page.tsx src/app/terms/page.tsx docs/modal-worker-operations.md worker/README.md package.json
git commit -m "Document cloud processing and rollout gates"
```

---

### Task 11: Verify the complete system and graduate from manual to automatic overflow

**Files:**
- Create: `worker/tests/test_overflow_end_to_end.py`
- Create: `docs/rollouts/modal-overflow-canaries.md`
- Modify: `worker/release/promote.py`
- Modify: `docs/modal-worker-operations.md`

**Interfaces:**
- `test_overflow_end_to_end.py` runs against an isolated Supabase database and
  fake R2/Modal adapters; no production customer data is used.
- The rollout record identifies canaries by hashed attempt ID, release ID,
  profile, parity result, elapsed time, estimated cost, recovery result, and
  operator decision.

- [ ] **Step 1: Write the failing end-to-end scenarios**

Cover this matrix:

```python
SCENARIOS = [
    "mac_claim_wins",
    "modal_claim_wins",
    "simultaneous_claim_has_one_owner",
    "cloud_disabled_leaves_job_for_mac",
    "release_mismatch_blocks_cloud",
    "daily_budget_blocks_second_large_reservation",
    "cloud_death_requeues_for_mac",
    "expired_cloud_attempt_cannot_publish",
    "deterministic_refusal_matches_on_both_lanes",
    "successful_cloud_attempt_publishes_once",
]
```

- [ ] **Step 2: Run the suite and confirm unmet integration paths fail**

Run:

```bash
python3 -m unittest worker.tests.test_overflow_end_to_end -v
```

Expected: FAIL until all adapters and lifecycle paths are wired.

- [ ] **Step 3: Complete adapter wiring and pass the isolated suite**

Wire only through the public interfaces established above. Do not add a test
backdoor around claims, leases, budget reservation, release verification, or
attempt-scoped paths.

Run:

```bash
python3 -m unittest worker.tests.test_overflow_end_to_end -v
```

Expected: all scenarios PASS.

- [ ] **Step 4: Run the full local verification gate**

Run:

```bash
supabase db reset --local
npm run test:worker-control
npm run test:upload
npm run test:costs
python3 -m unittest worker.tests.test_runtime_config worker.tests.test_pipeline_release worker.tests.test_blurball_infer worker.tests.test_job_control worker.tests.test_job_control_db worker.tests.test_worker_claim_contract worker.tests.test_output_publish worker.tests.test_attempt_publication worker.tests.test_cost_meter worker.tests.test_processing_estimate worker.tests.test_modal_policy worker.tests.test_modal_app_contract worker.tests.test_modal_runtime worker.tests.test_build_release worker.tests.test_install_mac worker.tests.test_parity worker.tests.test_worker_alerts worker.tests.test_overflow_end_to_end -v
npm run build
```

Expected: database reset, every focused test, and production build PASS.

- [ ] **Step 5: Deploy with cloud mode disabled and run private parity canaries**

Build one clean release, deploy Modal, install the matching Mac bundle, and
keep mode `disabled`. Run `short-30fps` and `points-placement` in both lanes,
then the full 45-minute 60 FPS fixture. Require matching release/checksum
heartbeats, semantic parity, no duplicate rows/notifications, runtime under
two hours, ephemeral disk under 20 GiB, and estimated cost at or below $1.50.

- [ ] **Step 6: Exercise recovery against the real services**

With an operator-owned fixture, terminate the Modal container once during
BlurBall and once after output upload. Verify the lease expires, the job
returns to the Mac queue, the Mac completes it once, and the expired attempt
cannot publish. Record the attempt hashes and result in the rollout document.

- [ ] **Step 7: Enable manual mode and record 20 customer canaries**

Set mode `manual`. Select only eligible queued uploads from the admin page, one
at a time. For every run record release, source profile, parity/contract result,
elapsed time, cost estimate, peak disk, and any recovery. Stop and return to
`disabled` on one duplicate claim/publication, one release mismatch, a privacy
or licence gate regression, cost above $1.50, or two operational failures in
five attempts.

- [ ] **Step 8: Review measured coefficients and retain hard controls**

After 20 successful canaries, replace initial timing coefficients only with
the active release's measured medians plus 25%. Do not change concurrency,
two-hour timeout, $1.50 reservation, $3/day, $20/month, 12-hour backlog, or
outage thresholds in this rollout.

- [ ] **Step 9: Enable automatic mode and verify the first real trigger**

The server action may set `automatic` only if both heartbeats match, every gate
is true, 20 successful canaries exist, no active cloud attempt exists, and
current budget is below cap. Observe the first eligible trigger through claim,
processing, publication, notification, and cost reconciliation. If no natural
12-hour backlog occurs, use the admin-only canary path; do not lower the
production threshold to manufacture one.

- [ ] **Step 10: Commit the acceptance suite and completed rollout record**

```bash
git add worker/tests/test_overflow_end_to_end.py worker/release/promote.py docs/modal-worker-operations.md docs/rollouts/modal-overflow-canaries.md
git commit -m "Verify Modal overflow rollout"
```

---

## External references fixed for implementation review

- [Modal Functions](https://modal.com/docs/guide/functions)
- [Modal scheduled functions](https://modal.com/docs/guide/cron)
- [Modal GPU configuration](https://modal.com/docs/guide/gpu)
- [Modal pricing](https://modal.com/pricing)
- [Modal budgets and spend limits](https://modal.com/docs/guide/budgets)
- [Modal Secrets](https://modal.com/docs/guide/secrets)
- [Modal environments](https://modal.com/docs/guide/environments)
- [Modal deploy CLI](https://modal.com/docs/cli/latest/deploy)
- [Modal Volume CLI](https://modal.com/docs/cli/latest/volume)
- [Modal retry behavior](https://modal.com/docs/guide/retries)
- [Modal region selection and pricing](https://modal.com/docs/guide/region-selection)
- [Modal data residency](https://modal.com/docs/guide/data-residency)
- [Modal Data Processing Addendum](https://modal.com/legal/dpa)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
