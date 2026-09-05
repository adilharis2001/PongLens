"""Pure PongLens email messages and rendering for the independent worker."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import html
import json
import sys
from typing import Any
from urllib.parse import urlparse


SUPPORT_EMAIL = "support@ponglens.com"
LIGHT = {
    "canvas": "#f4f5f7", "surface": "#ffffff", "primary": "#111827",
    "secondary": "#4b5563", "muted": "#64748b", "border": "#e4e4e7",
    "inset": "#f8fafc",
}
DARK = {
    "canvas": "#08090f", "surface": "#101119", "primary": "#f4f4f5",
    "secondary": "#c4c4cc", "muted": "#a1a1aa", "border": "#3f3f46",
    "inset": "#181922",
}
ACCENT = "#2ac7e5"
ACTION_TEXT = "#071016"
ALLOWED_HOSTS = {"ponglens.com", "www.ponglens.com", "testflight.apple.com"}


@dataclass(frozen=True)
class EmailMessage:
    template_id: str
    template_version: int
    category: str
    audience: str
    subject: str
    preheader: str
    heading: str
    blocks: list[dict[str, Any]]
    reason: str
    eyebrow: str | None = None
    action: dict[str, str] | None = None
    support: bool = True


@dataclass(frozen=True)
class RenderedEmail:
    template_id: str
    template_version: int
    subject: str
    html: str
    text: str


def is_allowed_email_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            return False
        if parsed.username or parsed.password or parsed.port:
            return False
        if parsed.hostname == "testflight.apple.com":
            parts = [part for part in parsed.path.split("/") if part]
            return len(parts) == 2 and parts[0] == "join" and parts[1].isalnum()
        return True
    except (TypeError, ValueError):
        return False


def _approved_url(value: str) -> str:
    if not is_allowed_email_url(value):
        raise ValueError(f"URL is not an approved email destination: {value}")
    return html.escape(value, quote=True)


def _item_html(item: dict[str, Any]) -> str:
    title = html.escape(str(item.get("title") or ""))
    if item.get("url"):
        title_html = (
            f'<a class="email-link" href="{_approved_url(item["url"])}" '
            f'style="color:{ACCENT};text-decoration:none;font-weight:700;">'
            f'{title}</a>'
        )
    else:
        title_html = (
            f'<span class="primary-text" style="color:{LIGHT["primary"]};'
            f'font-weight:700;">{title}</span>'
        )
    description = ""
    if item.get("description"):
        description = (
            f'<div class="secondary-text" style="margin-top:5px;color:'
            f'{LIGHT["secondary"]};font-size:14px;line-height:1.55;">'
            f'{html.escape(str(item["description"]))}</div>'
        )
    meta = ""
    if item.get("meta"):
        meta = (
            f'<div class="muted-text" style="margin-top:7px;color:'
            f'{LIGHT["muted"]};font-size:12px;line-height:1.5;">'
            f'{html.escape(str(item["meta"]))}</div>'
        )
    return (
        f'<table class="inset-card" role="presentation" width="100%" '
        f'cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;'
        f'background:{LIGHT["inset"]};border:1px solid {LIGHT["border"]};'
        f'border-radius:12px;"><tr><td style="padding:14px 16px;font-family:'
        f'-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,'
        f'sans-serif;font-size:14px;line-height:1.5;">{title_html}'
        f'{description}{meta}</td></tr></table>'
    )


def _block_html(block: dict[str, Any]) -> str:
    kind = block["type"]
    if kind == "paragraph":
        return (
            f'<p class="secondary-text" style="margin:0 0 18px;color:'
            f'{LIGHT["secondary"]};font-size:16px;line-height:1.6;">'
            f'{html.escape(str(block["text"]))}</p>'
        )
    if kind == "steps":
        rows = "".join(
            f'<li style="margin:7px 0;padding-left:4px;">{html.escape(str(item))}</li>'
            for item in block["items"]
        )
        return (
            f'<ol class="secondary-text" style="margin:2px 0 20px;'
            f'padding-left:22px;color:{LIGHT["secondary"]};font-size:15px;'
            f'line-height:1.65;">{rows}</ol>'
        )
    if kind == "details":
        rows = "".join(
            f'<tr><td class="muted-text details-label" style="padding:11px '
            f'12px 11px 0;color:{LIGHT["muted"]};font-size:13px;line-height:'
            f'1.45;vertical-align:top;">{html.escape(str(row["label"]))}</td>'
            f'<td class="primary-text" align="right" style="padding:11px 0 '
            f'11px 12px;color:{LIGHT["primary"]};font-size:13px;line-height:'
            f'1.45;font-weight:600;vertical-align:top;">'
            f'{html.escape(str(row["value"]))}</td></tr>'
            for row in block["rows"]
        )
        return (
            f'<table class="details-table" role="presentation" width="100%" '
            f'cellpadding="0" cellspacing="0" border="0" style="margin:4px '
            f'0 22px;border-top:1px solid {LIGHT["border"]};border-bottom:1px '
            f'solid {LIGHT["border"]};">{rows}</table>'
        )
    if kind == "items":
        heading = ""
        if block.get("heading"):
            heading = (
                f'<h2 class="primary-text" style="margin:0 0 4px;color:'
                f'{LIGHT["primary"]};font-size:15px;line-height:1.4;">'
                f'{html.escape(str(block["heading"]))}</h2>'
            )
        return (
            f'<div style="margin:4px 0 22px;">{heading}'
            f'{"".join(_item_html(item) for item in block["items"])}</div>'
        )
    if kind == "diagnostic":
        return (
            f'<pre class="diagnostic" style="margin:4px 0 22px;padding:14px '
            f'16px;overflow-wrap:anywhere;white-space:pre-wrap;background:'
            f'{LIGHT["inset"]};border:1px solid {LIGHT["border"]};border-radius:'
            f'12px;color:{LIGHT["secondary"]};font-family:ui-monospace,'
            f'SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;'
            f'line-height:1.55;">{html.escape(str(block["text"]))}</pre>'
        )
    raise ValueError(f"Unknown email block: {kind}")


def _block_text(block: dict[str, Any]) -> str:
    kind = block["type"]
    if kind in ("paragraph", "diagnostic"):
        return str(block["text"])
    if kind == "steps":
        return "\n".join(f"{i}. {item}" for i, item in enumerate(block["items"], 1))
    if kind == "details":
        return "\n".join(f'{row["label"]}: {row["value"]}' for row in block["rows"])
    if kind == "items":
        parts = [str(block["heading"])] if block.get("heading") else []
        for item in block["items"]:
            parts.append("\n".join(
                str(item[key]) for key in ("title", "description", "meta", "url")
                if item.get(key)
            ))
        return "\n\n".join(parts)
    raise ValueError(f"Unknown email block: {kind}")


def render_email(message: EmailMessage) -> RenderedEmail:
    if message.action:
        _approved_url(message.action["url"])
    for block in message.blocks:
        if block["type"] == "items":
            for item in block["items"]:
                if item.get("url"):
                    _approved_url(item["url"])
    width = 600 if message.category in ("digest", "ops") else 560
    action = ""
    if message.action:
        action = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" '
            f'border="0" style="margin:8px 0 0;"><tr><td align="center" '
            f'bgcolor="{ACCENT}" style="background:{ACCENT};border-radius:'
            f'999px;"><a href="{_approved_url(message.action["url"])}" '
            f'style="display:block;box-sizing:border-box;min-height:44px;'
            f'padding:13px 22px;color:{ACTION_TEXT};font-size:15px;line-height:'
            f'18px;font-weight:750;text-decoration:none;border-radius:999px;">'
            f'{html.escape(message.action["label"])}</a></td></tr></table>'
        )
    eyebrow = ""
    if message.eyebrow:
        eyebrow = (
            f'<p style="margin:0 0 10px;color:{ACCENT};font-size:12px;'
            f'line-height:1.4;font-weight:800;letter-spacing:.12em;'
            f'text-transform:uppercase;">{html.escape(message.eyebrow)}</p>'
        )
    support_html = ""
    if message.support:
        support_html = (
            f'<p class="muted-text" style="margin:7px 0 0;color:{LIGHT["muted"]};'
            f'font-size:12px;line-height:1.6;">Questions? <a class="email-link" '
            f'href="mailto:{SUPPORT_EMAIL}" style="color:{ACCENT};'
            f'text-decoration:none;">{SUPPORT_EMAIL}</a></p>'
        )
    css = f"""
