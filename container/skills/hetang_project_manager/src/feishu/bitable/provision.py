"""Create a Bitable from a JSON template (tables, fields, links, formulas).

默认模板路径服务于荷塘 **单独项目管理** skill（`single_project/single_project.bitable.json`）。
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Literal

from feishu.bitable.client import FeishuBitableClient
from feishu.bitable.view_provision import (
    load_view_template,
    provision_forms_from_template,
    provision_views_from_template,
)
from feishu.exceptions import FeishuAPIError

THROTTLE_SEC = 0.35


def _sleep() -> None:
    time.sleep(THROTTLE_SEC)


HetangBitablePreset = Literal["single_project"]


def hetang_bitable_template_path(preset: HetangBitablePreset | str = "single_project") -> Path:
    """Bundled 荷塘模板：single_project 为任务+成员两表，路径相对仓库根。"""
    base = Path(__file__).resolve().parents[3] / "templates" / "feishu" / "hetang" / "bitable"
    if preset == "single_project":
        return base / "single_project" / "single_project.bitable.json"
    raise ValueError(f"unknown hetang bitable preset {preset!r}; use 'single_project'")


def default_template_path() -> Path:
    """同 `hetang_bitable_template_path('single_project')`。"""
    return hetang_bitable_template_path("single_project")


def load_template(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def _merge_description(prop: dict[str, Any], field_def: dict[str, Any]) -> dict[str, Any]:
    if not field_def.get("description"):
        return prop
    out = {**prop, "description": {"disable_sync": True, "text": str(field_def["description"])}}
    return out


def _feishu_select_option_color(raw: Any) -> int:
    """Feishu OpenAPI single/multi select option color: only 0–9 (10 palette entries)."""
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return 0
    if v < 0:
        return 0
    if v > 9:
        return v % 10
    return v


def template_field_to_api(
    field_def: dict[str, Any],
    table_ids: dict[str, str],
    *,
    current_table_key: str,
) -> dict[str, Any]:
    """Map template field dict to Feishu `fields` / create_field body (excluding outer wrapper)."""
    name = field_def["name"]
    t = field_def["type"]
    prop: dict[str, Any] = {}

    if t == "text":
        body: dict[str, Any] = {"field_name": name, "type": 1, "ui_type": "Text"}
    elif t == "number":
        body = {"field_name": name, "type": 2, "ui_type": "Number"}
        prop = _merge_description(prop, field_def)
    elif t == "currency":
        body = {"field_name": name, "type": 2, "ui_type": "Currency"}
        prop["currency_code"] = field_def.get("currency_code") or "CNY"
        # Feishu API rejects Currency without formatter on create_table (1254001 WrongRequestBody).
        prop["formatter"] = field_def.get("formatter") or "0"
        prop = _merge_description(prop, field_def)
    elif t == "progress":
        body = {"field_name": name, "type": 2, "ui_type": "Progress"}
        prop["min"] = float(field_def.get("min", 0))
        prop["max"] = float(field_def.get("max", 100))
        prop["range_customize"] = True
        # create_field rejects Progress without formatter (1254001).
        prop["formatter"] = field_def.get("formatter") or "0"
        prop = _merge_description(prop, field_def)
    elif t == "single_select":
        body = {"field_name": name, "type": 3, "ui_type": "SingleSelect"}
        opts = field_def.get("options") or []
        prop["options"] = [
            {"name": o["name"], "color": _feishu_select_option_color(o.get("color", 0))} for o in opts
        ]
        prop = _merge_description(prop, field_def)
    elif t == "multi_select":
        body = {"field_name": name, "type": 4, "ui_type": "MultiSelect"}
        opts = field_def.get("options") or []
        prop["options"] = [
            {"name": o["name"], "color": _feishu_select_option_color(o.get("color", 0))} for o in opts
        ]
        prop = _merge_description(prop, field_def)
    elif t == "date":
        body = {"field_name": name, "type": 5, "ui_type": "DateTime"}
        prop["date_formatter"] = field_def.get("date_formatter") or "yyyy/MM/dd"
        prop = _merge_description(prop, field_def)
    elif t == "user":
        body = {"field_name": name, "type": 11, "ui_type": "User"}
        prop["multiple"] = bool(field_def.get("multiple", True))
        prop = _merge_description(prop, field_def)
    elif t == "group_chat":
        body = {"field_name": name, "type": 23, "ui_type": "GroupChat"}
        prop["multiple"] = bool(field_def.get("multiple", False))
        prop = _merge_description(prop, field_def)
    elif t == "single_link":
        body = {"field_name": name, "type": 18, "ui_type": "SingleLink"}
        lk = field_def["link_table_key"]
        prop["table_id"] = table_ids[lk]
        prop["multiple"] = bool(field_def.get("multiple", False))
    elif t == "duplex_link":
        body = {"field_name": name, "type": 21, "ui_type": "DuplexLink"}
        lk = field_def["link_table_key"]
        prop["table_id"] = table_ids[lk]
        prop["back_field_name"] = field_def["back_field_name"]
        prop["multiple"] = bool(field_def.get("multiple", False))
    elif t == "auto_number":
        body = {"field_name": name, "type": 1005, "ui_type": "AutoNumber"}
        st = field_def.get("auto_serial_type") or "auto_increment_number"
        prop["auto_serial"] = {"type": st}
        prop = _merge_description(prop, field_def)
    else:
        raise ValueError(f"Unsupported template field type: {t!r} (field {name!r})")

    if prop:
        body["property"] = prop
    return body


def _defer_link_field_for_table_create(
    field_def: dict[str, Any],
    table_ids: dict[str, str],
    *,
    current_table_key: str,
) -> bool:
    """
    True if this link field cannot be sent on create_table yet.

    - Forward reference: linked table does not exist in ``table_ids``.
    - Self-reference: ``link_table_key == current_table_key`` — own ``table_id`` is
      not in ``table_ids`` until *after* create_table returns.
    """
    t = field_def.get("type")
    if t not in ("single_link", "duplex_link"):
        return False
    lk = field_def["link_table_key"]
    if lk not in table_ids:
        return True
    if lk == current_table_key:
        return True
    return False


def _drain_pending_link_fields(
    client: FeishuBitableClient,
    app_token: str,
    pending: list[tuple[str, dict[str, Any]]],
    table_ids: dict[str, str],
    field_map: dict[tuple[str, str], str],
) -> None:
    """Create cross-table link fields once ``link_table_key`` exists in ``table_ids``."""
    if not pending:
        return
    progress = True
    while progress:
        progress = False
        remaining: list[tuple[str, dict[str, Any]]] = []
        for tkey, fd in pending:
            lk = fd["link_table_key"]
            if lk in table_ids:
                _sleep()
                payload = template_field_to_api(fd, table_ids, current_table_key=tkey)
                tid = table_ids[tkey]
                fid = client.create_field(app_token, tid, payload)
                field_map[(tkey, fd["name"])] = fid
                _sync_field_map_from_remote(client, app_token, tkey, tid, field_map)
                progress = True
            else:
                remaining.append((tkey, fd))
        pending.clear()
        pending.extend(remaining)


def _register_fields_from_create(
    table_key: str,
    template_fields: list[dict[str, Any]],
    field_id_list: list[str],
    field_map: dict[tuple[str, str], str],
) -> None:
    if len(template_fields) != len(field_id_list):
        raise FeishuAPIError(
            f"field_id_list length mismatch for table {table_key}: "
            f"expected {len(template_fields)}, got {len(field_id_list)}",
            body={},
        )
    for fd, fid in zip(template_fields, field_id_list):
        field_map[(table_key, fd["name"])] = fid


def _sync_field_map_from_remote(
    client: FeishuBitableClient,
    app_token: str,
    table_key: str,
    table_id: str,
    field_map: dict[tuple[str, str], str],
) -> None:
    _sleep()
    for item in client.list_fields(app_token, table_id):
        fn = item.get("field_name")
        fid = item.get("field_id")
        if fn and fid:
            field_map[(table_key, str(fn))] = str(fid)


def _formula_payload(
    name: str,
    expression: str,
    *,
    data_type: int = 1,
    result_ui_type: str = "Number",
    description: str | None = None,
) -> dict[str, Any]:
    """Type 20 fields use top-level ui_type Formula; numeric display via property.type."""
    type_inner: dict[str, Any] = {"data_type": data_type}
    if result_ui_type == "Progress":
        type_inner["ui_property"] = {"min": 0, "max": 100, "range_customize": True}
    elif result_ui_type == "Number" and data_type == 2:
        type_inner["formatter"] = "0"
    prop: dict[str, Any] = {
        "formula_expression": expression,
        "type": type_inner,
    }
    if description:
        prop["description"] = {"disable_sync": True, "text": description}
    return {
        "field_name": name,
        "type": 20,
        "ui_type": "Formula",
        "property": prop,
    }


def _build_formula_expression(kind: str, field_map: dict[tuple[str, str], str], spec: dict[str, Any]) -> str:
    if kind == "counta_same_table":
        tkey = spec.get("table_key", "projects")
        fname = spec["source_field_name"]
        fid = field_map[(tkey, fname)]
        return f"COUNTA(bitable::$field[{fid}])"

    if kind == "concat_date_text_user":
        tkey = spec.get("table_key", "weekly")
        fd = field_map[(tkey, spec["date_field_name"])]
        fu = field_map[(tkey, spec["user_field_name"])]
        return (
            f'CONCATENATE(TEXT(bitable::$field[{fd}],"yyyy-MM-dd"),"-",'
            f"bitable::$field[{fu}])"
        )

    if kind == "user_field_display":
        tkey = spec.get("table_key", "members")
        fu = field_map[(tkey, spec["user_field_name"])]
        return f"CONCATENATE(bitable::$field[{fu}])"

    raise ValueError(f"Unknown formula_kind: {kind!r}")


ALLOWED_DEFAULT_VIEW_TYPES = frozenset({"grid", "gallery", "kanban", "gantt"})


def _resolved_view_type(
    client: FeishuBitableClient, app_token: str, table_id: str, view_id: str
) -> str | None:
    data = client.get_view(app_token, table_id, view_id)
    v = data.get("view")
    if isinstance(v, dict) and v.get("view_type"):
        return str(v.get("view_type"))
    return None


def _apply_default_view_config(
    client: FeishuBitableClient,
    app_token: str,
    table_key: str,
    table_id: str,
    spec: dict[str, Any],
    field_map: dict[tuple[str, str], str],
) -> None:
    """Optional: set default view type (gallery, etc.) and hidden_fields."""
    vtype = spec.get("default_view_type")
    hidden_names = spec.get("default_view_hidden_field_names")
    if not vtype and not hidden_names:
        return
    dvn = spec.get("default_view_name")
    if not dvn:
        return
    if vtype and str(vtype) not in ALLOWED_DEFAULT_VIEW_TYPES:
        raise ValueError(
            f"Table {table_key!r}: invalid default_view_type {vtype!r}; "
            f"expected one of {sorted(ALLOWED_DEFAULT_VIEW_TYPES)}"
        )
    _sleep()
    view_id: str | None = None
    for v in client.list_views(app_token, table_id):
        if str(v.get("view_name")) == str(dvn):
            vid = v.get("view_id")
            if vid:
                view_id = str(vid)
            break
    if not view_id:
        return

    target_vid = view_id

    if vtype and str(vtype) == "gallery":
        # PATCH view_type alone is often ignored; replace default grid with a new gallery view.
        _sleep()
        client.patch_view(app_token, table_id, target_vid, {"view_type": "gallery"})
        _sleep()
        if _resolved_view_type(client, app_token, table_id, target_vid) != "gallery":
            tmp_name = f"tmpgrid{int(time.time() * 1000)}"
            client.patch_view(app_token, table_id, target_vid, {"view_name": tmp_name})
            _sleep()
            target_vid = client.create_view(
                app_token,
                table_id,
                view_name=str(dvn),
                view_type="gallery",
            )
            _sleep()
            client.delete_view(app_token, table_id, view_id)
    elif vtype:
        _sleep()
        client.patch_view(app_token, table_id, target_vid, {"view_type": str(vtype)})

    if hidden_names:
        if not isinstance(hidden_names, list):
            raise ValueError(f"Table {table_key!r}: default_view_hidden_field_names must be a list")
        ids: list[str] = []
        for n in hidden_names:
            fid = field_map.get((table_key, str(n)))
            if not fid:
                raise FeishuAPIError(
                    f"default_view_hidden_field_names: unknown field {n!r} on table {table_key!r}",
                    body={},
                )
            ids.append(fid)
        _sleep()
        client.patch_view(
            app_token,
            table_id,
            target_vid,
            {"property": {"hidden_fields": ids}},
        )


def _run_after_provision_aux(
    client: FeishuBitableClient,
    template: dict[str, Any],
    app_token: str,
    table_ids: dict[str, str],
    *,
    is_cockpit_copy: bool = False,
) -> dict[str, Any]:
    """
    Optional `after_provision` on template: apply views/forms JSON (e.g. 职责 + 收集表).
    Paths are relative to repo root (same as default_template_path parent chain).

    is_cockpit_copy: when True, kanban grouping PATCH is skipped because the Base
    was copied from a golden template that already has correct grouping configured.
    The OpenAPI records_group PATCH is unreliable and would reset grouping to the
    first groupable field.
    """
    ap = template.get("after_provision")
    if not isinstance(ap, dict) or not ap:
        return {}
    repo = Path(__file__).resolve().parents[3]
    out: dict[str, Any] = {}
    vt_rel = ap.get("views_template")
    if vt_rel:
        p = repo / str(vt_rel).lstrip("/")
        if not p.is_file():
            raise FeishuAPIError(f"after_provision.views_template not found: {p}", body={})
        sub = load_view_template(p)
        keys_needed = {str(t["key"]) for t in (sub.get("tables") or [])}
        merged = {k: table_ids[k] for k in keys_needed if k in table_ids}
        if merged.keys() != keys_needed:
            raise FeishuAPIError(
                f"after_provision.views_template: need table_ids for {sorted(keys_needed)}, "
                f"missing {sorted(keys_needed - set(merged))}",
                body={},
            )
        sub["app_token"] = app_token
        sub["table_ids"] = merged
        _sleep()
        out["views_applied"] = provision_views_from_template(
            client, sub, app_token=app_token,
            skip_kanban_group_patch=is_cockpit_copy,
        )
    ft_rel = ap.get("forms_template")
    if ft_rel:
        p = repo / str(ft_rel).lstrip("/")
        if not p.is_file():
            raise FeishuAPIError(f"after_provision.forms_template not found: {p}", body={})
        sub = load_view_template(p)
        keys_needed = {str(t["key"]) for t in (sub.get("tables") or [])}
        merged = {k: table_ids[k] for k in keys_needed if k in table_ids}
        if merged.keys() != keys_needed:
            raise FeishuAPIError(
                f"after_provision.forms_template: need table_ids for {sorted(keys_needed)}, "
                f"missing {sorted(keys_needed - set(merged))}",
                body={},
            )
        sub["app_token"] = app_token
        sub["table_ids"] = merged
        _sleep()
        out["forms_applied"] = provision_forms_from_template(client, sub, app_token=app_token)
    return out


def _cockpit_without_content_flag() -> bool:
    v = (os.environ.get("FEISHU_COCKPIT_COPY_WITHOUT_CONTENT") or "false").strip().lower()
    return v not in ("0", "false", "no")


def _table_ids_match_template(
    client: FeishuBitableClient, app_token: str, tables_spec: list[dict[str, Any]]
) -> dict[str, str]:
    remote = client.list_tables(app_token)
    by_name: dict[str, str] = {}
    for t in remote:
        n = t.get("name")
        tid = t.get("table_id")
        if n and tid:
            by_name[str(n)] = str(tid)
    out: dict[str, str] = {}
    missing: list[str] = []
    for spec in tables_spec:
        key = str(spec["key"])
        want = str(spec["name"])
        if want not in by_name:
            missing.append(f"{key}→{want!r}")
        else:
            out[key] = by_name[want]
    if missing:
        have = ", ".join(sorted(by_name.keys()))
        raise FeishuAPIError(
            f"cockpit copy: tables missing or renamed (need {missing}). Remote table names: {have}",
            body={},
        )
    return out


def _field_map_from_remote_tables(
    client: FeishuBitableClient, app_token: str, table_ids: dict[str, str]
) -> dict[tuple[str, str], str]:
    fm: dict[tuple[str, str], str] = {}
    for key, tid in table_ids.items():
        for f in client.list_fields(app_token, tid):
            fn = f.get("field_name")
            fid = f.get("field_id")
            if fn and fid:
                fm[(key, str(fn))] = str(fid)
    return fm


def _provision_bitable_from_cockpit_copy(
    client: FeishuBitableClient,
    template: dict[str, Any],
    *,
    source_app_token: str,
    folder_token: str | None,
    bitable_name: str,
    grant_edit_open_chat_id: str | None,
    grant_edit_user_id: str | None,
    grant_edit_user_member_type: str,
    grant_manage_user_id: str | None = None,
    grant_manage_user_member_type: str = "userid",
    transfer_owner_user_id: str | None = None,
    transfer_owner_user_member_type: str = "userid",
) -> dict[str, Any]:
    """
    Copy a golden Base that already includes a hand-built 仪表盘 (and matching tables).

    OpenAPI has no create-dashboard; ``POST .../apps/:token/copy`` with
    ``without_content=True`` keeps structure + charts while clearing rows; template
    ``initial_records`` are re-applied when without_content is used.
    """
    wc = _cockpit_without_content_flag()
    tz = template.get("time_zone")
    tz_s = tz if isinstance(tz, str) else None
    last_err: FeishuAPIError | None = None
    app: dict[str, Any] | None = None
    for attempt in range(6):
        try:
            _sleep()
            app = client.copy_bitable(
                source_app_token.strip(),
                name=bitable_name,
                folder_token=folder_token,
                without_content=wc,
                time_zone=tz_s,
            )
            break
        except FeishuAPIError as e:
            last_err = e
            c = e.code
            if c is None and isinstance(e.body, dict):
                raw = e.body.get("code")
                if raw is not None:
                    try:
                        c = int(raw)
                    except (TypeError, ValueError):
                        c = None
            if c == 1254036:
                time.sleep(2.0 + attempt * 0.5)
                continue
            raise
    if app is None:
        assert last_err is not None
        raise last_err

    app_token = str(app["app_token"])
    tables_spec: list[dict[str, Any]] = template["tables"]
    order_keys = [t["key"] for t in tables_spec]

    _sleep()
    table_ids = _table_ids_match_template(client, app_token, tables_spec)

    if wc:
        for spec in tables_spec:
            key = spec["key"]
            init = spec.get("initial_records") or []
            if not init:
                continue
            tid = table_ids[str(key)]
            normalized: list[dict[str, Any]] = []
            for row in init:
                if not isinstance(row, dict) or "fields" not in row:
                    raise ValueError(
                        f"initial_records entries must be objects with a 'fields' map (table {key!r})"
                    )
                normalized.append({"fields": dict(row["fields"])})
            if normalized:
                _sleep()
                client.batch_create_records(app_token, tid, normalized)

    field_map = _field_map_from_remote_tables(client, app_token, table_ids)
    out_field_map = {f"{a}|{b}": v for (a, b), v in field_map.items()}
    out: dict[str, Any] = {
        "app": app,
        "table_ids": table_ids,
        "table_order": order_keys,
        "field_map": out_field_map,
        "provision_mode": "cockpit_copy",
        "cockpit_source_app_token": source_app_token.strip(),
        "cockpit_without_content": wc,
    }
    out.update(_run_after_provision_aux(client, template, app_token, table_ids, is_cockpit_copy=True))

    deleted_views: list[dict[str, str]] = []
    for spec in tables_spec:
        if not spec.get("delete_default_view_after_provision"):
            continue
        dvn = spec.get("default_view_name")
        if not dvn:
            continue
        key = spec["key"]
        tid = table_ids.get(key)
        if not tid:
            continue
        view_id: str | None = None
        for v in client.list_views(app_token, tid):
            if str(v.get("view_name", "")) == str(dvn):
                vid = v.get("view_id")
                if vid:
                    view_id = str(vid)
                break
        if view_id:
            _sleep()
            client.delete_view(app_token, tid, view_id)
            deleted_views.append({"table_key": str(key), "view_name": str(dvn), "view_id": view_id})
    if deleted_views:
        out["default_views_deleted"] = deleted_views

    chat = (grant_edit_open_chat_id or "").strip()
    if chat:
        _sleep()
        out["drive_grant_edit_chat"] = client.drive_add_collaborator(
            app["app_token"],
            member_type="openchat",
            member_id=chat,
            perm="edit",
            collaborator_type="chat",
        )
    uid = (grant_edit_user_id or "").strip()
    if uid:
        mt = (grant_edit_user_member_type or "userid").strip()
        _sleep()
        out["drive_grant_edit_user"] = client.drive_add_collaborator(
            app["app_token"],
            member_type=mt,
            member_id=uid,
            perm="edit",
            collaborator_type="user",
        )
    muid = (grant_manage_user_id or "").strip()
    if muid:
        mt = (grant_manage_user_member_type or "userid").strip()
        _sleep()
        out["drive_grant_manage_user"] = client.drive_add_collaborator(
            app["app_token"],
            member_type=mt,
            member_id=muid,
            perm="full_access",
            collaborator_type="user",
        )
    tuid = (transfer_owner_user_id or "").strip()
    if tuid:
        mt = (transfer_owner_user_member_type or "userid").strip()
        _sleep()
        out["drive_transfer_owner"] = client.drive_transfer_owner(
            app["app_token"],
            new_member_type=mt,
            new_member_id=tuid,
            old_owner_perm="full_access",
        )
    return out


def provision_bitable_from_template(
    client: FeishuBitableClient,
    template: dict[str, Any],
    *,
    folder_token: str | None = None,
    bitable_name: str | None = None,
    grant_edit_open_chat_id: str | None = None,
    grant_edit_user_id: str | None = None,
    grant_edit_user_member_type: str = "userid",
    grant_manage_user_id: str | None = None,
    grant_manage_user_member_type: str = "userid",
    transfer_owner_user_id: str | None = None,
    transfer_owner_user_member_type: str = "userid",
    cockpit_source_app_token: str | None = None,
) -> dict[str, Any]:
    """
    Create a new Bitable and apply template tables/fields/post_fields/formula_fields.

    Link columns on ``create_table``: forward references (link to a table not created yet) and
    self-references (``link_table_key`` equals the current table) are deferred — same-table links
    are added via ``create_field`` right after that table exists; cross-table links are flushed
    from a pending queue as soon as the target table appears.

    Optional per table: ``initial_records`` — list of ``{"fields": {field_name: value}}``;
    after all columns exist, provision calls ``batch_create_records`` (Feishu accepts field
    names and single_select option names in ``fields``).

    Returns dict with app, table_ids, field_map (serialized as nested dict keys "table|field").
    Optional: add edit collaborators via grant_edit_open_chat_id (group) and/or
    grant_edit_user_id (user; member_type e.g. userid, openid).
    """
    if int(template.get("schema_version", 1)) != 1:
        raise ValueError("Only schema_version 1 is supported")

    name = bitable_name or template.get("bitable_name") or "多维表格"
    cockpit_src = (cockpit_source_app_token or "").strip()
    if not cockpit_src:
        cockpit_src = (os.environ.get("FEISHU_COCKPIT_SOURCE_APP_TOKEN") or "").strip()
    if not cockpit_src:
        cockpit_src = (template.get("cockpit_source_app_token") or "").strip()
    if cockpit_src:
        return _provision_bitable_from_cockpit_copy(
            client,
            template,
            source_app_token=cockpit_src,
            folder_token=folder_token,
            bitable_name=name,
            grant_edit_open_chat_id=grant_edit_open_chat_id,
            grant_edit_user_id=grant_edit_user_id,
            grant_edit_user_member_type=grant_edit_user_member_type,
            grant_manage_user_id=grant_manage_user_id,
            grant_manage_user_member_type=grant_manage_user_member_type,
            transfer_owner_user_id=transfer_owner_user_id,
            transfer_owner_user_member_type=transfer_owner_user_member_type,
        )

    tz = template.get("time_zone")

    _sleep()
    app = client.create_bitable(name=name, folder_token=folder_token, time_zone=tz)
    app_token = app["app_token"]
    default_table_id = app["default_table_id"]

    table_ids: dict[str, str] = {}
    field_map: dict[tuple[str, str], str] = {}

    tables: list[dict[str, Any]] = template["tables"]
    order_keys = [t["key"] for t in tables]

    pending_link_fields: list[tuple[str, dict[str, Any]]] = []

    for spec in tables:
        key = spec["key"]
        immediate_fields: list[dict[str, Any]] = []
        deferred_same_table: list[dict[str, Any]] = []
        for fd in spec["fields"]:
            if _defer_link_field_for_table_create(fd, table_ids, current_table_key=key):
                if (fd.get("type") in ("single_link", "duplex_link")) and (
                    fd["link_table_key"] == key
                ):
                    deferred_same_table.append(fd)
                else:
                    pending_link_fields.append((key, fd))
            else:
                immediate_fields.append(fd)
        if not immediate_fields:
            raise ValueError(
                f"Table {key!r}: all fields are deferred links; "
                "add at least one non-link column for create_table, or reorder tables."
            )
        fields_api = [
            template_field_to_api(fd, table_ids, current_table_key=key) for fd in immediate_fields
        ]
        _sleep()
        data = client.create_table(
            app_token,
            name=spec["name"],
            default_view_name=spec["default_view_name"],
            fields=fields_api,
        )
        tid = str(data["table_id"])
        table_ids[key] = tid
        fids = data.get("field_id_list") or []
        if not isinstance(fids, list):
            raise FeishuAPIError("create_table missing field_id_list", body=data)
        _register_fields_from_create(key, immediate_fields, [str(x) for x in fids], field_map)
        _sync_field_map_from_remote(client, app_token, key, tid, field_map)

        for fd in deferred_same_table:
            _sleep()
            payload = template_field_to_api(fd, table_ids, current_table_key=key)
            fid = client.create_field(app_token, tid, payload)
            field_map[(key, fd["name"])] = fid
        if deferred_same_table:
            _sync_field_map_from_remote(client, app_token, key, tid, field_map)

        _drain_pending_link_fields(
            client,
            app_token,
            pending_link_fields,
            table_ids,
            field_map,
        )

    if pending_link_fields:
        keys = sorted({fd["link_table_key"] for _, fd in pending_link_fields})
        raise ValueError(
            "Unresolved link fields (target table never appeared in template): "
            f"{pending_link_fields!r}; missing table_keys like {keys}"
        )

    for spec in tables:
        k = spec["key"]
        _sync_field_map_from_remote(client, app_token, k, table_ids[k], field_map)

    if template.get("delete_default_table", True):
        _sleep()
        client.delete_table(app_token, default_table_id)

    for spec in tables:
        key = spec["key"]
        tid = table_ids[key]
        for pf in spec.get("post_fields") or []:
            _sleep()
            payload = template_field_to_api(
                pf,
                table_ids,
                current_table_key=key,
            )
            fid = client.create_field(app_token, tid, payload)
            field_map[(key, pf["name"])] = fid
        _sync_field_map_from_remote(client, app_token, key, tid, field_map)

    for spec in tables:
        key = spec["key"]
        tid = table_ids[key]
        for pf in spec.get("late_post_fields") or []:
            _sleep()
            payload = template_field_to_api(
                pf,
                table_ids,
                current_table_key=key,
            )
            fid = client.create_field(app_token, tid, payload)
            field_map[(key, pf["name"])] = fid
        _sync_field_map_from_remote(client, app_token, key, tid, field_map)

    for spec in tables:
        key = spec["key"]
        tid = table_ids[key]
        for ff in spec.get("formula_fields") or []:
            kind = ff["formula_kind"]
            expr = _build_formula_expression(kind, field_map, {**ff, "table_key": key})
            res = ff.get("result") or {}
            data_type = int(res.get("data_type", 2))
            result_ui = str(res.get("ui_type", "Number"))
            _sleep()
            payload = _formula_payload(
                ff["name"],
                expr,
                data_type=data_type,
                result_ui_type=result_ui,
                description=ff.get("description"),
            )
            try:
                fid = client.create_field(app_token, tid, payload)
                field_map[(key, ff["name"])] = fid
            except FeishuAPIError as e:
                raise FeishuAPIError(
                    f"Formula field {ff['name']!r} failed: {e}; "
                    "Check tenant formula_type or simplify expression in Feishu UI.",
                    code=e.code,
                    body=e.body,
                ) from e

    for spec in tables:
        key = spec["key"]
        init = spec.get("initial_records") or []
        if init:
            tid = table_ids[key]
            normalized: list[dict[str, Any]] = []
            for row in init:
                if not isinstance(row, dict) or "fields" not in row:
                    raise ValueError(
                        f"initial_records entries must be objects with a 'fields' map (table {key!r})"
                    )
                normalized.append({"fields": dict(row["fields"])})
            _sleep()
            client.batch_create_records(app_token, tid, normalized)

    for spec in tables:
        k = spec["key"]
        _apply_default_view_config(
            client,
            app_token,
            k,
            table_ids[k],
            spec,
            field_map,
        )

    out_field_map = {f"{a}|{b}": v for (a, b), v in field_map.items()}
    out: dict[str, Any] = {
        "app": app,
        "table_ids": table_ids,
        "table_order": order_keys,
        "field_map": out_field_map,
    }
    out.update(_run_after_provision_aux(client, template, app_token, table_ids))
    deleted_views: list[dict[str, str]] = []
    for spec in tables:
        if not spec.get("delete_default_view_after_provision"):
            continue
        dvn = spec.get("default_view_name")
        if not dvn:
            continue
        key = spec["key"]
        tid = table_ids.get(key)
        if not tid:
            continue
        view_id: str | None = None
        for v in client.list_views(app_token, tid):
            if str(v.get("view_name", "")) == str(dvn):
                vid = v.get("view_id")
                if vid:
                    view_id = str(vid)
                break
        if view_id:
            _sleep()
            client.delete_view(app_token, tid, view_id)
            deleted_views.append({"table_key": key, "view_name": str(dvn), "view_id": view_id})
    if deleted_views:
        out["default_views_deleted"] = deleted_views

    chat = (grant_edit_open_chat_id or "").strip()
    if chat:
        _sleep()
        out["drive_grant_edit_chat"] = client.drive_add_collaborator(
            app["app_token"],
            member_type="openchat",
            member_id=chat,
            perm="edit",
            collaborator_type="chat",
        )
    uid = (grant_edit_user_id or "").strip()
    if uid:
        mt = (grant_edit_user_member_type or "userid").strip()
        _sleep()
        out["drive_grant_edit_user"] = client.drive_add_collaborator(
            app["app_token"],
            member_type=mt,
            member_id=uid,
            perm="edit",
            collaborator_type="user",
        )
    muid = (grant_manage_user_id or "").strip()
    if muid:
        mt = (grant_manage_user_member_type or "userid").strip()
        _sleep()
        out["drive_grant_manage_user"] = client.drive_add_collaborator(
            app["app_token"],
            member_type=mt,
            member_id=muid,
            perm="full_access",
            collaborator_type="user",
        )
    tuid = (transfer_owner_user_id or "").strip()
    if tuid:
        mt = (transfer_owner_user_member_type or "userid").strip()
        _sleep()
        out["drive_transfer_owner"] = client.drive_transfer_owner(
            app["app_token"],
            new_member_type=mt,
            new_member_id=tuid,
            old_owner_perm="full_access",
        )
    return out
