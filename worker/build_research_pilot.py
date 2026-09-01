"""Freeze and seed the authenticated 30-assignment fused-labeling pilot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

import boto3
import psycopg2
import requests


ROOT = Path(__file__).resolve().parents[1]
BATCH_SLUG = "fused-labeling-pilot-v1"
BATCH_TITLE = "Audio + BlurBall fused labeling pilot"
MEDIA_BUCKET = "ponglens-media"
DESTINATION_PREFIX = "research/fused-labeling/v1/sources"
ADMIN_EMAIL = "adilharis2001@gmail.com"
V2022_MATCH_ID = "04112a24-59cd-4812-a0f1-03dac7acc22a"
EXCLUDED_MATCH_IDS = {V2022_MATCH_ID}

# Deliberately spans noisy tournaments, the earlier Chris league study, quiet
# same-day Chris practice, long/short rallies, and several ending hypotheses.
# These are immutable source identifiers, not display-order choices.
PILOT_POINT_PLAN = [
    {"match_id": "1466e3c3-4578-4c72-b755-bead82ffb289", "point_idx": 20, "stratum": "faye_noisy"},
    {"match_id": "1466e3c3-4578-4c72-b755-bead82ffb289", "point_idx": 37, "stratum": "faye_net"},
    {"match_id": "1466e3c3-4578-4c72-b755-bead82ffb289", "point_idx": 45, "stratum": "faye_long_rally"},
    {"match_id": "98be5eb5-a764-427c-85ac-024d0c8bde89", "point_idx": 30, "stratum": "patricia_noisy"},
    {"match_id": "98be5eb5-a764-427c-85ac-024d0c8bde89", "point_idx": 50, "stratum": "patricia_long_rally"},
    {"match_id": "98be5eb5-a764-427c-85ac-024d0c8bde89", "point_idx": 70, "stratum": "patricia_short"},
    {"match_id": "8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "point_idx": 2, "stratum": "chris_clean_winner"},
    {"match_id": "8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "point_idx": 12, "stratum": "chris_net_cord"},
    {"match_id": "8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "point_idx": 13, "stratum": "chris_net_error"},
    {"match_id": "8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "point_idx": 18, "stratum": "chris_long_error"},
    {"match_id": "45b372ce-cfb8-49a3-82f8-5c606409a9ae", "point_idx": 1, "stratum": "chris_quiet_long"},
    {"match_id": "45b372ce-cfb8-49a3-82f8-5c606409a9ae", "point_idx": 5, "stratum": "chris_quiet_double_bounce"},
    {"match_id": "ebbb8f94-def1-493d-85df-f37c28afe0a7", "point_idx": 2, "stratum": "chris_practice_net"},
    {"match_id": "ebbb8f94-def1-493d-85df-f37c28afe0a7", "point_idx": 30, "stratum": "chris_practice_double_bounce"},
    {"match_id": "e009b852-4fca-4dc5-949c-454d9c2d5b0f", "point_idx": 2, "stratum": "patrick_clean"},
    {"match_id": "e009b852-4fca-4dc5-949c-454d9c2d5b0f", "point_idx": 25, "stratum": "patrick_net"},
    {"match_id": "cff81f99-fa60-4ae6-b27d-693fcf3b0b2b", "point_idx": 15, "stratum": "nathan_short"},
    {"match_id": "cff81f99-fa60-4ae6-b27d-693fcf3b0b2b", "point_idx": 60, "stratum": "nathan_rally"},
    {"match_id": "522cd6f5-9c76-4154-818b-1a26d9a3521f", "point_idx": 40, "stratum": "julian_double_bounce"},
    {"match_id": "9bd87661-f4d9-42f3-9767-2cfc486474d8", "point_idx": 1, "stratum": "vaibhav_current_wide"},
]


def keychain(service: str) -> str:
    value = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            "openclaw",
            "-s",
            service,
            "-w",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if not value:
        raise RuntimeError(f"Missing Keychain secret {service}")
    return value


def parse_r2_uri(value: str) -> tuple[str, str]:
    if not value.startswith("r2://"):
        raise ValueError(f"Not an R2 URI: {value}")
    bucket, separator, key = value[5:].partition("/")
    if not separator or not bucket or not key:
        raise ValueError(f"Malformed R2 URI: {value}")
    return bucket, key


def probe_video(path: Path) -> dict:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    video = next(
        stream
        for stream in payload["streams"]
        if stream.get("codec_type") == "video"
    )
    return {
        "duration_s": round(float(payload["format"]["duration"]), 4),
        "width": int(video["width"]),
        "height": int(video["height"]),
    }


def relative_visual_candidates(
    point: dict,
    duration_s: float,
    width: int,
    height: int,
    pre_s: float = 1.0,
) -> list[dict]:
    placement = point.get("placement") or {}
    if placement.get("v") != 3:
        return []
    # Placement reconstruction stores source-video timestamps. Point clips
    # start at source t0 minus the effective pre-roll; cut_t0 is a different
    # coordinate (the concatenated cut video) and must never be used here.
    effective_pre = min(pre_s, 0.3) if point.get("tight_start") else pre_s
    clip_start = max(0.0, float(point.get("t0") or 0) - effective_pre)
    output = []
    for candidate in placement.get("candidates") or []:
        relative = round(float(candidate.get("t") or 0) - float(clip_start), 4)
        if relative < 0 or relative > duration_s:
            continue
        x = candidate.get("x")
        y = candidate.get("y")
        output.append(
            {
                "id": f"visual-{candidate.get('id')}",
                "source_id": candidate.get("id"),
                "time_s": relative,
                "kind": candidate.get("kind"),
                "kinds": candidate.get("kinds") or [],
                "side": candidate.get("side"),
                "u": candidate.get("u"),
                "v": candidate.get("v"),
                "x_norm": round(float(x) / width, 6) if x is not None else None,
                "y_norm": round(float(y) / height, 6) if y is not None else None,
                "confidence": candidate.get("visual_confidence"),
            }
        )
    return sorted(output, key=lambda item: (item["time_s"], item["id"]))


def fuse_candidates(
    audio: list[dict], visual: list[dict], tolerance_s: float = 0.08
) -> list[dict]:
    unused_visual = set(range(len(visual)))
    markers = []
    for candidate in sorted(audio, key=lambda item: item["time_s"]):
        nearby = [
            index
            for index in unused_visual
            if abs(float(visual[index]["time_s"]) - float(candidate["time_s"]))
            <= tolerance_s
        ]
        match = (
            min(
                nearby,
                key=lambda index: abs(
                    float(visual[index]["time_s"]) - float(candidate["time_s"])
                ),
            )
            if nearby
            else None
        )
        if match is None:
            markers.append(
                {
                    "id": f"marker-{candidate['id']}",
                    "time_s": candidate["time_s"],
                    "origin": "audio",
                    "audio_id": candidate["id"],
                    "visual_id": None,
                }
            )
            continue
        unused_visual.remove(match)
        visual_candidate = visual[match]
        markers.append(
            {
                "id": f"marker-{candidate['id']}-{visual_candidate['id']}",
                "time_s": round(
                    (
                        float(candidate["time_s"])
                        + float(visual_candidate["time_s"])
                    )
                    / 2,
                    4,
                ),
                "origin": "both",
                "audio_id": candidate["id"],
                "visual_id": visual_candidate["id"],
            }
        )
    for index in unused_visual:
        candidate = visual[index]
        markers.append(
            {
                "id": f"marker-{candidate['id']}",
                "time_s": candidate["time_s"],
                "origin": "blurball",
                "audio_id": None,
                "visual_id": candidate["id"],
            }
        )
    return sorted(markers, key=lambda item: (item["time_s"], item["id"]))


def stable_uuid(*parts: object) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, ":".join(map(str, parts))))


def fnv_score(value: str) -> int:
    score = 2166136261
    for character in value:
        score ^= ord(character)
        score = (score * 16777619) & 0xFFFFFFFF
    return score


def assignment_order(source_ids: list[str]) -> list[dict]:
    jobs = []
    for index, source_id in enumerate(source_ids):
        duplicate_group = f"duplicate-{index + 1:02d}" if index < 10 else None
        jobs.append(
            {
                "source_id": source_id,
                "duplicate_group": duplicate_group,
                "is_repeat": False,
            }
        )
        if duplicate_group:
            jobs.append(
                {
                    "source_id": source_id,
                    "duplicate_group": duplicate_group,
                    "is_repeat": True,
                }
            )
    jobs.sort(
        key=lambda item: fnv_score(
            f"pilot-v1:{item['source_id']}:{1 if item['is_repeat'] else 0}"
        )
    )
    for sequence, job in enumerate(jobs, start=1):
        job["sequence"] = sequence
    return jobs


class Production:
    def __init__(self) -> None:
        self.supabase_url = (
            os.environ.get("SUPABASE_URL") or keychain("ponglens-supabase-url")
        ).rstrip("/")
        self.service_key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or keychain("ponglens-service-role")
        )
        self.db_url = os.environ.get("DATABASE_URL") or keychain("ponglens-db-url")
        account = os.environ.get("R2_ACCOUNT_ID") or keychain("ponglens-r2-account")
        access_key = os.environ.get("R2_ACCESS_KEY_ID") or keychain(
            "ponglens-r2-key-id"
        )
        secret_key = os.environ.get("R2_SECRET_ACCESS_KEY") or keychain(
            "ponglens-r2-secret"
        )
        self.headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
        }
        self.r2 = boto3.client(
            "s3",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )

    def rest_get(self, table: str, **params) -> list[dict]:
        response = requests.get(
            f"{self.supabase_url}/rest/v1/{table}",
            headers={**self.headers, "Range": "0-4999"},
            params=params,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def upsert(self, table: str, payload: list[dict] | dict, conflict: str) -> list[dict]:
        response = requests.post(
            f"{self.supabase_url}/rest/v1/{table}",
            headers={
                **self.headers,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            params={"on_conflict": conflict},
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def apply_migration(self) -> None:
        sql = (
            ROOT / "supabase/migrations/034_research_fused_labeling.sql"
        ).read_text()
        connection = psycopg2.connect(self.db_url)
        connection.autocommit = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def analyzer_python() -> str:
    configured = os.environ.get("RESEARCH_ANALYSIS_PYTHON")
    if configured:
        return configured
    local = Path("/Users/adil/Desktop/Projects/TTVid/vendor/venv/bin/python")
    return str(local) if local.exists() else "python3"


def analyze_audio(path: Path, source_id: str | None = None) -> dict:
    command = [
        analyzer_python(),
        str(ROOT / "worker/research_audio_candidates.py"),
        str(path),
    ]
    if source_id:
        command.extend(["--source-id", source_id])
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


def canonical_hash(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def build_source(
    production: Production,
    plan: dict,
    match: dict,
    point: dict,
    batch_id: str,
    temp_dir: Path,
    pre_s: float,
) -> dict:
    source_id = stable_uuid(BATCH_SLUG, point["id"])
    destination_key = f"{DESTINATION_PREFIX}/{source_id}.mp4"
    source_bucket, source_key = parse_r2_uri(point["clip_path"])
    local_path = temp_dir / f"{source_id}.mp4"
    production.r2.download_file(source_bucket, source_key, str(local_path))
    media_bytes = local_path.read_bytes()
    media_hash = hashlib.sha256(media_bytes).hexdigest()
    video = probe_video(local_path)
    audio = analyze_audio(local_path, source_id=source_id)
    visual = relative_visual_candidates(
        point,
        video["duration_s"],
        video["width"],
        video["height"],
        pre_s=pre_s,
    )
    markers = fuse_candidates(audio["candidates"], visual)
    proposal = {
        "schema_version": 1,
        "stratum": plan["stratum"],
        "video": video,
        "audio": audio,
        "visual_candidates": visual,
        "markers": markers,
        "placement_status": (point.get("placement") or {}).get("status"),
    }
    manifest_hash = canonical_hash(proposal)

    production.r2.upload_file(
        str(local_path),
        MEDIA_BUCKET,
        destination_key,
        ExtraArgs={
            "ContentType": "video/mp4",
            "Metadata": {
                "source-sha256": media_hash,
                "manifest-sha256": manifest_hash,
                "source-point-id": point["id"],
            },
        },
    )
    head = production.r2.head_object(Bucket=MEDIA_BUCKET, Key=destination_key)
    if int(head["ContentLength"]) != len(media_bytes):
        raise RuntimeError(f"Frozen upload size mismatch for {source_id}")

    near = match.get("player_near_name")
    far = match.get("player_far_name")
    opponent = match.get("opponent_name") or "Opponent"
    if match.get("user_side") == "near":
        near = near or "Adil"
        far = far or opponent
    elif match.get("user_side") == "far":
        near = near or opponent
        far = far or "Adil"
    elif not near and not far:
        # Legacy matches predate side confirmation. The original worker's
        # explicit default was uploader near / opponent far.
        near, far = "Adil", opponent
    prefill = {
        "server": point.get("server_override") or point.get("server"),
        "winner": (
            "let" if point.get("is_let") else point.get("confirmed_winner")
        ),
        "confirmed_how": point.get("confirmed_how"),
        "suggestion": point.get("suggestion"),
        "direction": point.get("direction"),
        "serve_spin": point.get("serve_spin"),
        "serve_sidespin": point.get("serve_sidespin"),
        "serve_length": point.get("serve_length"),
    }
    return {
        "id": source_id,
        "batch_id": batch_id,
        "source_match_id": match["id"],
        "source_point_id": point["id"],
        "source_point_idx": point["idx"],
        "match_label": f"Adil–{match.get('opponent_name') or 'Opponent'}",
        "player_near_name": near,
        "player_far_name": far,
        "venue_label": match.get("venue"),
        "media_key": destination_key,
        "media_sha256": media_hash,
        "manifest_sha256": manifest_hash,
        "duration_s": video["duration_s"],
        "proposal": proposal,
        "prefill": prefill,
    }


def seed(production: Production) -> dict:
    match_ids = ",".join(item["match_id"] for item in PILOT_POINT_PLAN)
    matches = production.rest_get(
        "matches",
        select=(
            "id,job_id,opponent_name,venue,match_type,played_at,user_side,"
            "player_near_name,player_far_name,status"
        ),
        id=f"in.({match_ids})",
    )
    matches_by_id = {match["id"]: match for match in matches}
    job_ids = ",".join(match["job_id"] for match in matches if match.get("job_id"))
    jobs = production.rest_get(
        "jobs",
        select="id,options",
        id=f"in.({job_ids})",
    )
    options_by_job = {job["id"]: job.get("options") or {} for job in jobs}
    strictness_pre = {"tight": 0.5, "normal": 1.0, "loose": 1.6}
    points = production.rest_get(
        "points",
        select=(
            "id,match_id,idx,t0,t1,cut_t0,clip_path,server,server_override,"
            "is_let,placement,suggestion,confirmed_winner,confirmed_how,"
            "direction,serve_spin,serve_sidespin,serve_length,deleted,"
            "tight_start,tight_end"
        ),
        match_id=f"in.({match_ids})",
        deleted="eq.false",
    )
    points_by_key = {(point["match_id"], point["idx"]): point for point in points}
    for item in PILOT_POINT_PLAN:
        if item["match_id"] in EXCLUDED_MATCH_IDS:
            raise RuntimeError("The excluded Vaibhav 2022 match entered the plan")
        point = points_by_key.get((item["match_id"], item["point_idx"]))
        if not point or not point.get("clip_path") or point.get("t0") is None:
            raise RuntimeError(f"Pilot source is unavailable: {item}")

    batch_id = stable_uuid("research-batch", BATCH_SLUG)
    production.upsert(
        "research_batches",
        {
            "id": batch_id,
            "slug": BATCH_SLUG,
            "title": BATCH_TITLE,
            "schema_version": 1,
            "status": "active",
        },
        "slug",
    )

    admin_users = requests.get(
        f"{production.supabase_url}/auth/v1/admin/users",
        headers=production.headers,
        params={"page": 1, "per_page": 1000},
        timeout=60,
    )
    admin_users.raise_for_status()
    admin = next(
        (
            user
            for user in admin_users.json().get("users", [])
            if (user.get("email") or "").lower() == ADMIN_EMAIL
        ),
        None,
    )
    if not admin:
        raise RuntimeError(f"Admin account {ADMIN_EMAIL} not found")
    reviewer_id = admin["id"]
    production.upsert(
        "research_reviewers",
        {
            "user_id": reviewer_id,
            "role": "admin",
            "active": True,
            "added_by": reviewer_id,
        },
        "user_id",
    )

    existing = production.rest_get(
        "research_sources",
        select="id,source_point_id",
        batch_id=f"eq.{batch_id}",
    )
    existing_by_point = {row["source_point_id"]: row for row in existing}
    source_rows = []
    with tempfile.TemporaryDirectory(prefix="ponglens-research-") as directory:
        temp_dir = Path(directory)
        for number, item in enumerate(PILOT_POINT_PLAN, start=1):
            point = points_by_key[(item["match_id"], item["point_idx"])]
            if point["id"] in existing_by_point:
                print(f"[{number}/20] already frozen: {item['stratum']}")
                continue
            print(f"[{number}/20] freezing: {item['stratum']}")
            source_rows.append(
                build_source(
                    production,
                    item,
                    matches_by_id[item["match_id"]],
                    point,
                    batch_id,
                    temp_dir,
                    strictness_pre.get(
                        options_by_job.get(
                            matches_by_id[item["match_id"]].get("job_id"), {}
                        ).get("strictness", "normal"),
                        1.0,
                    ),
                )
            )
    if source_rows:
        production.upsert(
            "research_sources", source_rows, "batch_id,source_point_id"
        )

    sources = production.rest_get(
        "research_sources",
        select="id,source_point_id,prefill",
        batch_id=f"eq.{batch_id}",
        order="source_point_idx.asc",
    )
    source_by_point = {source["source_point_id"]: source for source in sources}
    ordered_source_ids = [
        source_by_point[
            points_by_key[(item["match_id"], item["point_idx"])]["id"]
        ]["id"]
        for item in PILOT_POINT_PLAN
    ]
    gold = []
    for source in sources:
        prefill = source.get("prefill") or {}
        if prefill.get("winner") or prefill.get("confirmed_how"):
            gold.append(
                {
                    "source_id": source["id"],
                    "gold_label": {
                        "winner": prefill.get("winner"),
                        "ending_type": prefill.get("confirmed_how"),
                    },
                    "provenance": "owner-confirmed Pong Lens scoring",
                    "adjudicated_by": reviewer_id,
                }
            )
    if gold:
        production.upsert("research_gold_labels", gold, "source_id")

    current_assignments = production.rest_get(
        "research_assignments",
        select="id",
        batch_id=f"eq.{batch_id}",
        reviewer_id=f"eq.{reviewer_id}",
    )
    if not current_assignments:
        assignments = []
        for job in assignment_order(ordered_source_ids):
            assignments.append(
                {
                    "id": stable_uuid(
                        BATCH_SLUG,
                        reviewer_id,
                        job["sequence"],
                        job["source_id"],
                        job["is_repeat"],
                    ),
                    "batch_id": batch_id,
                    "source_id": job["source_id"],
                    "reviewer_id": reviewer_id,
                    "sequence": job["sequence"],
                    "duplicate_group": job["duplicate_group"],
                    "is_repeat": job["is_repeat"],
                }
            )
        production.upsert(
            "research_assignments",
            assignments,
            "batch_id,reviewer_id,sequence",
        )
    elif len(current_assignments) != 30:
        raise RuntimeError(
            f"Existing pilot has {len(current_assignments)} assignments, expected 30"
        )

    return {
        "batch_id": batch_id,
        "unique_sources": len(sources),
        "assignments": 30,
        "hidden_repeats": 10,
        "matches": len({item["match_id"] for item in PILOT_POINT_PLAN}),
        "excluded_match_id": V2022_MATCH_ID,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply-migration", action="store_true")
    parser.add_argument("--seed", action="store_true")
    args = parser.parse_args()
    if not args.apply_migration and not args.seed:
        parser.error("choose --apply-migration and/or --seed")
    production = Production()
    if args.apply_migration:
        print("Applying research migration 034")
        production.apply_migration()
    if args.seed:
        print(json.dumps(seed(production), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
