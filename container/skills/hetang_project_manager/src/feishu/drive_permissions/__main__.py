"""CLI: feishu-bitable-handover — Bitable 权限与归属（群可编辑 + 转所有者 / 个人 full_access + 转所有者）。"""

from __future__ import annotations

import argparse
import json
import os
import sys

from feishu.bitable.client import FeishuBitableClient
from feishu.drive_permissions.handover import (
    bitable_grant_chat_edit_and_transfer_owner,
    bitable_grant_user_full_access_and_transfer_owner,
)
from feishu.exceptions import FeishuAPIError


def main() -> int:
    p = argparse.ArgumentParser(
        description=(
            "After creating a Bitable: (group) add group edit + transfer owner, or "
            "(personal) add user full_access + transfer owner to that user. "
            "See https://open.feishu.cn/document/server-docs/docs/permission/permission-member/transfer_owner"
        ),
    )
    p.add_argument(
        "--personal",
        action="store_true",
        help=(
            "Personal request: target user is the requester — add them as collaborator "
            "(full_access by default) then transfer owner. No --open-chat-id. "
            "Use --owner-member-id / --owner-member-type for that user."
        ),
    )
    p.add_argument(
        "--app-token",
        default=None,
        help="Bitable app_token (or FEISHU_BITABLE_APP_TOKEN)",
    )
    p.add_argument(
        "--open-chat-id",
        default=None,
        help="Group open_chat_id (or FEISHU_GRANT_EDIT_OPEN_CHAT_ID); ignored with --skip-grant-chat",
    )
    p.add_argument(
        "--owner-member-type",
        default=None,
        help="New owner ID type: userid | openid | unionid | email (or FEISHU_NEW_OWNER_MEMBER_TYPE, default userid)",
    )
    p.add_argument(
        "--owner-member-id",
        default=None,
        help="New owner member_id (or FEISHU_NEW_OWNER_MEMBER_ID)",
    )
    p.add_argument(
        "--remove-old-owner",
        action="store_true",
        help="Remove previous owner from collaborators (default: keep with old_owner_perm)",
    )
    p.add_argument(
        "--old-owner-perm",
        default="full_access",
        help="When not --remove-old-owner: perm for previous owner (default full_access)",
    )
    p.add_argument(
        "--chat-collab-perm",
        default=None,
        metavar="PERM",
        help=(
            "Group mode: perm when adding group as collaborator (default edit; "
            "e.g. full_access — tenant may reject some values; or env FEISHU_CHAT_COLLAB_PERM)"
        ),
    )
    p.add_argument(
        "--skip-grant-chat",
        action="store_true",
        help="Group mode: only transfer owner; do not POST group collaborator",
    )
    p.add_argument(
        "--skip-grant-user",
        action="store_true",
        help="Personal mode: only transfer owner; do not POST user collaborator first",
    )
    p.add_argument(
        "--user-collaborator-perm",
        default="full_access",
        metavar="PERM",
        help="Personal mode: perm when adding user collaborator (default full_access; try edit if API rejects)",
    )
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    p.add_argument(
        "--config",
        metavar="PATH",
        default=None,
        help="JSON with app_id and app_secret (Feishu app credentials).",
    )
    args = p.parse_args()

    app_token = (args.app_token or os.environ.get("FEISHU_BITABLE_APP_TOKEN") or "").strip()
    chat_id = (args.open_chat_id or os.environ.get("FEISHU_GRANT_EDIT_OPEN_CHAT_ID") or "").strip()
    chat_collab = (
        args.chat_collab_perm
        or os.environ.get("FEISHU_CHAT_COLLAB_PERM")
        or "edit"
    ).strip()
    owner_mt = (
        args.owner_member_type or os.environ.get("FEISHU_NEW_OWNER_MEMBER_TYPE") or "userid"
    ).strip()
    owner_mid = (args.owner_member_id or os.environ.get("FEISHU_NEW_OWNER_MEMBER_ID") or "").strip()
    personal_user = (os.environ.get("FEISHU_PERSONAL_USER_ID") or "").strip()
    if args.personal and not owner_mid and personal_user:
        owner_mid = personal_user

    if not app_token:
        print("Missing --app-token or FEISHU_BITABLE_APP_TOKEN", file=sys.stderr)
        return 1
    if not owner_mid:
        print("Missing --owner-member-id or FEISHU_NEW_OWNER_MEMBER_ID", file=sys.stderr)
        return 1

    if args.personal:
        if args.skip_grant_chat:
            print("Warning: --skip-grant-chat is ignored in --personal mode", file=sys.stderr)
    else:
        if not args.skip_grant_chat and not chat_id:
            print(
                "Missing --open-chat-id or FEISHU_GRANT_EDIT_OPEN_CHAT_ID "
                "(or use --skip-grant-chat), unless --personal",
                file=sys.stderr,
            )
            return 1

    old_perm = (args.old_owner_perm or "").strip() or None
    if args.remove_old_owner:
        old_perm = None

    try:
        client = FeishuBitableClient(config_path=args.config)
        if args.personal:
            result = bitable_grant_user_full_access_and_transfer_owner(
                client,
                app_token,
                user_member_type=owner_mt,
                user_member_id=owner_mid,
                user_collaborator_perm=args.user_collaborator_perm,
                remove_old_owner=args.remove_old_owner,
                old_owner_perm=old_perm,
                skip_grant_user=args.skip_grant_user,
            )
        else:
            result = bitable_grant_chat_edit_and_transfer_owner(
                client,
                app_token,
                open_chat_id=chat_id,
                new_owner_member_type=owner_mt,
                new_owner_member_id=owner_mid,
                remove_old_owner=args.remove_old_owner,
                old_owner_perm=old_perm,
                skip_grant_chat=args.skip_grant_chat,
                chat_collaborator_perm=chat_collab,
            )
    except (ValueError, FeishuAPIError, OSError) as e:
        if isinstance(e, FeishuAPIError) and e.body:
            print(
                json.dumps({"error": str(e), "code": e.code, "body": e.body}, ensure_ascii=False),
                file=sys.stderr,
            )
        else:
            print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
