"""Best-effort platform cost metering for the PongLens worker.

Events may name the account whose work caused them, so the admin cost page
can report per-player cost as a fact rather than dividing the total by
activity counts. Metering still never changes a job's outcome: a missing
or malformed subject costs the attribution, never the charge.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import time
import uuid
from contextlib import contextmanager
from typing import Any, Callable, Iterable


ALLOWED_UNITS = {
    "input_token",
    "cached_input_token",
    "cache_write_token",
    "output_token",
    "audio_second",
    "gb_month",
    "storage_byte_snapshot",
    "class_a_operation",
    "class_b_operation",
    "email_recipient",
    "compute_second",
    "request",
    "monthly_subscription",
}
ALLOWED_SOURCES = {"internal", "provider", "backfill", "assumed"}
ALLOWED_METADATA = {
    "confidence",
    "storage_class",
    "stage",
    "request_count",
    "cached_tokens",
    "status",
    "billing_mode",
}


def stable_key(*parts: object) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(str(part).encode("utf-8", errors="replace"))
        digest.update(b"\0")
    return digest.hexdigest()


def _positive(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if math.isfinite(parsed) and parsed > 0 else 0.0


_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _subject(value: Any) -> str | None:
    text = str(value or "").strip()
    return text.lower() if _UUID.match(text) else None


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


@contextmanager
def sql_savepoint(conn):
    """Keep a fail-soft SQL operation from aborting its caller's transaction."""
    if getattr(conn, "autocommit", True):
        yield
        return
    name = f"worker_{uuid.uuid4().hex}"
    with conn.cursor() as cur:
        cur.execute(f"savepoint {name}")
    try:
        yield
        with conn.cursor() as cur:
            cur.execute(f"release savepoint {name}")
    except Exception:
        with conn.cursor() as cur:
            cur.execute(f"rollback to savepoint {name}")
            cur.execute(f"release savepoint {name}")
        raise


# OpenAI never reports cache WRITES in a usage payload — it reports how many
# input tokens were cache hits and nothing about what the miss cost. On the
# GPT-5.6 family a miss above the caching threshold is billed at 1.25x input
# on its own "cache writes" line, so pricing every miss as plain input
# understates the bill by a quarter on exactly the prompts big enough to
# matter. Inferring it is the only option, and the inference is safe here:
# against the organization billing API for 2026-08-01..16, gpt-5.6-sol billed
# $4.655 of cache writes against $0.008 of plain input and gpt-5.6-luna
# $0.122 against $0.007. Essentially every miss on a real prompt is a write.
#
# The threshold is OpenAI's documented caching floor. Below it nothing is
# cached, so a miss really is plain input. Getting this wrong overstates a
# small prompt by 25% of its input line, which is visible in the dashboard;
# the alternative understated the largest prompts silently.
CACHE_WRITE_SKU_PREFIXES = ("gpt-5.6-",)
CACHE_WRITE_MIN_PROMPT_TOKENS = 1024


def _charges_for_cache_writes(model: str, total_input: float) -> bool:
    sku = str(model or "").strip().lower()
    return (
        total_input >= CACHE_WRITE_MIN_PROMPT_TOKENS
        and sku.startswith(CACHE_WRITE_SKU_PREFIXES)
    )


