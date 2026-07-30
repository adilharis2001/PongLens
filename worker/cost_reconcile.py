"""Optional provider usage reconciliation for the platform cost dashboard.

Internal usage events remain the cost estimate's source of truth. These daily,
aggregate-only snapshots are a separate confidence check and are deliberately
credential-optional and fail-open.
"""

from __future__ import annotations

import calendar
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

try:
    from worker.cost_meter import stable_key
except ModuleNotFoundError:  # direct `python worker/worker.py` execution
    from cost_meter import stable_key


OPENAI_COSTS_URL = "https://api.openai.com/v1/organization/costs"
DEEPGRAM_API_URL = "https://api.deepgram.com/v1"
CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
VERCEL_CHARGES_URL = "https://api.vercel.com/v1/billing/charges"
SUPABASE_MANAGEMENT_URL = "https://api.supabase.com/v1"


def _number(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if math.isfinite(result) and result >= 0 else 0.0


def _signed_number(value: Any) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if math.isfinite(result) else 0.0


def _integer(value: Any) -> int:
    return int(_number(value))


def daily_period(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    today = current.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return today - timedelta(days=1), today


def parse_openai_cost(payloads: list[dict]) -> float:
    total = 0.0
    for payload in payloads:
        for bucket in payload.get("data", []):
            if not isinstance(bucket, dict):
                continue
            for result in bucket.get("results", []):
                amount = result.get("amount", {}) if isinstance(result, dict) else {}
                if str(amount.get("currency", "usd")).lower() == "usd":
                    total += _number(amount.get("value"))
    return round(total, 10)


def parse_deepgram_usage(payload: dict) -> dict:
    billable_hours = 0.0
    total_hours = 0.0
    requests = 0
    for result in payload.get("results", []):
        if not isinstance(result, dict):
            continue
        billable_hours += _number(result.get("hours"))
        total_hours += _number(result.get("total_hours"))
        requests += _integer(result.get("requests"))
    return {
        "billable_hours": round(billable_hours, 8),
        "total_hours": round(total_hours, 8),
        "requests": requests,
    }


def parse_cloudflare_usage(payload: dict) -> dict:
    data = payload.get("data", {})
    viewer = data.get("viewer", {}) if isinstance(data, dict) else {}
    accounts = viewer.get("accounts", []) if isinstance(viewer, dict) else []
    operations: dict[str, int] = {}
    storage_bytes = 0
    objects = 0
    for account in accounts:
        if not isinstance(account, dict):
            continue
        for group in account.get("r2OperationsAdaptiveGroups", []):
            if not isinstance(group, dict):
                continue
            dimensions = group.get("dimensions", {})
            totals = group.get("sum", {})
            action = str(dimensions.get("actionType") or "Unknown")[:80]
            operations[action] = operations.get(action, 0) + _integer(
                totals.get("requests")
            )
        # Storage is a sampled time series. The maximum account-wide snapshot
        # is representative; summing samples would multiply stored bytes.
        for group in account.get("r2StorageAdaptiveGroups", []):
            maximum = group.get("max", {}) if isinstance(group, dict) else {}
            payload_bytes = _integer(maximum.get("payloadSize"))
            metadata_bytes = _integer(maximum.get("metadataSize"))
            storage_bytes = max(storage_bytes, payload_bytes + metadata_bytes)
            objects = max(objects, _integer(maximum.get("objectCount")))
    return {
        "operations": dict(sorted(operations.items())),
        "operation_requests": sum(operations.values()),
        "storage_bytes": storage_bytes,
        "objects": objects,
    }


def parse_vercel_cost(payload: dict | list) -> float:
    if isinstance(payload, list):
        charges = payload
    elif isinstance(payload, dict):
        charges = payload.get("charges", payload.get("data", []))
    else:
        charges = []
    total = 0.0
    for charge in charges:
        if not isinstance(charge, dict):
            continue
        for key in (
            "BilledCost",
            "billedCost",
            "billed_cost",
            "EffectiveCost",
            "effectiveCost",
            "effective_cost",
        ):
            if key in charge:
                total += _signed_number(charge[key])
                break
    return round(max(0.0, total), 10)


def parse_supabase_usage(payload: dict) -> dict:
    totals = {
        "auth_requests": 0,
        "realtime_requests": 0,
        "rest_requests": 0,
        "storage_requests": 0,
    }
    mapping = {
        "total_auth_requests": "auth_requests",
        "total_realtime_requests": "realtime_requests",
        "total_rest_requests": "rest_requests",
        "total_storage_requests": "storage_requests",
    }
    for row in payload.get("result", []):
        if not isinstance(row, dict):
            continue
        for source, target in mapping.items():
            totals[target] += _integer(row.get(source))
    return totals


def _json_response(http, method: str, url: str, **kwargs) -> dict | list:
    response = http.request(method, url, timeout=15, **kwargs)
    response.raise_for_status()
    return response.json()


def _jsonl_response(http, method: str, url: str, **kwargs) -> list[dict]:
    response = http.request(method, url, timeout=15, **kwargs)
    response.raise_for_status()
    return [
        json.loads(line)
        for line in response.text.splitlines()
        if line.strip()
    ]


def _save_snapshot(
    connection,
    provider: str,
    start: datetime,
    end: datetime,
    *,
    reported_cost_usd: float | None,
    usage: dict,
    status: str,
    error_code: str | None = None,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            insert into public.cost_provider_snapshots (
              provider, period_start, period_end, reported_cost_usd,
              usage, status, error_code, fetched_at
            )
            values (%s, %s, %s, %s, %s::jsonb, %s, %s, now())
            on conflict (provider, period_start, period_end)
            do update set
              reported_cost_usd = excluded.reported_cost_usd,
              usage = excluded.usage,
              status = excluded.status,
              error_code = excluded.error_code,
              fetched_at = now()
            """,
            (
                provider,
                start,
                end,
                reported_cost_usd,
                json.dumps(usage, separators=(",", ":")),
                status,
                error_code,
            ),
        )


def _fetch_openai(http, config: dict, start: datetime, end: datetime):
    payloads = []
    page = None
    while True:
        params = {
            "start_time": int(start.timestamp()),
            "end_time": int(end.timestamp()),
            "bucket_width": "1d",
            "limit": 1,
        }
        if page:
            params["page"] = page
        payload = _json_response(
            http,
            "GET",
            f"{OPENAI_COSTS_URL}?{urlencode(params)}",
            headers={
                "Authorization": f"Bearer {config['openai_admin_key']}",
                "Content-Type": "application/json",
            },
        )
        payloads.append(payload)
        if not payload.get("has_more") or not payload.get("next_page"):
            break
        page = payload["next_page"]
    return parse_openai_cost(payloads), {"cost_buckets": sum(
        len(payload.get("data", [])) for payload in payloads
    )}


def _fetch_deepgram(http, config: dict, start: datetime, end: datetime):
    project_id = config["deepgram_project_id"]
    params = {"start": start.date().isoformat(), "end": start.date().isoformat()}
    payload = _json_response(
        http,
        "GET",
        f"{DEEPGRAM_API_URL}/projects/{project_id}/usage?{urlencode(params)}",
        headers={
            "Authorization": f"Token {config['deepgram_usage_key']}",
            "Accept": "application/json",
        },
    )
    return None, parse_deepgram_usage(payload)


_CLOUDFLARE_QUERY = """
query PlatformR2Usage($accountTag: string!, $startDate: Time!, $endDate: Time!) {
  viewer {
    accounts(filter: {accountTag: $accountTag}) {
      r2OperationsAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $startDate, datetime_leq: $endDate}
      ) {
        sum { requests }
        dimensions { actionType }
      }
      r2StorageAdaptiveGroups(
        limit: 10000
        filter: {datetime_geq: $startDate, datetime_leq: $endDate}
        orderBy: [datetime_DESC]
      ) {
        max { objectCount payloadSize metadataSize }
        dimensions { datetime }
      }
    }
  }
}
"""


def _fetch_cloudflare(http, config: dict, start: datetime, end: datetime):
    payload = _json_response(
        http,
        "POST",
        CLOUDFLARE_GRAPHQL_URL,
        headers={
            "Authorization": f"Bearer {config['cloudflare_analytics_token']}",
            "Content-Type": "application/json",
        },
        json={
            "query": _CLOUDFLARE_QUERY,
            "variables": {
                "accountTag": config["cloudflare_account_id"],
                "startDate": start.isoformat().replace("+00:00", "Z"),
                "endDate": end.isoformat().replace("+00:00", "Z"),
            },
        },
    )
    if payload.get("errors"):
        raise RuntimeError("CloudflareGraphQLError")
    return None, parse_cloudflare_usage(payload)


def _fetch_vercel(http, config: dict, start: datetime, end: datetime):
    params = {
        "teamId": config["vercel_team_id"],
        "from": start.isoformat().replace("+00:00", "Z"),
        "to": end.isoformat().replace("+00:00", "Z"),
    }
    payload = _jsonl_response(
        http,
        "GET",
        f"{VERCEL_CHARGES_URL}?{urlencode(params)}",
        headers={
            "Authorization": f"Bearer {config['vercel_access_token']}",
            "Accept": "application/jsonl",
        },
    )
    return parse_vercel_cost(payload), {"charges": len(payload)}


def _fetch_supabase(http, config: dict, start: datetime, end: datetime):
    del start, end
    project_ref = config["supabase_project_ref"]
    payload = _json_response(
        http,
        "GET",
        (
            f"{SUPABASE_MANAGEMENT_URL}/projects/{project_ref}"
            "/analytics/endpoints/usage.api-counts?interval=1d"
        ),
        headers={
            "Authorization": (
                f"Bearer {config['supabase_management_token']}"
            ),
            "Accept": "application/json",
        },
    )
    return None, parse_supabase_usage(payload)


def run_daily_reconciliation(
    connection,
    *,
    config: dict,
    http=None,
    now: datetime | None = None,
) -> dict[str, str]:
    """Fetch configured providers for the previous complete UTC day."""
    if http is None:
        import requests

        http = requests.Session()
    start, end = daily_period(now)
    checks = (
        (
            "OpenAI",
            ("openai_admin_key",),
            _fetch_openai,
        ),
        (
            "Deepgram",
            ("deepgram_usage_key", "deepgram_project_id"),
            _fetch_deepgram,
        ),
        (
            "Cloudflare",
            ("cloudflare_analytics_token", "cloudflare_account_id"),
            _fetch_cloudflare,
        ),
        (
            "Vercel",
            ("vercel_access_token", "vercel_team_id"),
            _fetch_vercel,
        ),
        (
            "Supabase",
            ("supabase_management_token", "supabase_project_ref"),
            _fetch_supabase,
        ),
    )
    statuses: dict[str, str] = {}
    for provider, required, fetch in checks:
        if not all(config.get(name) for name in required):
            continue
        try:
            cost, usage = fetch(http, config, start, end)
            _save_snapshot(
                connection,
                provider,
                start,
                end,
                reported_cost_usd=cost,
                usage=usage,
                status="success",
            )
            statuses[provider] = "success"
        except Exception as error:
            # Store only the exception class. Provider responses can echo
            # request material or secrets and do not belong in the dashboard.
            _save_snapshot(
                connection,
                provider,
                start,
                end,
                reported_cost_usd=None,
                usage={},
                status="error",
                error_code=type(error).__name__[:80],
            )
            statuses[provider] = "error"
    return statuses


def record_r2_storage_snapshot(
    meter,
    client,
    buckets: tuple[str, ...],
    occurred_at: datetime | None = None,
) -> dict:
    """Record aggregate current R2 bytes plus one day of GB-month usage."""
    instant = occurred_at or datetime.now(timezone.utc)
    total_bytes = 0
    total_objects = 0
    paginator = client.get_paginator("list_objects_v2")
    for bucket in buckets:
        for page in paginator.paginate(Bucket=bucket):
            contents = page.get("Contents", [])
            total_objects += len(contents)
            total_bytes += sum(_integer(item.get("Size")) for item in contents)
    month_days = calendar.monthrange(instant.year, instant.month)[1]
    day_key = instant.astimezone(timezone.utc).date().isoformat()
    anonymous_key = stable_key(day_key, "r2-account-storage")
    meter.record([
        {
            "provider": "Cloudflare",
            "service": "R2",
            "operation": "storage_snapshot",
            "sku": "r2-standard",
            "quantity": total_bytes,
            "unit": "storage_byte_snapshot",
            "idempotency_key": f"r2-storage:{anonymous_key}:bytes",
            "occurred_at": instant.isoformat(),
            "metadata": {
                "storage_class": "standard",
                "request_count": total_objects,
            },
        },
        {
            "provider": "Cloudflare",
            "service": "R2",
            "operation": "storage_daily_accrual",
            "sku": "r2-standard",
            "quantity": total_bytes / 1_000_000_000 / month_days,
            "unit": "gb_month",
            "idempotency_key": f"r2-storage:{anonymous_key}:gb-month",
            "occurred_at": instant.isoformat(),
            "metadata": {"storage_class": "standard"},
        },
    ])
    return {"storage_bytes": total_bytes, "objects": total_objects}
