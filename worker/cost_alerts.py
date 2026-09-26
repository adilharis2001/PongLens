"""Durable aggregate platform-cost threshold email delivery."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import partial
from typing import Callable, Protocol

from psycopg2 import errors as pg_errors

try:
    from worker.email_templates import cost_alert_message, render_email
except ModuleNotFoundError:
    from email_templates import cost_alert_message, render_email


@dataclass(frozen=True)
class CostAlert:
    delivery_id: str
    period_start: date
    threshold_usd: Decimal
    observed_cost_usd: Decimal
    provider_costs: dict[str, Decimal]
    attempts: int

    @property
    def idempotency_key(self) -> str:
        threshold = format(self.threshold_usd.normalize(), "f")
        return (
            f"ponglens-cost/{self.period_start.isoformat()}/{threshold}"
        )


class CostAlertStore(Protocol):
    def claim(self) -> CostAlert | None: ...

    def mark_sent(self, delivery_id: str) -> None: ...

    def release(self, delivery_id: str, error_code: str) -> None: ...


@contextmanager
def _statement_guard(connection):
    """Keep a failed statement from aborting an open transaction. The
    worker's alert connection is autocommit, where there is none."""
    if getattr(connection, "autocommit", True):
        yield
        return
    with connection.cursor() as cursor:
        cursor.execute("savepoint cost_alert_freeze")
    try:
        yield
    except Exception:
        with connection.cursor() as cursor:
            cursor.execute("rollback to savepoint cost_alert_freeze")
        raise
    with connection.cursor() as cursor:
        cursor.execute("release savepoint cost_alert_freeze")


class PostgresCostAlertStore:
    def __init__(self, connection, threshold_step_usd: Decimal = Decimal("100")):
        self.connection = connection
        self.threshold_step_usd = threshold_step_usd
        self._can_freeze = True

    def freeze(self, delivery_id: str, body: str) -> str | None:
        """Store this attempt's request body unless one is stored already,
        and return the stored one.

        Every claim recomputes the month's cost, so a retry used to render
        a different total into the same email under the same idempotency
        key. Resend refuses that as a different request, and 24 hours later,
        when it has forgotten the key, the retry goes out as a second email.
        That is what sent the $300 alert once a day from 09-19 to 09-26.
        The first attempt's body, stored here, is what every retry sends.

        None when migration 20260926170000 has not added the column yet:
        the worker then sends what it rendered, as it did before.
        """
        if not self._can_freeze:
            return None
        try:
            with _statement_guard(self.connection), \
                    self.connection.cursor() as cursor:
                cursor.execute(
                    "update public.platform_cost_alert_deliveries "
                    "set send_payload = coalesce(send_payload, %s) "
                    "where id = %s and status = 'sending' "
                    "returning send_payload",
                    (body, delivery_id),
                )
                row = cursor.fetchone()
        except pg_errors.UndefinedColumn:
            self._can_freeze = False
            return None
        return row[0] if row else None

    def claim(self) -> CostAlert | None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                "select public.claim_platform_cost_alert(%s, now())",
                (self.threshold_step_usd,),
            )
            row = cursor.fetchone()
        payload = row[0] if row else None
        if not isinstance(payload, dict):
            return None
        raw_costs = payload.get("provider_costs")
        provider_costs = {
            str(provider): Decimal(str(cost))
            for provider, cost in (
                raw_costs.items() if isinstance(raw_costs, dict) else []
            )
        }
        return CostAlert(
            delivery_id=str(payload["id"]),
            period_start=date.fromisoformat(str(payload["period_start"])),
            threshold_usd=Decimal(str(payload["threshold_usd"])),
            observed_cost_usd=Decimal(str(payload["observed_cost_usd"])),
            provider_costs=provider_costs,
            attempts=int(payload.get("attempts") or 1),
        )

    def mark_sent(self, delivery_id: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                "select public.complete_platform_cost_alert(%s, true, null)",
                (delivery_id,),
            )

    def release(self, delivery_id: str, error_code: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                "select public.complete_platform_cost_alert(%s, false, %s)",
                (delivery_id, error_code[:80]),
            )


def _format_usd(value: Decimal) -> str:
    return f"${value.quantize(Decimal('0.01')):,.2f}"


def _alert_email(alert: CostAlert, dashboard_url: str):
    month_label = alert.period_start.strftime("%B %Y")
    providers = [
        {"label": provider, "value": _format_usd(cost)}
        for provider, cost in sorted(
            alert.provider_costs.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]
    return render_email(cost_alert_message(
        threshold=_format_usd(alert.threshold_usd),
        observed=_format_usd(alert.observed_cost_usd),
        period=month_label,
        providers=providers,
        dashboard_url=dashboard_url,
    ))


def deliver_cost_alerts(
    store: CostAlertStore,
    send_email: Callable,
    recipient: str,
    dashboard_url: str,
    logger,
    *,
    max_alerts: int = 20,
) -> int:
    delivered = 0
    freeze = getattr(store, "freeze", None)
    for _ in range(max(0, max_alerts)):
        alert = store.claim()
        if alert is None:
            break
        try:
            send_email(
                recipient,
                _alert_email(alert, dashboard_url),
                idempotency_key=alert.idempotency_key,
                **({"freeze": partial(freeze, alert.delivery_id)}
                   if freeze is not None else {}),
            )
        except Exception as error:
            if getattr(error, "already_accepted", False):
                # Resend already holds an alert under this key: an earlier
                # attempt went out and only its reply was lost. Sending
                # again is the duplicate the key exists to stop.
                store.mark_sent(alert.delivery_id)
                delivered += 1
                logger.info(
                    "cost alert %s was already accepted; not sending it again",
                    alert.idempotency_key,
                )
                continue
            error_code = _error_code(error)
            store.release(alert.delivery_id, error_code)
            logger.warning(
                "cost alert delivery failed (non-fatal): %s",
                error_code,
            )
            break
        store.mark_sent(alert.delivery_id)
        delivered += 1
    return delivered


def _error_code(error: Exception) -> str:
    """The stored reason: the type, plus Resend's status and error name
    when it refused. Never the free-text message, which is not needed to
    tell one refusal from another."""
    code = type(error).__name__
    status = getattr(error, "status", None)
    name = getattr(error, "name", None)
    if isinstance(status, int) and isinstance(name, str) and name:
        code = f"{code} {status} {name}"
    return code[:80]