class CostMeter:
    def __init__(
        self,
        connection,
        *,
        logger=None,
        clock: Callable[[], float] = time.perf_counter,
    ):
        self.connection = connection
        self.logger = logger or logging.getLogger("ponglens-cost-meter")
        self.clock = clock

    def _normalize(self, raw: dict) -> dict | None:
        quantity = _positive(raw.get("quantity"))
        provider = str(raw.get("provider") or "").strip()[:80]
        service = str(raw.get("service") or "").strip()[:100]
        operation = str(raw.get("operation") or "").strip()[:120]
        sku = str(raw.get("sku") or "").strip()[:120]
        unit = str(raw.get("unit") or "")
        source = str(raw.get("source") or "internal")
        key = str(raw.get("idempotency_key") or "").strip()[:240]
        if (
            not self.connection
            or quantity <= 0
            or not provider
            or not service
            or not operation
            or not sku
            or unit not in ALLOWED_UNITS
            or source not in ALLOWED_SOURCES
            or not key
        ):
            return None
        metadata = {}
        for name, value in _dict(raw.get("metadata")).items():
            if name not in ALLOWED_METADATA:
                continue
            if isinstance(value, bool) or isinstance(value, str):
                metadata[name] = value
            elif isinstance(value, (int, float)) and math.isfinite(value):
                metadata[name] = value
        normalized = {
            "provider": provider,
            "service": service,
            "operation": operation,
            "sku": sku,
            "quantity": quantity,
            "unit": unit,
            "source": source,
            "idempotency_key": key,
            "metadata": metadata,
        }
        # A malformed subject loses the attribution, never the cost. Mirrors
        # the same rule in src/lib/costs/meter.ts and in record_cost_usage:
        # metering is best-effort, so a bad id must not cost us a real charge.
        subject = _subject(raw.get("subject_user_id"))
        if subject:
            normalized["subject_user_id"] = subject
        occurred_at = raw.get("occurred_at")
        if isinstance(occurred_at, str) and occurred_at:
            normalized["occurred_at"] = occurred_at
        return normalized

    def record(self, events: Iterable[dict]) -> None:
        normalized = [
            event
            for event in (self._normalize(raw) for raw in events)
            if event is not None
        ][:100]
        if not normalized:
            return
        try:
            with sql_savepoint(self.connection), self.connection.cursor() as cursor:
                cursor.execute(
                    "select public.record_cost_usage(%s::jsonb)",
                    (json.dumps(normalized, separators=(",", ":")),),
                )
        except Exception as error:  # metering never changes job status
            self.logger.warning("cost meter write failed (non-fatal): %s", error)

    def openai_usage_events(
        self,
        response: dict,
        *,
        model: str,
        operation: str,
        idempotency_key: str,
        subject_user_id: str | None = None,
    ) -> list[dict]:
        usage = _dict(response.get("usage"))
        details = _dict(
            usage.get("prompt_tokens_details")
            or usage.get("input_tokens_details")
        )
        total_input = _positive(
            usage.get("prompt_tokens", usage.get("input_tokens"))
        )
        cached_input = min(total_input, _positive(details.get("cached_tokens")))
        output = _positive(
            usage.get("completion_tokens", usage.get("output_tokens"))
        )
        base = {
            "provider": "OpenAI",
            "service": "AI",
            "operation": operation,
            "sku": model,
            "subject_user_id": subject_user_id,
        }
        miss_unit = (
            "cache_write_token"
            if _charges_for_cache_writes(model, total_input)
            else "input_token"
        )
        candidates = [
            {
                **base,
                "quantity": total_input - cached_input,
                "unit": miss_unit,
                "idempotency_key": f"{idempotency_key}:input",
            },
            {
                **base,
                "quantity": cached_input,
                "unit": "cached_input_token",
                "idempotency_key": f"{idempotency_key}:cached-input",
            },
            {
                **base,
                "quantity": output,
                "unit": "output_token",
                "idempotency_key": f"{idempotency_key}:output",
            },
        ]
        return [event for event in candidates if event["quantity"] > 0]

    def r2_operation_event(
        self,
        operation: str,
        provider_request_key: str,
        *,
        assumed: bool = False,
    ) -> dict | None:
        class_a = {
            "upload_file",
            "put_object",
            "create_multipart_upload",
            "upload_part",
            "complete_multipart_upload",
        }
        class_b = {
            "download_file",
            "get_object",
            "head_object",
            "list_objects",
            "list_objects_v2",
            "list_parts",
        }
        if operation in class_a:
            unit = "class_a_operation"
        elif operation in class_b:
            unit = "class_b_operation"
        else:
            return None
        return {
            "provider": "Cloudflare",
            "service": "R2",
            "operation": operation,
            "sku": "r2-standard",
            "quantity": 1,
            "unit": unit,
            "source": "assumed" if assumed else "internal",
            "idempotency_key": (
                f"r2:{stable_key(provider_request_key, operation)}"
            ),
            "metadata": {"storage_class": "standard"},
        }

    def email_event(self, message_id: str, *, recipients: int) -> dict:
        return {
            "provider": "Resend",
            "service": "Email",
            "operation": "send_email",
            "sku": "resend-email",
            "quantity": recipients,
            "unit": "email_recipient",
            "idempotency_key": f"resend:{stable_key(message_id)}",
        }

    @contextmanager
    def timed_stage(self, stage: str, attempt_key: str):
        started = self.clock()
        try:
            yield
        finally:
            elapsed = max(0.0, self.clock() - started)
            self.record([
                {
                    "provider": "Local",
                    "service": "Compute",
                    "operation": stage,
                    "sku": "mac-studio",
                    "quantity": elapsed,
                    "unit": "compute_second",
                    "idempotency_key": (
                        f"compute:{stable_key(attempt_key, stage)}"
                    ),
                    "metadata": {"stage": stage},
                }
            ])
