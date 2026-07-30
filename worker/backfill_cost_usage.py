#!/usr/bin/env python3
"""Dry-run-first aggregate backfill for PongLens platform cost usage.

This script intentionally reads only aggregate database counters and recognized
worker log lines. It never reads prompts, transcripts, filenames, object keys,
emails, or per-user records.
"""

from __future__ import annotations

import argparse
import calendar
import json
import math
import os
import re
import subprocess
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


WORKER_LOG_PATTERN = re.compile(
    r"^(?P<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+).*?"
    r"content check:.*?\(model=(?P<model>[A-Za-z0-9._-]+), "
    r"(?P<input>\d+) prompt \+ (?P<output>\d+) completion tokens\)"
)
R2_BUCKETS = ("ponglens-raw", "ponglens-media")


def _nonnegative(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number >= 0 else 0.0


def _row_value(row: Any, key: str, index: int):
    if isinstance(row, dict):
        return row.get(key)
    return row[index]


def _occurred_at(day: date) -> str:
    return datetime.combine(
        day, time(23, 59, 59), tzinfo=timezone.utc
    ).isoformat()


def _days(start: date, end: date):
    current = start
    while current < end:
        yield current
        current += timedelta(days=1)


def storage_events(
    ledger_rows: Iterable[dict],
    *,
    start: date,
    end: date,
    current_r2_bytes: int | None,
) -> list[dict]:
    """Turn ledger deltas into daily balances and one current correction."""
    deltas: dict[date, int] = defaultdict(int)
    for row in ledger_rows:
        day = _row_value(row, "day", 0)
        if isinstance(day, datetime):
            day = day.date()
        if not isinstance(day, date) or day >= end:
            continue
        deltas[day] += int(_row_value(row, "bytes", 1) or 0)

    balance = sum(value for day, value in deltas.items() if day < start)
    days = list(_days(start, end))
    events = []
    for index, day in enumerate(days):
        balance = max(0, balance + deltas.get(day, 0))
        if index == len(days) - 1 and current_r2_bytes is not None:
            # The current bucket listing is a correction, not an additional
            # ledger delta. This prevents double-counting the baseline.
            balance = max(0, int(current_r2_bytes))
        month_days = calendar.monthrange(day.year, day.month)[1]
        if balance > 0:
            events.append({
                "provider": "Cloudflare",
                "service": "R2",
                "operation": "storage_daily_accrual",
                "sku": "r2-standard",
                "quantity": balance / 1_000_000_000 / month_days,
                "unit": "gb_month",
                "source": "backfill",
                "idempotency_key": (
                    f"backfill:r2-storage:{day.isoformat()}:gb-month"
                ),
                "occurred_at": _occurred_at(day),
                "metadata": {
                    "confidence": (
                        "metered"
                        if index == len(days) - 1
                        and current_r2_bytes is not None
                        else "estimated"
                    ),
                    "storage_class": "standard",
                },
            })
    if days and current_r2_bytes is not None and current_r2_bytes > 0:
        snapshot_day = days[-1]
        events.append({
            "provider": "Cloudflare",
            "service": "R2",
            "operation": "storage_snapshot",
            "sku": "r2-standard",
            "quantity": int(current_r2_bytes),
            "unit": "storage_byte_snapshot",
            "source": "backfill",
            "idempotency_key": (
                f"backfill:r2-storage:{snapshot_day.isoformat()}:bytes"
            ),
            "occurred_at": _occurred_at(snapshot_day),
            "metadata": {
                "confidence": "metered",
                "storage_class": "standard",
            },
        })
    return events


def ai_request_events(rows: Iterable[dict]) -> list[dict]:
    """Backfill known call counts without pretending they are token counts."""
    events = []
    dimensions = (
        ("ocr_pages", "journal_ocr"),
        ("image_checks", "entry_image_validation"),
    )
    for row in rows:
        day = _row_value(row, "day", 0)
        if isinstance(day, datetime):
            day = day.date()
        if not isinstance(day, date):
            continue
        for index, (field, operation) in enumerate(dimensions, start=1):
            count = int(_nonnegative(_row_value(row, field, index)))
            if count <= 0:
                continue
            events.append({
                "provider": "OpenAI",
                "service": "AI",
                "operation": operation,
                "sku": "gpt-5-mini",
                "quantity": count,
                "unit": "request",
                "source": "assumed",
                "idempotency_key": (
                    f"backfill:openai:{operation}:{day.isoformat()}:requests"
                ),
                "occurred_at": _occurred_at(day),
                "metadata": {
                    "confidence": "assumed",
                    "request_count": count,
                },
            })
    return events


def parse_worker_token_events(
    text: str,
    *,
    start: date,
    end: date,
) -> list[dict]:
    """Aggregate exact OpenAI token totals from recognized content-check logs."""
    totals: dict[tuple[date, str], list[int]] = defaultdict(lambda: [0, 0])
    seen: set[tuple[str, str, int, int]] = set()
    for line in text.splitlines():
        match = WORKER_LOG_PATTERN.search(line)
        if not match:
            continue
        timestamp = match.group("timestamp")
        day = date.fromisoformat(timestamp[:10])
        if day < start or day >= end:
            continue
        model = match.group("model")[:120]
        input_tokens = int(match.group("input"))
        output_tokens = int(match.group("output"))
        fingerprint = (timestamp, model, input_tokens, output_tokens)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        totals[(day, model)][0] += input_tokens
        totals[(day, model)][1] += output_tokens

    events = []
    for (day, model), (input_tokens, output_tokens) in sorted(totals.items()):
        for unit, quantity in (
            ("input_token", input_tokens),
            ("output_token", output_tokens),
        ):
            if quantity <= 0:
                continue
            events.append({
                "provider": "OpenAI",
                "service": "AI",
                "operation": "video_content_validation",
                "sku": model,
                "quantity": quantity,
                "unit": unit,
                "source": "backfill",
                "idempotency_key": (
                    f"backfill:worker-content-check:{day.isoformat()}:"
                    f"{model}:{unit}"
                ),
                "occurred_at": _occurred_at(day),
                "metadata": {"confidence": "metered"},
            })
    return events


def _keychain(service: str) -> str | None:
    try:
        return subprocess.check_output(
            [
                "security",
                "find-generic-password",
                "-a",
                "openclaw",
                "-s",
                service,
                "-w",
            ],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def _current_r2_bytes() -> int | None:
    account = os.environ.get("R2_ACCOUNT_ID") or _keychain(
        "ponglens-r2-account"
    )
    access = os.environ.get("R2_ACCESS_KEY_ID") or _keychain(
        "ponglens-r2-key-id"
    )
    secret = os.environ.get("R2_SECRET_ACCESS_KEY") or _keychain(
        "ponglens-r2-secret"
    )
    if not all((account, access, secret)):
        return None
    import boto3

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    total = 0
    paginator = client.get_paginator("list_objects_v2")
    for bucket in R2_BUCKETS:
        for page in paginator.paginate(Bucket=bucket):
            total += sum(
                int(item.get("Size") or 0)
                for item in page.get("Contents", [])
            )
    return total


def _database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or _keychain("ponglens-db-url")


def _load_aggregate_rows(connection, start: date, end: date):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            select (created_at at time zone 'utc')::date as day,
                   sum(bytes)::bigint as bytes
            from public.storage_ledger
            where created_at < %s
            group by 1
            order by 1
            """,
            (end,),
        )
        ledger = [{"day": row[0], "bytes": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """
            select day, sum(ocr_pages)::bigint, sum(image_checks)::bigint
            from public.ai_usage
            where day >= %s and day < %s
            group by day
            order by day
            """,
            (start, end),
        )
        ai = [
            {
                "day": row[0],
                "ocr_pages": row[1],
                "image_checks": row[2],
            }
            for row in cursor.fetchall()
        ]
        cursor.execute(
            """
            select
              count(*) filter (
                where j.status = 'done'
                  and j.created_at >= %s and j.created_at < %s
              )::bigint as completed_jobs,
              (
                select count(*) from public.matches m
                where m.status = 'ready'
                  and m.created_at >= %s and m.created_at < %s
              )::bigint as completed_matches,
              (
                select count(*) from public.points p
                join public.matches m on m.id = p.match_id
                where m.created_at >= %s and m.created_at < %s
              )::bigint as points
            from public.jobs j
            """,
            (start, end, start, end, start, end),
        )
        counts_row = cursor.fetchone()
    return ledger, ai, {
        "completed_jobs": int(counts_row[0] or 0),
        "completed_matches": int(counts_row[1] or 0),
        "points": int(counts_row[2] or 0),
    }


def _estimate_usd(events: Iterable[dict]) -> float:
    current_rates = {
        ("gpt-5-nano", "input_token"): 0.00000005,
        ("gpt-5-nano", "cached_input_token"): 0.000000005,
        ("gpt-5-nano", "output_token"): 0.0000004,
        ("gpt-5-mini", "input_token"): 0.00000025,
        ("gpt-5-mini", "cached_input_token"): 0.000000025,
        ("gpt-5-mini", "output_token"): 0.000002,
        ("r2-standard", "gb_month"): 0.015,
    }
    return sum(
        _nonnegative(event.get("quantity"))
        * current_rates.get((event.get("sku"), event.get("unit")), 0)
        for event in events
    )


def _summary(events: list[dict], counts: dict) -> dict:
    quantities: dict[str, float] = defaultdict(float)
    for event in events:
        key = f"{event['provider']} / {event['unit']}"
        quantities[key] += float(event["quantity"])
    return {
        "mode": "dry-run",
        "events": len(events),
        "estimated_usd_at_current_rates": round(_estimate_usd(events), 6),
        "source_counts": counts,
        "quantities": dict(sorted(quantities.items())),
    }


def _apply(connection, events: list[dict]) -> int:
    inserted = 0
    for offset in range(0, len(events), 100):
        batch = events[offset:offset + 100]
        with connection.cursor() as cursor:
            cursor.execute(
                "select public.record_cost_usage(%s::jsonb)",
                (json.dumps(batch, separators=(",", ":")),),
            )
            row = cursor.fetchone()
            inserted += int(row[0] or 0)
    return inserted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill aggregate PongLens cost usage (dry-run by default)"
    )
    parser.add_argument("--start", type=date.fromisoformat, default=date(2020, 1, 1))
    parser.add_argument(
        "--end",
        type=date.fromisoformat,
        default=datetime.now(timezone.utc).date(),
        help="exclusive UTC date (defaults to today)",
    )
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--worker-log",
        type=Path,
        default=Path(__file__).with_name("worker.log"),
    )
    parser.add_argument(
        "--current-r2-bytes",
        type=int,
        help="skip bucket listing and use this aggregate byte total",
    )
    args = parser.parse_args(argv)
    if args.end <= args.start:
        parser.error("--end must be after --start")
    database_url = _database_url()
    if not database_url:
        parser.error("DATABASE_URL or Keychain ponglens-db-url is required")

    import psycopg2

    connection = psycopg2.connect(database_url)
    connection.autocommit = True
    try:
        ledger, ai, counts = _load_aggregate_rows(
            connection, args.start, args.end
        )
        current_bytes = (
            args.current_r2_bytes
            if args.current_r2_bytes is not None
            else _current_r2_bytes()
        )
        log_text = (
            args.worker_log.read_text(errors="replace")
            if args.worker_log.exists()
            else ""
        )
        events = storage_events(
            ledger,
            start=args.start,
            end=args.end,
            current_r2_bytes=current_bytes,
        )
        events.extend(ai_request_events(ai))
        events.extend(parse_worker_token_events(
            log_text, start=args.start, end=args.end
        ))
        summary = _summary(events, counts)
        if args.apply:
            summary["mode"] = "apply"
            summary["inserted"] = _apply(connection, events)
        print(json.dumps(summary, indent=2, sort_keys=True))
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
