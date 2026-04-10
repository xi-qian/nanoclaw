"""Parse Feishu bot message events (e.g. im.message.receive_v1) for handover context."""

from __future__ import annotations

from typing import Any


def im_member_id_type_to_drive(member_id_type: str) -> str:
    """Map IM ``member_id_type`` / ``owner_id_type`` to Drive ``member_type``."""
    t = (member_id_type or "open_id").lower().replace("-", "_")
    if t in ("open_id", "openid"):
        return "openid"
    if t in ("user_id", "userid"):
        return "userid"
    if t in ("union_id", "unionid"):
        return "unionid"
    return "openid"


def parse_receive_message_context(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract chat + sender from a receive-message style event envelope.

    Accepts either the full HTTP callback body (with top-level ``event``) or the inner
    ``event`` object only. Expected shape (fields may be absent):

    - ``event.message.chat_id``, ``event.message.chat_type`` (``group`` / ``p2p`` / …)
    - ``event.sender.sender_id.{open_id,user_id,union_id}``
    """
    if not isinstance(payload, dict):
        raise TypeError("payload must be a dict")

    ev = payload["event"] if isinstance(payload.get("event"), dict) else payload
    if not isinstance(ev, dict):
        raise ValueError("missing event object")

    msg = ev["message"] if isinstance(ev.get("message"), dict) else {}
    sender_wrap = ev["sender"] if isinstance(ev.get("sender"), dict) else {}
    sid = (
        sender_wrap["sender_id"]
        if isinstance(sender_wrap.get("sender_id"), dict)
        else {}
    )

    chat_id = str(msg.get("chat_id") or "").strip()
    chat_type = str(msg.get("chat_type") or "").strip().lower()

    ctx: dict[str, Any] = {
        "chat_id": chat_id,
        "chat_type": chat_type,
        "sender": {
            "open_id": _str_or_none(sid.get("open_id") or sid.get("openId")),
            "user_id": _str_or_none(sid.get("user_id") or sid.get("userId")),
            "union_id": _str_or_none(sid.get("union_id") or sid.get("unionId")),
        },
    }
    if not chat_id:
        raise ValueError("event missing message.chat_id")
    return ctx


def _str_or_none(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def is_personal_chat(ctx: dict[str, Any]) -> bool:
    """True for single-user session (p2p); False for group chats."""
    ct = str(ctx.get("chat_type") or "").strip().lower()
    if ct in ("p2p", "single", "single_chat"):
        return True
    if ct in ("group", "topic_group", "chat_group"):
        return False
    raise ValueError(
        f"Unsupported or empty message.chat_type {ct!r}; expected values like p2p or group"
    )


def pick_sender_drive_identity(
    ctx: dict[str, Any],
    *,
    prefer: str = "openid",
) -> tuple[str, str]:
    """
    Returns (drive_member_type, member_id) for the message sender.

    ``prefer``: ``openid`` or ``userid`` (falls back to the other if missing).
    """
    s = ctx.get("sender") or {}
    oid = s.get("open_id")
    uid = s.get("user_id")
    un = s.get("union_id")

    prefer = (prefer or "openid").strip().lower()
    if prefer == "userid" and uid:
        return "userid", uid
    if prefer == "unionid" and un:
        return "unionid", un
    if oid:
        return "openid", oid
    if uid:
        return "userid", uid
    if un:
        return "unionid", un
    raise ValueError("event sender has no open_id / user_id / union_id")