:root {{ color-scheme: light dark; supported-color-schemes: light dark; }}
@media only screen and (max-width: 480px) {{ .email-card-cell {{ padding:24px !important; }} .details-label {{ width:34% !important; }} }}
@media (prefers-color-scheme: dark) {{
 .email-body,.email-canvas {{ background-color:{DARK['canvas']} !important; }}
 .email-card {{ background-color:{DARK['surface']} !important;border-color:{DARK['border']} !important; }}
 .primary-text {{ color:{DARK['primary']} !important; }}
 .secondary-text {{ color:{DARK['secondary']} !important; }}
 .muted-text {{ color:{DARK['muted']} !important; }}
 .details-table {{ border-color:{DARK['border']} !important; }}
 .inset-card,.diagnostic {{ background-color:{DARK['inset']} !important;border-color:{DARK['border']} !important;color:{DARK['secondary']} !important; }}
 .email-link {{ color:{ACCENT} !important; }}
}}"""
    rendered_html = f"""<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>{html.escape(message.subject)} | PongLens</title><style>{css}</style></head>
<body class="email-body" style="margin:0;padding:0;background:{LIGHT['canvas']};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">{html.escape(message.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table class="email-canvas" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:{LIGHT['canvas']};"><tr><td align="center" style="padding:36px 16px;">
<table class="email-card" role="presentation" width="{width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:{width}px;background:{LIGHT['surface']};border:1px solid {LIGHT['border']};border-radius:20px;"><tr><td class="email-card-cell" style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;"><tr>
<td width="48" style="width:48px;vertical-align:middle;"><img src="https://www.ponglens.com/img/icon-192.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:10px;"></td>
<td style="vertical-align:middle;"><div aria-label="PongLens" style="color:{LIGHT['primary']};font-size:21px;line-height:1;font-weight:800;letter-spacing:-0.03em;"><span class="primary-text">Pong</span><span style="color:{ACCENT};">Lens</span></div></td>
</tr></table>
{eyebrow}<h1 class="primary-text" style="margin:0 0 18px;color:{LIGHT['primary']};font-size:28px;line-height:1.2;font-weight:750;letter-spacing:-0.025em;">{html.escape(message.heading)}</h1>
{"".join(_block_html(block) for block in message.blocks)}{action}
<div class="details-table" style="margin-top:30px;padding-top:18px;border-top:1px solid {LIGHT['border']};"><p class="muted-text" style="margin:0;color:{LIGHT['muted']};font-size:12px;line-height:1.6;">{html.escape(message.reason)}</p>{support_html}</div>
</td></tr></table></td></tr></table></body></html>"""
    text_parts = [message.eyebrow, message.heading]
    text_parts.extend(_block_text(block) for block in message.blocks)
    if message.action:
        text_parts.append(f'{message.action["label"]}\n{message.action["url"]}')
    text_parts.append(message.reason)
    if message.support:
        text_parts.append(f"Questions? {SUPPORT_EMAIL}")
    return RenderedEmail(
        template_id=message.template_id,
        template_version=message.template_version,
        subject=message.subject,
        html=rendered_html,
        text="\n\n".join(part for part in text_parts if part),
    )


def match_ready_message(original_name: str, match_url: str) -> EmailMessage:
    return EmailMessage(
        template_id="match.ready", template_version=1, category="match", audience="player",
        subject="Your PongLens match is ready", preheader=f"Watch {original_name} point by point.",
        heading="Your match is ready",
        blocks=[{"type": "paragraph", "text": f"{original_name} is ready to watch point by point. Score it, add notes, or share it with your coach."}],
        action={"label": "Open your match", "url": match_url},
        reason="You received this because PongLens finished processing a video you submitted.",
    )


def upload_failed_message(source: str, safe_reason: str) -> EmailMessage:
    source_name = "YouTube import" if source == "youtube" else "Direct upload"
    return EmailMessage(
        template_id="match.import-failed" if source == "youtube" else "match.upload-failed",
        template_version=1, category="match", audience="player",
        subject="We couldn't process your video", preheader="Review the issue and try the upload again.",
        heading="This video couldn't be processed",
        blocks=[
            {"type": "details", "rows": [{"label": "Source", "value": source_name}]},
            {"type": "paragraph", "text": safe_reason},
            {"type": "paragraph", "text": "Your original video on your device is unchanged."},
        ],
        action={"label": "Try another upload", "url": "https://www.ponglens.com/upload"},
        reason="You received this because a video you submitted could not finish processing.",
    )


def export_ready_message(match_url: str) -> EmailMessage:
    return EmailMessage(
        template_id="match.export-ready", template_version=1, category="match", audience="player",
        subject="Your match export is ready", preheader="Your shareable video has finished rendering.",
        heading="Your export is ready",
        blocks=[{"type": "paragraph", "text": "Your shareable match video has finished rendering. Open the match to save it or share it."}],
        action={"label": "Open your match", "url": match_url},
        reason="You received this because you asked PongLens to create an export.",
    )


def admin_job_failure_message(job_id: str, error: str, job_url: str) -> EmailMessage:
    return EmailMessage(
        template_id="ops.job-failed", template_version=1, category="ops", audience="admin",
        subject=f"[Action needed] Match processing failed · {job_id[:8]}",
        preheader="A processing job needs review.", eyebrow="Processing failure",
        heading="A match-processing job failed",
        blocks=[
            {"type": "details", "rows": [{"label": "Job", "value": job_id}]},
            {"type": "diagnostic", "text": error[:1000]},
        ],
        action={"label": "Open failed job", "url": job_url},
        reason="This internal alert was sent because processing stopped and needs review.",
        support=False,
    )


def worker_outcome_fixtures() -> list[dict[str, Any]]:
    return [
        {"id": "match.ready", "message": match_ready_message("Maya vs. Alex.mov", "https://www.ponglens.com/match/preview")},
        {"id": "match.upload-failed", "message": upload_failed_message("upload", "We could not find enough playable table tennis footage in this video.")},
        {"id": "match.import-failed", "message": upload_failed_message("youtube", "That video is private or unavailable.")},
        {"id": "match.export-ready", "message": export_ready_message("https://www.ponglens.com/match/preview")},
        {"id": "ops.job-failed", "message": admin_job_failure_message("12345678-0000-0000-0000-preview", "decoder stopped at frame 91", "https://www.ponglens.com/admin/uploads/preview")},
    ]


def feedback_digest_message(new_items: list[dict[str, Any]],
                            leaderboard: list[dict[str, Any]]) -> EmailMessage:
    items = []
    for item in new_items:
        votes = int(item.get("vote_count") or 0)
        meta_parts = []
        if item.get("severity"):
            meta_parts.append(str(item["severity"]))
        meta_parts.append(str(item.get("author") or "Someone"))
        meta_parts.append(f"{votes} vote{'s' if votes != 1 else ''}")
        environment = item.get("environment") or {}
        if isinstance(environment, dict) and environment.get("viewport"):
            meta_parts.append(str(environment["viewport"]))
        description = str(item.get("body") or "").strip()
        qa = item.get("qa") or []
        for pair in qa:
            if isinstance(pair, dict) and (pair.get("q") or pair.get("a")):
                description += f'\n{pair.get("q", "")}\n{pair.get("a", "")}'
        items.append({
            "title": str(item.get("title") or "Untitled feedback"),
            "description": description,
            "meta": " · ".join(meta_parts),
        })
    board = [
        {
            "title": f'{rank}. {item.get("title") or "Untitled"}',
            "meta": f'{int(item.get("vote_count") or 0)} votes',
        }
        for rank, item in enumerate(leaderboard, 1)
    ]
    n = len(new_items)
    blocks = [{
        "type": "paragraph",
        "text": f"{n} new feedback item{'s' if n != 1 else ''} arrived in the last 24 hours.",
    }]
    if items:
        blocks.append({"type": "items", "heading": "New feedback", "items": items})
    if board:
        blocks.append({"type": "items", "heading": "Top of the board", "items": board})
    return EmailMessage(
        template_id="digest.feedback", template_version=1, category="digest",
        audience="admin", subject=f"PongLens feedback · {n} new item{'s' if n != 1 else ''}",
        preheader=f"{n} new feedback item{'s' if n != 1 else ''} in the last day.",
        heading="Feedback digest", blocks=blocks,
        action={"label": "Open the feedback board", "url": "https://www.ponglens.com/feedback"},
        reason="This daily digest includes new PongLens feedback and the current board leaders.",
        support=False,
    )


_STATUS_LABELS = {
    "done": "Done", "declined": "Not doing", "closed": "Fixed and closed",
    "rejected": "Not a bug", "duplicate": "Already reported",
}


def qa_digest_message(items: list[dict[str, Any]], first_name: str,
                      comments: list[dict[str, Any]] | None = None) -> EmailMessage:
    comments = comments or []
    blocks: list[dict[str, Any]] = []
    n, c = len(items), len(comments)
    if c:
        reply_items = []
        for item in comments:
            reply_items.append({
                "title": str(item.get("bug_title") or "Report reply"),
                "description": str(item.get("body") or "")[:320],
                "meta": f'{str(item.get("writer") or "PongLens").split(" ")[0]} replied',
                "url": f'https://www.ponglens.com/testing/bugs?bug={item.get("bug_id")}',
            })
        blocks.append({"type": "items", "heading": "Replies on your reports", "items": reply_items})
    if n:
        closed_items = []
        for item in items:
            closed_items.append({
                "title": str(item.get("title") or "Report"),
                "description": str(item.get("body") or item.get("note") or "")[:240],
                "meta": _STATUS_LABELS.get(str(item.get("status")), str(item.get("status") or "Closed")),
            })
        blocks.append({"type": "items", "heading": "Closed", "items": closed_items})
    if c and n:
        heading = "Replies and closed reports"
        preheader = f"{c} repl{'ies' if c != 1 else 'y'} and {n} reports closed."
    elif c:
        heading = "Someone replied to you"
        preheader = f"{c} of your reports {'have' if c != 1 else 'has'} a new reply."
    else:
        heading = "Reports closed"
        preheader = f"{n} report{'s' if n != 1 else ''} you filed {'have' if n != 1 else 'has'} been closed."
    if first_name:
        blocks.insert(0, {"type": "paragraph", "text": f"Hi {first_name}, {preheader}"})
    return EmailMessage(
        template_id="digest.qa", template_version=1, category="digest", audience="tester",
        subject=f"{n + c} updates to your PongLens reports", preheader=preheader,
        heading=heading, blocks=blocks,
        action={"label": "Open your reports", "url": "https://www.ponglens.com/testing/bugs"},
        reason="PongLens sends this digest once a day when one of your reports changes.",
        support=True,
    )


def cost_alert_message(*, threshold: str, observed: str, period: str,
                       providers: list[dict[str, str]],
                       dashboard_url: str) -> EmailMessage:
    return EmailMessage(
        template_id="ops.cost-alert", template_version=1, category="ops", audience="admin",
        subject=f"PongLens costs crossed {threshold} this month",
        preheader=f"Estimated spend for {period} is now {observed}.",
        eyebrow="Platform cost alert", heading=f"Costs crossed {threshold}",
        blocks=[
            {"type": "paragraph", "text": f"Month-to-date estimated spend for {period} is now {observed}."},
            {"type": "details", "rows": providers},
        ],
        action={"label": "Open cost dashboard", "url": dashboard_url},
        reason="Internal metered costs only. Provider reconciliation and synthetic compute are not counted twice.",
        support=False,
    )


def operational_fixtures() -> list[dict[str, Any]]:
    return [
        {"id": "digest.feedback", "message": feedback_digest_message(
            [{"title": "Score correction", "body": "The point moved to the wrong player.", "type": "bug", "visibility": "board", "qa": [], "vote_count": 3, "author": "Maya", "severity": "high", "environment": {"viewport": "393x660"}}],
            [{"title": "Score correction", "vote_count": 3}],
        )},
        {"id": "digest.qa", "message": qa_digest_message(
            [{"id": "preview-1", "title": "Mobile crop", "status": "closed", "body": "The video now fits the available height."}],
            "Maya",
            [{"bug_id": "preview-2", "bug_title": "Dark theme", "body": "Can you check this again?", "writer": "Adil"}],
        )},
        {"id": "ops.cost-alert", "message": cost_alert_message(
            threshold="$100.00", observed="$123.46", period="September 2026",
            providers=[{"label": "OpenAI", "value": "$80.25"}, {"label": "Cloudflare", "value": "$43.21"}],
            dashboard_url="https://www.ponglens.com/admin/costs",
        )},
    ]


def rendered_fixture_catalog() -> list[dict[str, Any]]:
    """Synthetic worker messages for previewing without touching product data."""
    fixtures = [*worker_outcome_fixtures(), *operational_fixtures()]
    return [
        {
            "id": fixture["id"],
            "label": fixture["id"],
            **asdict(render_email(fixture["message"])),
        }
        for fixture in fixtures
    ]


if __name__ == "__main__":
    if sys.argv[1:] != ["--fixtures-json"]:
        raise SystemExit("usage: email_templates.py --fixtures-json")
    print(json.dumps(rendered_fixture_catalog(), separators=(",", ":")))
