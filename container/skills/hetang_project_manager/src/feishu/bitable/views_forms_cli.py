"""CLI: feishu-apply-bitable-views | feishu-apply-bitable-forms

未指定 `--template` 时默认使用 **单独项目管理** 模板（`single_project/single_project.views.json` / `.forms.json`）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Literal

from feishu.bitable.client import FeishuBitableClient
from feishu.bitable.view_provision import (
    default_forms_template_path,
    default_views_template_path,
    load_view_template,
    provision_forms_from_template,
    provision_views_from_template,
)
from feishu.exceptions import FeishuAPIError

Kind = Literal["views", "forms"]


def _parse_table_ids_json(s: str | None) -> dict[str, str] | None:
    if not s or not s.strip():
        return None
    obj = json.loads(s)
    if not isinstance(obj, dict):
        raise ValueError("--table-ids-json must be a JSON object")
    return {str(k): str(v) for k, v in obj.items()}


def main_for(kind: Kind) -> int:
    default_path = default_views_template_path() if kind == "views" else default_forms_template_path()
    desc = (
        "单独项目管理 — Apply Feishu Bitable grid/kanban/gallery/gantt views from JSON (see templates/.../*.views.json)."
        if kind == "views"
        else "单独项目管理 — Apply Feishu Bitable form views from JSON (see templates/.../*.forms.json)."
    )
    p = argparse.ArgumentParser(description=desc)
    p.add_argument(
        "--template",
        metavar="PATH",
        default=None,
        help=f"Template JSON (default: {default_path})",
    )
    p.add_argument(
        "--app-token",
        default=None,
        help="Bitable app_token (or template field app_token or FEISHU_BITABLE_APP_TOKEN)",
    )
    p.add_argument(
        "--table-ids-json",
        default=None,
        help='Merge/override table_ids, e.g. \'{"tasks":"tblxxx","members":"tblyyy"}\'',
    )
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON stdout")
    p.add_argument(
        "--config",
        metavar="PATH",
        default=None,
        help="JSON with app_id and app_secret (Feishu app credentials).",
    )
    args = p.parse_args()

    path = Path(args.template) if args.template else default_path
    if not path.is_file():
        print(f"Template not found: {path}", file=sys.stderr)
        return 1

    try:
        template = load_view_template(path)
        override = _parse_table_ids_json(args.table_ids_json)
        app_token = (args.app_token or os.environ.get("FEISHU_BITABLE_APP_TOKEN") or "").strip() or None
        client = FeishuBitableClient(config_path=args.config)
        if kind == "views":
            out: dict[str, Any] = provision_views_from_template(
                client,
                template,
                app_token=app_token,
                table_ids_override=override,
            )
        else:
            out = provision_forms_from_template(
                client,
                template,
                app_token=app_token,
                table_ids_override=override,
            )
    except (ValueError, FeishuAPIError, OSError, json.JSONDecodeError) as e:
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


def main_views() -> None:
    raise SystemExit(main_for("views"))


def main_forms() -> None:
    raise SystemExit(main_for("forms"))
