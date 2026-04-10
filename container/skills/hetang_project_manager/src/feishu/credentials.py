"""Load Feishu app_id / app_secret from JSON config file (no secrets in code)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def _pick_str(data: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = data.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def read_feishu_config_file(path: Path) -> tuple[str, str]:
    """Parse JSON config; require app_id and app_secret (camelCase aliases allowed)."""
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a JSON object: {path}")
    app_id = _pick_str(data, "app_id", "appId", "FEISHU_APP_ID")
    app_secret = _pick_str(data, "app_secret", "appSecret", "FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        raise ValueError(
            f"Config {path} must include non-empty app_id and app_secret "
            '(or appId / appSecret). See config/feishu.local.json.example.'
        )
    return app_id, app_secret


def load_feishu_credentials_from_file(config_path: str | None = None) -> tuple[str, str] | None:
    """
    Resolve credentials from a single file path, or discover default locations.

    When ``config_path`` is set: that file must exist.

    When unset: if ``FEISHU_CONFIG_PATH`` is set, that file must exist.

    Otherwise try ``./feishu.local.json`` then ``./config/feishu.local.json`` (relative to cwd).

    Returns ``None`` if no default file exists.
    """
    if config_path:
        p = Path(config_path).expanduser().resolve()
        if not p.is_file():
            raise ValueError(f"Feishu config file not found: {p}")
        return read_feishu_config_file(p)

    env = os.environ.get("FEISHU_CONFIG_PATH", "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if not p.is_file():
            raise ValueError(f"FEISHU_CONFIG_PATH file not found: {p}")
        return read_feishu_config_file(p)

    for rel in ("feishu.local.json", Path("config") / "feishu.local.json"):
        p = (Path.cwd() / rel).resolve()
        if p.is_file():
            return read_feishu_config_file(p)
    return None


def resolve_app_credentials(
    *,
    app_id: str | None = None,
    app_secret: str | None = None,
    config_path: str | None = None,
) -> tuple[str, str]:
    """
    Precedence: explicit args > env vars > config file (see ``load_feishu_credentials_from_file``).
    """
    aid = (app_id or os.environ.get("FEISHU_APP_ID", "")).strip()
    sec = (app_secret or os.environ.get("FEISHU_APP_SECRET", "")).strip()
    if aid and sec:
        return aid, sec
    loaded = load_feishu_credentials_from_file(config_path)
    if loaded:
        return loaded
    raise ValueError(
        "Feishu app_id and app_secret required: set in feishu.local.json (or config/feishu.local.json), "
        "or FEISHU_CONFIG_PATH, or environment FEISHU_APP_ID / FEISHU_APP_SECRET, "
        "or pass constructor arguments. See config/feishu.local.json.example."
    )
