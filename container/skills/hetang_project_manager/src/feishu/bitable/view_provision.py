"""Apply JSON templates to create Bitable views or form views (PATCH optional).

默认路径下的 `single_project/single_project.*.json` 与荷塘 **单独项目管理** skill 对齐。
"""

from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Any, Literal

from feishu.bitable.client import FeishuBitableClient
from feishu.exceptions import FeishuAPIError

THROTTLE_SEC = 0.35

ViewKind = Literal["views", "forms"]

NON_FORM_VIEW_TYPES = frozenset({"grid", "kanban", "gallery", "gantt"})


def _sleep() -> None:
    time.sleep(THROTTLE_SEC)


def default_views_template_path() -> Path:
    """单独项目管理默认视图模板（`single_project/single_project.views.json`）。"""
    return (
        Path(__file__).resolve().parents[3]
        / "templates"
        / "feishu"
        / "hetang"
        / "bitable"
        / "single_project"
        / "single_project.views.json"
    )


def default_forms_template_path() -> Path:
    """单独项目管理默认表单模板（`single_project/single_project.forms.json`）。"""
    return (
        Path(__file__).resolve().parents[3]
        / "templates"
        / "feishu"
        / "hetang"
        / "bitable"
        / "single_project"
        / "single_project.forms.json"
    )


