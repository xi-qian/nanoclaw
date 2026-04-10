"""CLI: python -m feishu.bitable"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from feishu.bitable.client import FeishuBitableClient
from feishu.bitable.provision import (
    hetang_bitable_template_path,
    load_template,
    provision_bitable_from_template,
)
from feishu.exceptions import FeishuAPIError


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Feishu Bitable: 荷塘 skill — --from-template with --preset single_project; "
            "see skills/feishu/hetang_project_manager/SKILL.md + USAGE_*.md, or empty base without --from-template."
        ),
    )
    p.add_argument("--name", default=None, help="Bitable app name (empty base), or override template title with --from-template")
    p.add_argument("--folder-token", default=None, help="Folder token (or FEISHU_FOLDER_TOKEN)")
    p.add_argument("--time-zone", default=None, help="e.g. Asia/Shanghai (empty base only)")
    p.add_argument(
        "--from-template",
        action="store_true",
        help="Create base from JSON template (use --preset or --template).",
    )
    p.add_argument(
        "--preset",
        choices=("single_project",),
        default="single_project",
        help=(
            "With --from-template and without --template: bundled template — "
            "single_project=tasks+members (黄金模板复制); 默认文档名见 bitable.json。"
        ),
    )
    p.add_argument(
        "--template",
        metavar="PATH",
        default=None,
        help="Template JSON path (only with --from-template); overrides --preset",
    )
    p.add_argument(
        "--bitable-name",
        default=None,
        help="Override template bitable_name when using --from-template",
    )
    p.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON to stdout",
    )
    p.add_argument(
        "--grant-edit-chat-id",
        default=None,
        metavar="OPEN_CHAT_ID",
        help="After create: add this group as edit collaborator (or set FEISHU_GRANT_EDIT_OPEN_CHAT_ID). "
        "App robot must be in the group; needs docs:permission.member:create.",
    )
    p.add_argument(
        "--grant-edit-user-id",
        default=None,
        metavar="ID",
        help="After create: add this user as edit collaborator (or FEISHU_GRANT_EDIT_USER_ID). "
        "Use with --grant-edit-user-member-type (default userid).",
    )
    p.add_argument(
        "--grant-edit-user-member-type",
        default=None,
        metavar="userid|openid|unionid",
        help="With --grant-edit-user-id (default: env FEISHU_GRANT_EDIT_MEMBER_TYPE or userid).",
    )
    p.add_argument(
        "--grant-manage-user-id",
        default=None,
        metavar="ID",
        help="After create: add this user as full_access (管理员) collaborator (or FEISHU_GRANT_MANAGE_USER_ID). "
        "Use with --grant-manage-user-member-type (default userid). "
        "Typically the conversation initiator / project owner.",
    )
    p.add_argument(
        "--grant-manage-user-member-type",
        default=None,
        metavar="userid|openid|unionid",
        help="With --grant-manage-user-id (default: env FEISHU_GRANT_MANAGE_MEMBER_TYPE or userid).",
    )
    p.add_argument(
        "--transfer-owner-user-id",
        default=None,
        metavar="ID",
        help="After create: transfer document ownership to this user (or FEISHU_TRANSFER_OWNER_USER_ID). "
        "Old owner retains full_access. Use with --transfer-owner-user-member-type (default userid).",
    )
    p.add_argument(
        "--transfer-owner-user-member-type",
        default=None,
        metavar="userid|openid|unionid",
        help="With --transfer-owner-user-id (default: env FEISHU_TRANSFER_OWNER_MEMBER_TYPE or userid).",
    )
    p.add_argument(
        "--config",
        metavar="PATH",
        default=None,
        help="JSON with app_id and app_secret (overrides FEISHU_CONFIG_PATH for this run).",
    )
    p.add_argument(
        "--cockpit-source-app-token",
        default=None,
        metavar="APP_TOKEN",
        help=(
            "With --from-template: copy this existing Base instead of creating empty + tables. "
            "Use a golden Base that already includes a 仪表盘 and the same 中文表名 as the template "
            "(single_project: 任务/成员 only). Default clears rows (without_content); "
            "override with FEISHU_COCKPIT_COPY_WITHOUT_CONTENT=false. "
            "Or set env FEISHU_COCKPIT_SOURCE_APP_TOKEN."
        ),
    )
    return p


def _run(args: argparse.Namespace) -> int:
    try:
        client = FeishuBitableClient(config_path=args.config)
        grant_chat = (args.grant_edit_chat_id or os.environ.get("FEISHU_GRANT_EDIT_OPEN_CHAT_ID") or "").strip()
        grant_chat_opt = grant_chat or None
        grant_user = (args.grant_edit_user_id or os.environ.get("FEISHU_GRANT_EDIT_USER_ID") or "").strip()
        grant_user_opt = grant_user or None
        grant_user_mt = (
            args.grant_edit_user_member_type
            or os.environ.get("FEISHU_GRANT_EDIT_MEMBER_TYPE")
            or "userid"
        ).strip()
        grant_manage = (args.grant_manage_user_id or os.environ.get("FEISHU_GRANT_MANAGE_USER_ID") or "").strip()
        grant_manage_opt = grant_manage or None
        grant_manage_mt = (
            args.grant_manage_user_member_type
            or os.environ.get("FEISHU_GRANT_MANAGE_MEMBER_TYPE")
            or "userid"
        ).strip()
        transfer_owner = (args.transfer_owner_user_id or os.environ.get("FEISHU_TRANSFER_OWNER_USER_ID") or "").strip()
        transfer_owner_opt = transfer_owner or None
        transfer_owner_mt = (
            args.transfer_owner_user_member_type
            or os.environ.get("FEISHU_TRANSFER_OWNER_MEMBER_TYPE")
            or "userid"
        ).strip()
        if args.from_template:
            if args.preset == "single_project" and not (args.bitable_name or "").strip():
                raise ValueError("ERROR: --bitable-name is required for single_project. You must provide a document name.")
            path = Path(args.template) if args.template else hetang_bitable_template_path(args.preset)
            if not path.is_file():
                raise ValueError(f"Template file not found: {path}")
            template = load_template(path)
            cockpit = (args.cockpit_source_app_token or "").strip() or None
            result = provision_bitable_from_template(
                client,
                template,
                folder_token=args.folder_token,
                bitable_name=args.bitable_name or args.name,
                grant_edit_open_chat_id=grant_chat_opt,
                grant_edit_user_id=grant_user_opt,
                grant_edit_user_member_type=grant_user_mt,
                grant_manage_user_id=grant_manage_opt,
                grant_manage_user_member_type=grant_manage_mt,
                transfer_owner_user_id=transfer_owner_opt,
                transfer_owner_user_member_type=transfer_owner_mt,
                cockpit_source_app_token=cockpit,
            )
            out_obj = result
        else:
            app = client.create_bitable(
                name=args.name,
                folder_token=args.folder_token,
                time_zone=args.time_zone,
            )
            out_obj = dict(app)
            if grant_chat_opt:
                time.sleep(0.35)
                out_obj["drive_grant_edit_chat"] = client.drive_add_collaborator(
                    app["app_token"],
                    member_type="openchat",
                    member_id=grant_chat_opt,
                    perm="edit",
                    collaborator_type="chat",
                )
            if grant_user_opt:
                time.sleep(0.35)
                out_obj["drive_grant_edit_user"] = client.drive_add_collaborator(
                    app["app_token"],
                    member_type=grant_user_mt,
                    member_id=grant_user_opt,
                    perm="edit",
                    collaborator_type="user",
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

    out = json.dumps(out_obj, ensure_ascii=False, indent=2 if args.pretty else None)
    print(out)
    return 0


def main() -> int:
    args = _build_parser().parse_args()
    return _run(args)


def _argv_without_preset_and_from_template(argv: list[str]) -> list[str]:
    """So convenience CLIs can force --preset / --from-template without user duplicates."""
    out: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--from-template":
            i += 1
            continue
        if a == "--preset" and i + 1 < len(argv):
            i += 2
            continue
        if a.startswith("--preset="):
            i += 1
            continue
        out.append(a)
        i += 1
    return out


def main_create_single_project() -> int:
    """Console entry: feishu-create-single-project — single_project/ paths & naming."""
    tail = _argv_without_preset_and_from_template(list(sys.argv[1:]))
    args = _build_parser().parse_args(["--from-template", "--preset", "single_project", *tail])
    return _run(args)


if __name__ == "__main__":
    raise SystemExit(main())
