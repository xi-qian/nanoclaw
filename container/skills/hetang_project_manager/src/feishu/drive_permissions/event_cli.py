"""CLI: feishu-bitable-handover-from-event — 从 im.message.receive_v1 事件负载执行 handover。"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from feishu.bitable.client import FeishuBitableClient
from feishu.drive_permissions.event_handover import bitable_handover_from_receive_message_event
from feishu.exceptions import FeishuAPIError


def _load_event_json(path: str | None, inline: str | None) -> dict:
    if inline is not None:
        return json.loads(inline)
    if path is None or path == "-":
        return json.load(sys.stdin)
    p = Path(path)
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    p = argparse.ArgumentParser(
        description=(
            "Apply Bitable handover using a Feishu receive-message event JSON: "
            "p2p → grant + owner to sender; group → grant group (default full_access) + owner to group owner."
        ),
    )
    p.add_argument(
        "--event-file",
        metavar="PATH",
        default=None,
        help="Event JSON file; use - to read stdin; if both --event-file and --event-json omitted, stdin is used",
    )
    p.add_argument(
        "--event-json",
        default=None,
        help="Inline JSON string (alternative to --event-file)",
    )
    p.add_argument(
        "--app-token",
        default=None,
        help="Bitable app_token (or FEISHU_BITABLE_APP_TOKEN)",
    )
    p.add_argument(
        "--personal-prefer",
        choices=("openid", "userid", "unionid"),
        default="openid",
        help="p2p: prefer sender id type when multiple exist (default openid)",
    )
    p.add_argument(
        "--group-collab-perm",
        default="full_access",
        metavar="PERM",
        help="group: perm when adding whole group as collaborator (default full_access; try edit if rejected)",
    )
    p.add_argument(
        "--skip-grant-group",
        action="store_true",
        help="group: only transfer owner (group collaborator already added)",
    )
    p.add_argument(
        "--skip-grant-user",
        action="store_true",
        help="p2p: only transfer owner (user collaborator already added)",
    )
    p.add_argument(
        "--no-contact-profile",
        action="store_true",
        help="p2p: do not call contact/v3/users (skip optional profile fetch)",
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
    if not app_token:
        print("Missing --app-token or FEISHU_BITABLE_APP_TOKEN", file=sys.stderr)
        return 1

    try:
        payload = _load_event_json(args.event_file, args.event_json)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Invalid event JSON: {e}", file=sys.stderr)
        return 1

    try:
        client = FeishuBitableClient(config_path=args.config)
        out = bitable_handover_from_receive_message_event(
            client,
            app_token,
            payload,
            personal_id_preference=args.personal_prefer,
            group_collaborator_perm=args.group_collab_perm,
            skip_grant_group=args.skip_grant_group,
            skip_grant_user=args.skip_grant_user,
            fetch_contact_profile=not args.no_contact_profile,
        )
    except (ValueError, FeishuAPIError, TypeError, OSError) as e:
        if isinstance(e, FeishuAPIError) and e.body:
            print(
                json.dumps({"error": str(e), "code": e.code, "body": e.body}, ensure_ascii=False),
                file=sys.stderr,
            )
        else:
            print(str(e), file=sys.stderr)
        return 1

    print(json.dumps(out, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