def load_view_template(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def _field_name_to_id_map(client: FeishuBitableClient, app_token: str, table_id: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in client.list_fields(app_token, table_id):
        fn = item.get("field_name")
        fid = item.get("field_id")
        if fn and fid:
            out[str(fn)] = str(fid)
    return out


def _list_fields_and_name_to_id(
    client: FeishuBitableClient, app_token: str, table_id: str
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    rows = client.list_fields(app_token, table_id)
    nid: dict[str, str] = {}
    for item in rows:
        fn = item.get("field_name")
        fid = item.get("field_id")
        if fn and fid:
            nid[str(fn)] = str(fid)
    return rows, nid


def _field_type_for_field_name(rows: list[dict[str, Any]], field_name: str) -> int | None:
    for item in rows:
        if str(item.get("field_name", "")) != field_name:
            continue
        t = item.get("type")
        if t is None:
            return None
        try:
            return int(t)
        except (TypeError, ValueError):
            return None
    return None


def _records_group_variant_entries(field_id: str, field_type: int | None) -> list[list[dict[str, Any]]]:
    """Try several shapes; Feishu tenants differ on optional field_type / desc."""
    variants: list[list[dict[str, Any]]] = []
    if field_type is not None:
        variants.append([{"field_id": field_id, "field_type": field_type, "desc": False}])
        variants.append([{"field_id": field_id, "field_type": field_type}])
    variants.append([{"field_id": field_id, "desc": False}])
    variants.append([{"field_id": field_id}])
    return variants


def _resolve_patch_field_refs(patch: dict[str, Any], name_to_id: dict[str, str]) -> dict[str, Any]:
    """Replace field_name / hidden_field_names with API field_id / hidden_fields."""

    def need_id(name: str) -> str:
        fid = name_to_id.get(name)
        if not fid:
            known = ", ".join(sorted(name_to_id.keys())[:20])
            more = "" if len(name_to_id) <= 20 else ", ..."
            raise FeishuAPIError(
                f"Unknown field name {name!r} for this table. Known fields: {known}{more}",
                body={},
            )
        return fid

    out = copy.deepcopy(patch)
    prop = out.get("property")
    if isinstance(prop, dict):
        fi = prop.get("filter_info")
        if isinstance(fi, dict):
            conds = fi.get("conditions")
            if isinstance(conds, list):
                for c in conds:
                    if not isinstance(c, dict):
                        continue
                    if not c.get("field_id"):
                        fname = c.pop("field_name", None)
                        if fname:
                            c["field_id"] = need_id(str(fname))
                    else:
                        c.pop("field_name", None)
        hidden_names = prop.pop("hidden_field_names", None)
        if hidden_names is not None:
            if not isinstance(hidden_names, list):
                raise FeishuAPIError("property.hidden_field_names must be a list", body={})
            prop["hidden_fields"] = [need_id(str(n)) for n in hidden_names]
    return out


def _merge_kanban_patch_with_server_property(
    client: FeishuBitableClient,
    app_token: str,
    table_id: str,
    view_id: str,
    resolved: dict[str, Any],
) -> dict[str, Any]:
    """GET current view.property and overlay patch.property so PATCH keeps server-only keys."""
    _sleep()
    vd = client.get_view(app_token, table_id, view_id)
    view_inner = vd.get("view") if isinstance(vd, dict) else {}
    sp = view_inner.get("property") if isinstance(view_inner, dict) else None
    server_prop = dict(sp) if isinstance(sp, dict) else {}
    patch_prop = resolved.get("property")
    if not isinstance(patch_prop, dict):
        return resolved
    merged_prop = {**server_prop, **patch_prop}
    out = {k: v for k, v in resolved.items() if k != "property"}
    out["property"] = merged_prop
    return out


def _patch_kanban_with_fallbacks(
    client: FeishuBitableClient,
    app_token: str,
    table_id: str,
    view_id: str,
    resolved: dict[str, Any],
    *,
    group_field_id: str,
    field_type: int | None,
) -> None:
    """PATCH kanban grouping with several ``records_group`` shapes; merge or raw body per try."""
    base_prop = resolved.get("property")
    if not isinstance(base_prop, dict):
        base_prop = {}
    rest_prop = {k: v for k, v in base_prop.items() if k != "records_group"}
    last_err: FeishuAPIError | None = None
    for rg in _records_group_variant_entries(group_field_id, field_type):
        prop = {**rest_prop, "records_group": rg}
        body: dict[str, Any] = {k: v for k, v in resolved.items() if k != "property"}
        body["property"] = prop
        for do_merge in (True, False):
            try:
                _sleep()
                to_send = (
                    _merge_kanban_patch_with_server_property(
                        client, app_token, table_id, view_id, body
                    )
                    if do_merge
                    else body
                )
                client.patch_view(app_token, table_id, view_id, to_send)
                return
            except FeishuAPIError as e:
                last_err = e
    if last_err:
        raise last_err


def _inject_kanban_group_field(
    patch: dict[str, Any],
    *,
    view_type: str,
    name_to_id: dict[str, str],
    field_type: int | None = None,
) -> None:
    """If patch contains ``kanban_group_field_name``, merge ``property.records_group`` (OpenAPI shape may vary)."""
    if view_type != "kanban":
        return
    gname = patch.pop("kanban_group_field_name", None)
    if not gname:
        return
    fid = name_to_id.get(str(gname))
    if not fid:
        known = ", ".join(sorted(name_to_id.keys())[:30])
        raise FeishuAPIError(
            f"kanban_group_field_name: unknown field {gname!r}. Known fields include: {known}",
            body={},
        )
    prop = dict(patch.get("property") or {})
    entry: dict[str, Any] = {"field_id": fid, "desc": False}
    if field_type is not None:
        entry["field_type"] = field_type
    prop["records_group"] = [entry]
    patch["property"] = prop


def _find_view_id_by_name(
    client: FeishuBitableClient, app_token: str, table_id: str, view_name: str
) -> str | None:
    for v in client.list_views(app_token, table_id):
        if str(v.get("view_name", "")) == view_name:
            vid = v.get("view_id")
            return str(vid) if vid else None
    return None


def _apply_entries_for_table(
    client: FeishuBitableClient,
    app_token: str,
    table_key: str,
    table_id: str,
    entries: list[dict[str, Any]],
    *,
    kind: ViewKind,
    skip_kanban_group_patch: bool = False,
) -> list[dict[str, Any]]:
    field_rows, name_to_id = _list_fields_and_name_to_id(client, app_token, table_id)
    results: list[dict[str, Any]] = []

    for raw in entries:
        view_name = str(raw["view_name"])
        if kind == "forms":
            view_type = "form"
        else:
            view_type = str(raw.get("view_type") or "grid")
            if view_type not in NON_FORM_VIEW_TYPES:
                raise ValueError(
                    f"Table {table_key!r} view {view_name!r}: invalid view_type {view_type!r}; "
                    f"expected one of {sorted(NON_FORM_VIEW_TYPES)}"
                )

        gname: str | None = None
        if kind != "forms" and view_type == "kanban" and isinstance(raw.get("patch"), dict):
            raw_g = raw["patch"].get("kanban_group_field_name")
            if raw_g:
                gname = str(raw_g)
        ft = _field_type_for_field_name(field_rows, gname) if gname else None

        skip = bool(raw.get("skip_if_exists"))
        view_id: str | None = None
        reused = False
        if skip:
            view_id = _find_view_id_by_name(client, app_token, table_id, view_name)
            if view_id:
                reused = True
        if not view_id:
            _sleep()
            created_with_prop = False
            if (
                view_type == "kanban"
                and isinstance(raw.get("patch"), dict)
                and raw["patch"].get("kanban_group_field_name")
            ):
                pc = copy.deepcopy(raw["patch"])
                _inject_kanban_group_field(
                    pc, view_type=view_type, name_to_id=name_to_id, field_type=ft
                )
                rc = _resolve_patch_field_refs(pc, name_to_id)
                pr = rc.get("property")
                if isinstance(pr, dict) and pr.get("records_group"):
                    try:
                        view_id = client.create_view(
                            app_token,
                            table_id,
                            view_name=view_name,
                            view_type=view_type,
                            view_property=pr,
                        )
                        created_with_prop = True
                    except FeishuAPIError:
                        view_id = None
            if not view_id:
                view_id = client.create_view(
                    app_token, table_id, view_name=view_name, view_type=view_type
                )
            if view_type == "kanban":
                time.sleep(1.0 if not created_with_prop else 0.35)

        patch = raw.get("patch")
        if patch:
            p = copy.deepcopy(patch)
            # When copying from a golden template the kanban grouping is already
            # set correctly in the source Base.  Attempting to re-PATCH
            # records_group via OpenAPI is unreliable (returns 200 but reverts to
            # the first groupable field).  Strip kanban_group_field_name from the
            # patch so only non-grouping properties (e.g. hidden_fields) are sent.
            if skip_kanban_group_patch and view_type == "kanban":
                p.pop("kanban_group_field_name", None)
                prop_p = p.get("property")
                if isinstance(prop_p, dict):
                    prop_p.pop("records_group", None)
                # If nothing left to patch, skip entirely
                if not p or p == {"property": {}}:
                    results.append(
                        {
                            "table_key": table_key,
                            "table_id": table_id,
                            "view_name": view_name,
                            "view_id": view_id,
                            "view_type": view_type,
                            "reused_existing": reused,
                        }
                    )
                    continue
            _inject_kanban_group_field(
                p, view_type=view_type, name_to_id=name_to_id, field_type=ft
            )
            resolved = _resolve_patch_field_refs(p, name_to_id)
            _sleep()
            prop = resolved.get("property")
            if (
                not skip_kanban_group_patch
                and view_type == "kanban"
                and isinstance(prop, dict)
                and prop.get("records_group")
            ):
                rg0 = prop["records_group"]
                if (
                    not rg0
                    or not isinstance(rg0, list)
                    or not isinstance(rg0[0], dict)
                    or not rg0[0].get("field_id")
                ):
                    raise FeishuAPIError("kanban records_group missing field_id", body={})
                fid = str(rg0[0]["field_id"])
                _patch_kanban_with_fallbacks(
                    client,
                    app_token,
                    table_id,
                    view_id,
                    resolved,
                    group_field_id=fid,
                    field_type=ft,
                )
            else:
                client.patch_view(app_token, table_id, view_id, resolved)

        results.append(
            {
                "table_key": table_key,
                "table_id": table_id,
                "view_name": view_name,
                "view_id": view_id,
                "view_type": view_type,
                "reused_existing": reused,
            }
        )
    return results


def _merge_table_ids(template: dict[str, Any], override: dict[str, str] | None) -> dict[str, str]:
    base = dict(template.get("table_ids") or {})
    if override:
        base.update(override)
    return base


def apply_view_template(
    client: FeishuBitableClient,
    template: dict[str, Any],
    *,
    app_token: str | None = None,
    table_ids_override: dict[str, str] | None = None,
    kind: ViewKind,
    skip_kanban_group_patch: bool = False,
) -> dict[str, Any]:
    """
    Create views or form views per template.

    Template keys:
      schema_version: must be 1
      app_token: optional if passed as argument
      table_ids: map table_key -> table_id (e.g. members -> tbl...)
      tables: [{ key, views?: [...] }] or [{ key, forms?: [...] }] depending on kind

    skip_kanban_group_patch: when True, kanban ``records_group`` PATCH is skipped.
      Use this when the Base was copied from a golden template that already has
      correct grouping — the OpenAPI PATCH for records_group is unreliable and
      would overwrite the correct grouping with the first groupable field.
    """
    if int(template.get("schema_version", 1)) != 1:
        raise ValueError("Only schema_version 1 is supported")

    token = (app_token or template.get("app_token") or "").strip()
    if not token:
        raise ValueError("app_token required (template.app_token or argument)")

    table_ids = _merge_table_ids(template, table_ids_override)
    specs: list[dict[str, Any]] = template.get("tables") or []
    if not isinstance(specs, list):
        raise ValueError("template.tables must be a list")

    all_results: list[dict[str, Any]] = []
    for spec in specs:
        key = str(spec["key"])
        tid = table_ids.get(key)
        if not tid:
            raise ValueError(f"Missing table_ids[{key!r}] — fill template or pass override")

        if kind == "forms":
            entries = spec.get("forms") or []
            label = "forms"
        else:
            entries = spec.get("views") or []
            label = "views"
        if not isinstance(entries, list):
            raise ValueError(f"tables[].{label} must be a list for key={key!r}")
        if not entries:
            continue

        all_results.extend(
            _apply_entries_for_table(
                client, token, key, tid, entries, kind=kind,
                skip_kanban_group_patch=skip_kanban_group_patch,
            )
        )

    return {
        "app_token": token,
        "kind": kind,
        "views_created": all_results,
    }


def provision_views_from_template(
    client: FeishuBitableClient,
    template: dict[str, Any],
    *,
    app_token: str | None = None,
    table_ids_override: dict[str, str] | None = None,
    skip_kanban_group_patch: bool = False,
) -> dict[str, Any]:
    return apply_view_template(
        client,
        template,
        app_token=app_token,
        table_ids_override=table_ids_override,
        kind="views",
        skip_kanban_group_patch=skip_kanban_group_patch,
    )


def provision_forms_from_template(
    client: FeishuBitableClient,
    template: dict[str, Any],
    *,
    app_token: str | None = None,
    table_ids_override: dict[str, str] | None = None,
) -> dict[str, Any]:
    return apply_view_template(
        client,
        template,
        app_token=app_token,
        table_ids_override=table_ids_override,
        kind="forms",
    )
