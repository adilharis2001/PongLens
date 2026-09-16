"""Private, camera-relative prediction observations; never score a point."""
import hashlib
import json
import logging
import math
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger(__name__)
SCHEMA_VERSION = 1
METHOD = "net_low_bounces"
METHOD_VERSION = "net-endings-v1"
SUPPORTED_METHOD_VERSIONS = (METHOD_VERSION, "net-splits-v1")
SIDECAR = "point_winner_predictions.json"


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("expected finite number")
    return float(value)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _unavailable(points, status, reason):
    return [dict(idx=int(p["idx"]), method=METHOD, method_version=METHOD_VERSION,
                 status=status, winner_side=None, reason=reason,
                 evaluated_t0=float(p["t0"]), evaluated_t1=float(p["t1"]),
                 published_t0=float(p["t0"]), published_t1=float(p["t1"]), evidence={})
            for p in points]


def load_predictions(outdir, points):
    """Validate the complete sidecar before publication; invalid evidence cannot win.

    Published windows are rounded by the existing pipeline. Retain both those
    and the unrounded analyzed windows, so edits can be detected without treating
    normal output rounding as an edit. A partial batch is an explicit error for
    every card rather than potentially associating a winner with the wrong card.
    """
    path = Path(outdir) / SIDECAR
    if not path.exists():
        return _unavailable(points, "abstained", "method_unavailable")
    try:
        document = json.loads(path.read_text())
        if document.get("schema_version") != SCHEMA_VERSION:
            raise ValueError("unsupported schema")
        rows = document["points"]
        by_idx = {int(p["idx"]): p for p in points}
        if len(by_idx) != len(points) or not isinstance(rows, list) or len(rows) != len(points):
            raise ValueError("point coverage mismatch")
        validated = {}
        for row in rows:
            idx = row["idx"]
            if type(idx) is not int or idx not in by_idx or idx in validated:
                raise ValueError("invalid point identity")
            if row.get("method") != METHOD or row.get("method_version") not in SUPPORTED_METHOD_VERSIONS:
                raise ValueError("unsupported method")
            status, side = row["status"], row["winner_side"]
            if status not in ("predicted", "abstained", "error"):
                raise ValueError("invalid status")
            if (status == "predicted" and side not in ("near", "far")) or (status != "predicted" and side is not None):
                raise ValueError("status and winner disagree")
            reason = row["reason"]
            if not isinstance(reason, str) or not reason or len(reason) > 160:
                raise ValueError("invalid reason")
            a, b = _number(row["evaluated_t0"]), _number(row["evaluated_t1"])
            p = by_idx[idx]
            pa, pb = _number(p["t0"]), _number(p["t1"])
            if a < 0 or b <= a or abs(a - pa) > .011 or abs(b - pb) > .011:
                raise ValueError("prediction belongs to a different window")
            evidence = row["evidence"]
            if not isinstance(evidence, dict) or len(_canonical(evidence).encode()) > 32768:
                raise ValueError("invalid evidence")
            validated[idx] = dict(idx=idx, method=METHOD, method_version=row["method_version"],
                                  status=status, winner_side=side, reason=reason,
                                  evaluated_t0=a, evaluated_t1=b, published_t0=pa,
                                  published_t1=pb, evidence=evidence)
        return [validated[int(p["idx"])] for p in points]
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        log.warning("Private winner sidecar invalid; recording errors without winners", exc_info=True)
        return _unavailable(points, "error", "invalid_prediction_sidecar")


@contextmanager
def atomic_point_writes(conn):
    """Own an autocommit transaction, or isolate writes in the caller's one."""
    owns_transaction = conn.autocommit
    if owns_transaction:
        conn.autocommit = False
    else:
        with conn.cursor() as cur:
            cur.execute("savepoint private_prediction_points")
    try:
        yield
        if owns_transaction:
            conn.commit()
        else:
            with conn.cursor() as cur:
                cur.execute("release savepoint private_prediction_points")
    except Exception:
        if owns_transaction:
            conn.rollback()
        else:
            with conn.cursor() as cur:
                cur.execute("rollback to savepoint private_prediction_points")
                cur.execute("release savepoint private_prediction_points")
        raise
    finally:
        if owns_transaction:
            conn.autocommit = True


def persist_predictions(conn, inserted_points, rows, provenance):
    """Write alongside points in their transaction, without any score input.

    A retry can only reuse an identical observation. Divergent output for the
    same execution/window is an error, never a quiet overwrite of history.
    """
    if conn.autocommit:
        raise ValueError("prediction persistence requires the point transaction")
    if set(inserted_points) != {r["idx"] for r in rows} or len(rows) != len(inserted_points):
        raise ValueError("prediction point coverage mismatch")
    source = provenance["source_identity"]
    release = provenance["release_id"]
    offset = _number(provenance["source_offset_s"])
    if offset < 0 or not isinstance(source, str) or not source or not isinstance(release, str) or not release:
        raise ValueError("prediction source provenance missing")
    with conn.cursor() as cur:
        for row in rows:
            fingerprint = hashlib.sha256(_canonical(dict(
                method=row["method"], method_version=row["method_version"],
                evaluated_t0=row["evaluated_t0"], evaluated_t1=row["evaluated_t1"],
                provenance=provenance)).encode()).hexdigest()
            identity = (inserted_points[row["idx"]]["id"], row["method"], row["method_version"], fingerprint)
            cur.execute(
                "insert into public.point_winner_predictions "
                "(point_id,method,method_version,input_fingerprint,schema_version,status,winner_side,reason,"
                "evaluated_t0,evaluated_t1,published_t0,published_t1,source_identity,source_offset_s,source_job_id,release_id,evidence) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "on conflict(point_id,method,method_version,input_fingerprint) do nothing returning id",
                (*identity, SCHEMA_VERSION, row["status"], row["winner_side"], row["reason"],
                 row["evaluated_t0"], row["evaluated_t1"], row["published_t0"], row["published_t1"],
                 source, offset, provenance["job_id"], release, _canonical(row["evidence"])))
            if cur.fetchone() is None:
                cur.execute(
                    "select status,winner_side,reason,published_t0,published_t1,evidence "
                    "from public.point_winner_predictions where point_id=%s and method=%s and method_version=%s and input_fingerprint=%s",
                    identity)
                existing = cur.fetchone()
                if not existing or (existing[0], existing[1], existing[2], float(existing[3]), float(existing[4]), existing[5]) != (
                        row["status"], row["winner_side"], row["reason"], row["published_t0"], row["published_t1"], row["evidence"]):
                    raise ValueError("prediction retry differs from immutable observation")
