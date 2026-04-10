"""Bitable drive handover: group edit collaborator + transfer owner (no provisioning logic).

与荷塘 **单独项目管理** skill（`skills/feishu/hetang_project_manager`）流水线衔接：在 `--from-template`
建表与可选视图/表单之后调用，仅处理云文档权限与所有者转移。
"""

from __future__ import annotations

import time
from typing import Any

from feishu.bitable.client import FeishuBitableClient

_THROTTLE_SEC = 0.35


def bitable_grant_chat_edit_and_transfer_owner(
    client: FeishuBitableClient,
    app_token: str,
    *,
    open_chat_id: str,
    new_owner_member_type: str,
    new_owner_member_id: str,
    remove_old_owner: bool = False,
    old_owner_perm: str | None = "full_access",
    skip_grant_chat: bool = False,
    chat_collaborator_perm: str = "edit",
) -> dict[str, Any]:
    """
    Recommended order (see 单独项目管理 skill): add the group as edit collaborator, then
    transfer document owner to the group leader (or another user).

    Does not create tables, views, or forms — call separately after provisioning.

    :param skip_grant_chat: if True, only transfer owner (group already has edit, etc.)
    :param old_owner_perm: when remove_old_owner is False, optional perm for previous owner
    :param chat_collaborator_perm: perm for the group collaborator (e.g. ``edit`` or
        ``full_access``); tenant/policy may reject some values.
    """
    out: dict[str, Any] = {}
    token = app_token.strip()
    if not token:
        raise ValueError("app_token is empty")

    if not skip_grant_chat:
        chat = open_chat_id.strip()
        if not chat:
            raise ValueError("open_chat_id is required unless skip_grant_chat=True")
        gperm = (chat_collaborator_perm or "edit").strip() or "edit"
        out["drive_grant_edit_chat"] = client.drive_add_collaborator(
            token,
            member_type="openchat",
            member_id=chat,
            perm=gperm,
            collaborator_type="chat",
        )
        time.sleep(_THROTTLE_SEC)

    mt = (new_owner_member_type or "").strip()
    mid = (new_owner_member_id or "").strip()
    if not mt or not mid:
        raise ValueError("new_owner_member_type and new_owner_member_id are required")

    kw: dict[str, Any] = {
        "new_member_type": mt,
        "new_member_id": mid,
        "remove_old_owner": remove_old_owner,
    }
    if not remove_old_owner and old_owner_perm:
        kw["old_owner_perm"] = old_owner_perm

    out["drive_transfer_owner"] = client.drive_transfer_owner(token, **kw)
    return out


def bitable_grant_user_full_access_and_transfer_owner(
    client: FeishuBitableClient,
    app_token: str,
    *,
    user_member_type: str,
    user_member_id: str,
    user_collaborator_perm: str = "full_access",
    remove_old_owner: bool = False,
    old_owner_perm: str | None = "full_access",
    skip_grant_user: bool = False,
) -> dict[str, Any]:
    """
    For **personal** 单独项目管理 flows: add the same user as document collaborator (default
    ``full_access``), then transfer owner to that user — no group involved.

    Use when the requester is an individual; Bot passes that user's ``openid`` / ``userid``.

    :param skip_grant_user: if True, only transfer owner (user already has access).
    :param user_collaborator_perm: passed to add collaborator API (``full_access`` or ``edit``).
    """
    out: dict[str, Any] = {}
    token = app_token.strip()
    if not token:
        raise ValueError("app_token is empty")

    mt = (user_member_type or "").strip()
    mid = (user_member_id or "").strip()
    if not mt or not mid:
        raise ValueError("user_member_type and user_member_id are required")

    if not skip_grant_user:
        perm = (user_collaborator_perm or "full_access").strip() or "full_access"
        out["drive_grant_edit_user"] = client.drive_add_collaborator(
            token,
            member_type=mt,
            member_id=mid,
            perm=perm,
            collaborator_type="user",
        )
        time.sleep(_THROTTLE_SEC)

    kw: dict[str, Any] = {
        "new_member_type": mt,
        "new_member_id": mid,
        "remove_old_owner": remove_old_owner,
    }
    if not remove_old_owner and old_owner_perm:
        kw["old_owner_perm"] = old_owner_perm

    out["drive_transfer_owner"] = client.drive_transfer_owner(token, **kw)
    return out
