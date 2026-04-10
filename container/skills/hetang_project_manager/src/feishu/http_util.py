"""HTTPS JSON helpers using only the Python standard library (no PyPI requests)."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any], str]:
    """
    Perform HTTP request; return (http_status, parsed_json_or_empty, raw_text_snippet).

    On URLError (DNS, timeout, etc.), raises URLError.
    """
    url = f"{base_url.rstrip('/')}{path}"
    if params:
        flat = []
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, bool):
                flat.append((k, "true" if v else "false"))
            else:
                flat.append((k, str(v)))
        q = urlencode(flat)
        url = f"{url}?{q}"

    m = method.upper()
    data: bytes | None = None
    hdrs = {k: v for k, v in (headers or {}).items()}
    if json_body is not None and m in ("POST", "PUT", "PATCH"):
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json; charset=utf-8")

    req = Request(url, data=data, headers=hdrs, method=m)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.getcode() or 200
    except HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except URLError:
        raise

    try:
        body: dict[str, Any] = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        body = {}

    snippet = raw[:500] if len(raw) > 500 else raw
    return status, body, snippet
