"""IM Open API helpers (tenant token); used with FeishuBitableClient for shared auth."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from feishu.bitable.client import FeishuBitableClient
from feishu.exceptions import FeishuAPIError


def _chat_path_segment(chat_id: str) -> str:
    return quote(chat_id.strip(), safe="")


def im_get_chat(
    client: FeishuBitableClient,
    chat_id: str,
    *,
    user_id_type: str = "open_id",
) -> dict[str, Any]:
    """
    GET /open-apis/im/v1/chats/:chat_id

    Returns the inner ``chat`` object (empty dict if missing).
    """
    access = client.get_tenant_access_token()
    body = client._request_json(
        "GET",
        f"/open-apis/im/v1/chats/{_chat_path_segment(chat_id)}",
        headers=client._bearer_headers(access),
        params={"user_id_type": user_id_type},
    )
    data = body.get("data") or {}
    chat = data.get("chat")
    return chat if isinstance(chat, dict) else {}


def im_list_chat_members_all_pages(
    client: FeishuBitableClient,
    chat_id: str,
    *,
    member_id_type: str = "open_id",
    page_size: int = 200,
) -> list[dict[str, Any]]:
    """GET .../chats/:chat_id/members with pagination; returns raw member items."""
    access = client.get_tenant_access_token()
    items: list[dict[str, Any]] = []
    page_token: str | None = None
    cid = _chat_path_segment(chat_id)
    while True:
        params: dict[str, Any] = {
            "member_id_type": member_id_type,
            "page_size": min(page_size, 200),
        }
        if page_token:
            params["page_token"] = page_token
        body = client._request_json(
            "GET",
            f"/open-apis/im/v1/chats/{cid}/members",
            headers=client._bearer_headers(access),
            params=params,
        )
        data = body.get("data") or {}
        batch = data.get("items") or []
        if isinstance(batch, list):
            items.extend([x for x in batch if isinstance(x, dict)])
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
        if not page_token:
            break
    return items


def im_try_get_user(
    client: FeishuBitableClient,
    user_id: str,
    *,
    user_id_type: str = "open_id",
) -> dict[str, Any] | None:
    """
    GET /open-apis/contact/v3/users/:user_id — optional profile (needs contact scope).

    Returns ``user`` dict or None if missing / permission denied.
    """
    uid = (user_id or "").strip()
    if not uid:
        return None
    try:
        access = client.get_tenant_access_token()
        body = client._request_json(
            "GET",
            f"/open-apis/contact/v3/users/{quote(uid, safe='')}",
            headers=client._bearer_headers(access),
            params={"user_id_type": user_id_type},
        )
        data = body.get("data") or {}
        user = data.get("user")
        return user if isinstance(user, dict) else None
    except FeishuAPIError:
        return None
