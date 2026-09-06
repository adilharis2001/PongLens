"""Durable aggregate platform-cost threshold email delivery."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Callable, Protocol

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


class PostgresCostAlertStore:
    def __init__(self, connection, threshold_step_usd: Decimal = Decimal("100")):
        self.connection = connection
        self.threshold_step_usd = threshold_step_usd

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
    for _ in range(max(0, max_alerts)):
        alert = store.claim()
        if alert is None:
            break
        try:
            send_email(
                recipient,
                _alert_email(alert, dashboard_url),
                idempotency_key=alert.idempotency_key,
            )
        except Exception as error:
            error_code = type(error).__name__[:80]
            store.release(alert.delivery_id, error_code)
            logger.warning(
                "cost alert delivery failed (non-fatal): %s",
                error_code,
            )
            break
        store.mark_sent(alert.delivery_id)
        delivered += 1
    return delivered
