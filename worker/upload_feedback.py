"""Bounded processing measurements; reporting must never interrupt a match.

READY and release are separate events: post-ready enrichment still occupies
the queue. No estimated completion time is inferred from these events until
a separate chronological validation supports one.
"""
from datetime import datetime, timezone
import logging
import math
import re

log = logging.getLogger(__name__)
EVENTS = frozenset({"claimed", "profile", "stage", "progress", "ready", "released", "failed"})
IDENTIFIER = re.compile(r"^[A-Za-z0-9_:-]+$")


def _number(value, low, high, integer=False):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and low <= value <= high
            and (not integer or int(value) == value))


def _details(values):
    result = {}
    for key, value in values.items():
        if key in ("stage", "reason_code", "route"):
            limit = 120 if key == "route" else 60
            if isinstance(value, str) and IDENTIFIER.fullmatch(value):
                result[key] = value[:limit]
        elif key == "progress" and _number(value, 0, 100, True):
            result[key] = value
        elif key in ("duration_s", "fps") and _number(value, 0.000001, 86400):
            result[key] = value
        elif key in ("width", "height") and _number(value, 1, 32768, True):
            result[key] = value
        elif key == "trim_start_s" and _number(value, 0, 86400):
            result[key] = value
    return result


class ProcessingTelemetry:
    def __init__(self, job_id, attempt, lane, release_id, send, clock=None):
        self.job_id, self.attempt = str(job_id), int(attempt)
        self.lane, self.release_id = lane, release_id
        self.send = send
        self.clock = clock or (lambda: datetime.now(timezone.utc).isoformat())

    def emit(self, event, **details):
        if event not in EVENTS:
            return
        try:
            self.send({
                "attempt_key": f"{self.job_id}:{self.attempt}",
                "job_id": self.job_id, "attempt": self.attempt,
                "lane": self.lane, "release_id": self.release_id,
                "event": event, "recorded_at": self.clock(),
                "details": _details(details),
            })
        except Exception:
            # Never log the sender's exception: it may contain connection
            # strings or a private source location.
            log.warning("Processing timing measurement unavailable")

    def profile(self, duration_s, fps, width, height, route, trim_start_s=0):
        values = dict(duration_s=duration_s, fps=fps, width=width,
                      height=height, route=route, trim_start_s=trim_start_s)
        if (not isinstance(route, str) or not 1 <= len(route) <= 120
                or _details(values) != values):
            return
        self.emit("profile", **values)
