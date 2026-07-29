"""Anonymous, best-effort platform cost metering for the PongLens worker."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterable


ALLOWED_UNITS = {
    "input_token",
    "cached_input_token",
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


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


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
            with self.connection.cursor() as cursor:
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
        }
        candidates = [
            {
                **base,
                "quantity": total_input - cached_input,
                "unit": "input_token",
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
