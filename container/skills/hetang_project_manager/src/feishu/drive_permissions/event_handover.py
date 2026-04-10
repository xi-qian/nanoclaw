"""Handover Bitable permissions using a Feishu message event (p2p vs group).

供荷塘 **单独项目管理** 飞书机器人场景：在 `im.message.receive_v1` 后根据单聊/群自动走个人或群 handover。
"""

from __future__ import annotations

from typing import Any

from feishu.bitable.client import FeishuBitableClient
from feishu.drive_permissions.handover import (
    bitable_grant_chat_edit_and_transfer_owner,
    bitable_grant_user_full_access_and_transfer_owner,
)
from feishu.drive_permissions.message_context import (
    im_member_id_type_to_drive,
    is_personal_chat,
    parse_receive_message_context,
    pick_sender_drive_identity,
)
from feishu.im.chat import im_get_chat, im_list_chat_members_all_pages, im_try_get_user


def _resolve_group_owner(
    client: FeishuBitableClient,
    chat_id: str,
) -> tuple[str, str, dict[str, Any], list[dict[str, Any]]]:
    chat = im_get_chat(client, chat_id)
    owner_id = chat.get("owner_id")
    owner_ty = chat.get("owner_id_type") or "open_id"
    members = im_list_chat_members_all_pages(client, chat_id)
    if owner_id:
        return (
            str(owner_id),
            im_member_id_type_to_drive(str(owner_ty)),
            chat,
            members,
        )
    for m in members:
        role_raw = m.get("role")
        role = str(role_raw or "").lower()
        if role in ("owner", "group_owner") or role_raw in (1, "1"):
            mid = m.get("member_id") or m.get("user_id") or m.get("id")
            mt = m.get("member_id_type") or "open_id"
            if mid:
                return (
                    str(mid),
                    im_member_id_type_to_drive(str(mt)),
                    chat,
                    members,
                )
    raise ValueError(
        "Could not resolve group owner (chat.owner_id empty and no member with role owner). "
        "Ensure the bot is in the group and IM scopes allow get chat + list members."
    )


def bitable_handover_from_receive_message_event(
    client: FeishuBitableClient,
    app_token: str,
    event_payload: dict[str, Any],
    *,
    personal_id_preference: str = "openid",
    group_collaborator_perm: str = "full_access",
    skip_grant_group: bool = False,
    skip_grant_user: bool = False,
    fetch_contact_profile: bool = True,
) -> dict[str, Any]:
    """
    After creating a Bitable, apply Drive handover from a **receive message** event:

    - **p2p**: add the sender as collaborator (``full_access``) and transfer owner to them;
      optionally fetch contact profile.
    - **group**: add the **whole group** as collaborator (``group_collaborator_perm``,
      default ``full_access`` so all members inherit), resolve **owner** via IM chat /
      member list, then transfer document owner to that user.

    ``event_payload``: full callback JSON or inner ``event`` object; see
    ``parse_receive_message_context``.
    """
    ctx = parse_receive_message_context(event_payload)
    out: dict[str, Any] = {"parsed_context": ctx}

    if is_personal_chat(ctx):
        mt, mid = pick_sender_drive_identity(ctx, prefer=personal_id_preference)
        out["mode"] = "p2p"
        out["resolved_owner"] = {"member_type": mt, "member_id": mid}
        profile = None
        if fetch_contact_profile:
            # contact API user_id_type aligns with drive member_type naming
            uid_type = "open_id" if mt == "openid" else ("user_id" if mt == "userid" else "union_id")
            profile = im_try_get_user(client, mid, user_id_type=uid_type)
        out["contact_user"] = profile
        out["drive_permissions"] = bitable_grant_user_full_access_and_transfer_owner(
            client,
            app_token,
            user_member_type=mt,
            user_member_id=mid,
            user_collaborator_perm="full_access",
            skip_grant_user=skip_grant_user,
        )
        return out

    chat_id = ctx["chat_id"]
    owner_id, owner_mt, chat, members = _resolve_group_owner(client, chat_id)
    out["mode"] = "group"
    out["im_chat"] = {
        "name": chat.get("name"),
        "description": chat.get("description"),
        "chat_mode": chat.get("chat_mode"),
        "member_count": len(members),
    }
    out["resolved_owner"] = {"member_type": owner_mt, "member_id": owner_id}
    out["drive_permissions"] = bitable_grant_chat_edit_and_transfer_owner(
        client,
        app_token,
        open_chat_id=chat_id,
        new_owner_member_type=owner_mt,
        new_owner_member_id=owner_id,
        skip_grant_chat=skip_grant_group,
        chat_collaborator_perm=group_collaborator_perm,
    )
    return out
