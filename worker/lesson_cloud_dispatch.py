"""Small, media-free eligibility check for the Modal lesson dispatcher."""

from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen


def cloud_dispatch_ready(release_id: str, *, environ=None, opener=None) -> bool:
    env = os.environ if environ is None else environ
    open_request = urlopen if opener is None else opener
    base_url = str(env.get("SUPABASE_URL", "")).rstrip("/")
    service_role = str(env.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    if not base_url or not service_role or not release_id:
        raise RuntimeError("Lesson cloud dispatcher credentials or release are missing")

    request = Request(
        base_url + "/rest/v1/rpc/lesson_video_cloud_dispatch_ready",
        data=json.dumps({"p_release": release_id}).encode(),
        headers={
            "apikey": service_role,
            "Authorization": "Bearer " + service_role,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with open_request(request, timeout=15) as response:
        return json.loads(response.read()) is True
