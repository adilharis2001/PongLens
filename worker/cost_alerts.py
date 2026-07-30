"""Durable aggregate platform-cost threshold email delivery."""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Callable, Protocol


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


def _alert_html(alert: CostAlert, dashboard_url: str) -> str:
    provider_rows = "".join(
        "<tr>"
        f"<td style='padding:7px 0;color:#475569;'>"
        f"{html.escape(provider)}</td>"
        f"<td style='padding:7px 0;text-align:right;color:#0f172a;"
        f"font-variant-numeric:tabular-nums;'>{_format_usd(cost)}</td>"
        "</tr>"
        for provider, cost in sorted(
            alert.provider_costs.items(),
            key=lambda item: (-item[1], item[0]),
        )
    )
    safe_url = html.escape(dashboard_url, quote=True)
    month_label = alert.period_start.strftime("%B %Y")
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">PongLens crossed {_format_usd(alert.threshold_usd)} in {month_label}.&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <p style="margin:0;text-align:center;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0891b2;">Platform cost alert</p>
            <h1 style="margin:10px 0 0;text-align:center;font-size:24px;line-height:1.25;color:#0f172a;">Crossed {_format_usd(alert.threshold_usd)}</h1>
            <p style="margin:10px 0 0;text-align:center;font-size:14px;line-height:1.6;color:#64748b;">Month-to-date estimated spend for {month_label} is now <strong style="color:#0f172a;">{_format_usd(alert.observed_cost_usd)}</strong>.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
              {provider_rows}
            </table>
            <p style="margin:28px 0 0;text-align:center;"><a href="{safe_url}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0891b2;color:#fff;text-decoration:none;font-size:13px;font-weight:700;">Open cost dashboard</a></p>
            <p style="margin:24px 0 0;text-align:center;font-size:11px;line-height:1.5;color:#94a3b8;">Internal metered costs only. Provider reconciliation and synthetic compute are not double-counted.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""


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
                (
                    "PongLens cost alert: crossed "
                    f"{_format_usd(alert.threshold_usd)}"
                ),
                _alert_html(alert, dashboard_url),
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
