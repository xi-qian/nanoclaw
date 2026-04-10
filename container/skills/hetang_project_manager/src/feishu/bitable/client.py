"""Bitable (多维表格): tenant token and app creation."""

from __future__ import annotations

import os
import time
from typing import Any
from urllib.error import URLError

from feishu.const import DEFAULT_BASE_URL
from feishu.credentials import resolve_app_credentials
from feishu.exceptions import FeishuAPIError
from feishu.http_util import request_json as _http_request_json


class FeishuBitableClient:
    """
    Minimal client for tenant_access_token and POST /open-apis/bitable/v1/apps.

    Credentials (first match wins):
      constructor ``app_id`` / ``app_secret``;
      env ``FEISHU_APP_ID`` / ``FEISHU_APP_SECRET``;
      JSON file: ``FEISHU_CONFIG_PATH``, or ``./feishu.local.json``, or ``./config/feishu.local.json``.
    """

    def __init__(
        self,
        app_id: str | None = None,
        app_secret: str | None = None,
        base_url: str | None = None,
        *,
        config_path: str | None = None,
    ):
        self.app_id, self.app_secret = resolve_app_credentials(
            app_id=app_id,
            app_secret=app_secret,
            config_path=config_path,
        )
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def _bearer_headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        }

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> dict[str, Any]:
        m = method.upper()
        send = json_body if m in ("POST", "PUT", "PATCH") and json_body is not None else None
        try:
            status, body, snippet = _http_request_json(
                self.base_url,
                m,
                path,
                headers=headers,
                params=params,
                json_body=send,
                timeout=timeout,
            )
        except URLError as e:
            raise FeishuAPIError(f"HTTP request failed: {e}") from e

        if status >= 400:
            msg = body.get("msg") if isinstance(body, dict) else None
            if not msg:
                msg = f"HTTP {status}: {snippet!r}"
            code = body.get("code") if isinstance(body, dict) else None
            raise FeishuAPIError(
                msg,
                code=int(code) if code is not None else None,
                body=body if isinstance(body, dict) else {},
            )

        code = body.get("code")
        if code != 0:
            raise FeishuAPIError(
                body.get("msg") or f"API error code {code}",
                code=int(code) if code is not None else None,
                body=body,
            )
        return body

    def get_tenant_access_token(self, *, force_refresh: bool = False) -> str:
        """Obtain tenant_access_token (cached until shortly before expiry)."""
        now = time.time()
        if not force_refresh and self._token and now < self._token_expires_at - 60:
            return self._token

        body = self._request_json(
            "POST",
            "/open-apis/auth/v3/tenant_access_token/internal",
            json_body={"app_id": self.app_id, "app_secret": self.app_secret},
        )
        token = body.get("tenant_access_token")
        if not token or not isinstance(token, str):
            raise FeishuAPIError("Missing tenant_access_token in response", body=body)

        expire = int(body.get("expire") or 7200)
        self._token = token
        self._token_expires_at = now + max(expire, 60)
        return token

    def create_bitable(
        self,
        *,
        name: str | None = None,
        folder_token: str | None = None,
        time_zone: str | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a new Bitable app (one default empty table).

        See: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create

        Returns the `app` object: app_token, name, folder_token, url, default_table_id, time_zone.
        """
        access = token or self.get_tenant_access_token()
        payload: dict[str, Any] = {}
        if name is not None:
            payload["name"] = name
        if folder_token is not None:
            payload["folder_token"] = folder_token
        elif os.environ.get("FEISHU_FOLDER_TOKEN"):
            payload["folder_token"] = os.environ["FEISHU_FOLDER_TOKEN"].strip()
        if time_zone is not None:
            payload["time_zone"] = time_zone

        body = self._request_json(
            "POST",
            "/open-apis/bitable/v1/apps",
            headers=self._bearer_headers(access),
            json_body=payload,
        )
        data = body.get("data") or {}
        app = data.get("app")
        if not isinstance(app, dict):
            raise FeishuAPIError("Missing data.app in create response", body=body)
        return app

    def copy_bitable(
        self,
        source_app_token: str,
        *,
        name: str | None = None,
        folder_token: str | None = None,
        without_content: bool = False,
        time_zone: str | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        """
        POST /bitable/v1/apps/:app_token/copy — duplicate a Base (structure + optional row data).

        Use a hand-built template Base (e.g. with 仪表盘) as ``source_app_token``; set
        ``without_content=True`` for empty rows while keeping views/dashboards.

        See: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/copy
        """
        access = token or self.get_tenant_access_token()
        payload: dict[str, Any] = {"without_content": without_content}
        if name is not None:
            payload["name"] = name
        if folder_token is not None:
            payload["folder_token"] = folder_token
        elif os.environ.get("FEISHU_FOLDER_TOKEN"):
            payload["folder_token"] = os.environ["FEISHU_FOLDER_TOKEN"].strip()
        if time_zone is not None:
            payload["time_zone"] = time_zone

        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{source_app_token.strip()}/copy",
            headers=self._bearer_headers(access),
            json_body=payload,
        )
        data = body.get("data") or {}
        app = data.get("app")
        if not isinstance(app, dict):
            raise FeishuAPIError("Missing data.app in copy_bitable response", body=body)
        return app

    def list_tables(
        self,
        app_token: str,
        *,
        token: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """GET /bitable/v1/apps/:app_token/tables — paginated."""
        access = token or self.get_tenant_access_token()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            body = self._request_json(
                "GET",
                f"/open-apis/bitable/v1/apps/{app_token}/tables",
                headers=self._bearer_headers(access),
                params=params,
            )
            data = body.get("data") or {}
            items.extend(data.get("items") or [])
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            if not page_token:
                break
        return items

    def list_dashboards(
        self,
        app_token: str,
        *,
        token: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """GET /bitable/v1/apps/:app_token/dashboards — block_id + name."""
        access = token or self.get_tenant_access_token()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            body = self._request_json(
                "GET",
                f"/open-apis/bitable/v1/apps/{app_token}/dashboards",
                headers=self._bearer_headers(access),
                params=params,
            )
            data = body.get("data") or {}
            raw = data.get("dashboards")
            if isinstance(raw, list):
                items.extend(raw)
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            if not page_token:
                break
        return items

    def copy_dashboard(
        self,
        app_token: str,
        block_id: str,
        new_name: str,
        *,
        token: str | None = None,
    ) -> dict[str, Any]:
        """
        POST .../dashboards/:block_id/copy — duplicate a dashboard within the same Base.

        See: https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-dashboard/copy
        """
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{app_token}/dashboards/{block_id.strip()}/copy",
            headers=self._bearer_headers(access),
            json_body={"name": new_name},
        )
        data = body.get("data") or {}
        if not isinstance(data, dict):
            raise FeishuAPIError("Missing data in copy_dashboard response", body=body)
        return data

    def delete_table(self, app_token: str, table_id: str, *, token: str | None = None) -> None:
        access = token or self.get_tenant_access_token()
        self._request_json(
            "DELETE",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}",
            headers=self._bearer_headers(access),
        )

    def create_table(
        self,
        app_token: str,
        *,
        name: str,
        default_view_name: str,
        fields: list[dict[str, Any]],
        token: str | None = None,
    ) -> dict[str, Any]:
        """POST /bitable/v1/apps/:app_token/tables. Returns data: table_id, field_id_list, ..."""
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{app_token}/tables",
            headers=self._bearer_headers(access),
            json_body={
                "table": {
                    "name": name,
                    "default_view_name": default_view_name,
                    "fields": fields,
                }
            },
        )
        data = body.get("data")
        if not isinstance(data, dict):
            raise FeishuAPIError("Missing data in create_table response", body=body)
        return data

    def batch_create_records(
        self,
        app_token: str,
        table_id: str,
        records: list[dict[str, Any]],
        *,
        token: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        POST .../records/batch_create — up to 1000 records per call.

        Each item in ``records`` is ``{"fields": {<field_name>: value, ...}}`` per OpenAPI
        (field keys are field names; single_select values are option names).
        """
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create",
            headers=self._bearer_headers(access),
            json_body={"records": records},
        )
        data = body.get("data") or {}
        recs = data.get("records")
        if not isinstance(recs, list):
            raise FeishuAPIError("Missing data.records in batch_create_records response", body=body)
        return recs

    def create_field(
        self,
        app_token: str,
        table_id: str,
        field: dict[str, Any],
        *,
        token: str | None = None,
    ) -> str:
        """POST .../fields. Returns new field_id."""
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
            headers=self._bearer_headers(access),
            json_body=field,
        )
        data = body.get("data") or {}
        field_obj = data.get("field")
        if isinstance(field_obj, dict) and field_obj.get("field_id"):
            return str(field_obj["field_id"])
        fid = data.get("field_id")
        if fid:
            return str(fid)
        raise FeishuAPIError("Missing field_id in create_field response", body=body)

    def list_fields(
        self,
        app_token: str,
        table_id: str,
        *,
        token: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        access = token or self.get_tenant_access_token()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            body = self._request_json(
                "GET",
                f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields",
                headers=self._bearer_headers(access),
                params=params,
            )
            data = body.get("data") or {}
            items.extend(data.get("items") or [])
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            if not page_token:
                break
        return items

    def list_views(
        self,
        app_token: str,
        table_id: str,
        *,
        token: str | None = None,
        page_size: int = 100,
    ) -> list[dict[str, Any]]:
        """GET .../tables/:table_id/views — paginated."""
        access = token or self.get_tenant_access_token()
        items: list[dict[str, Any]] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": page_size}
            if page_token:
                params["page_token"] = page_token
            body = self._request_json(
                "GET",
                f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/views",
                headers=self._bearer_headers(access),
                params=params,
            )
            data = body.get("data") or {}
            items.extend(data.get("items") or [])
            if not data.get("has_more"):
                break
            page_token = data.get("page_token")
            if not page_token:
                break
        return items

    def create_view(
        self,
        app_token: str,
        table_id: str,
        *,
        view_name: str,
        view_type: str,
        view_property: dict[str, Any] | None = None,
        token: str | None = None,
    ) -> str:
        """POST .../views. Returns new view_id.

        ``view_property`` is optional (e.g. kanban ``records_group``); not in all OpenAPI
        doc revisions but accepted by current Feishu in many tenants.
        """
        access = token or self.get_tenant_access_token()
        payload: dict[str, Any] = {"view_name": view_name, "view_type": view_type}
        if view_property:
            payload["property"] = view_property
        body = self._request_json(
            "POST",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/views",
            headers=self._bearer_headers(access),
            json_body=payload,
        )
        data = body.get("data") or {}
        view = data.get("view")
        if isinstance(view, dict) and view.get("view_id"):
            return str(view["view_id"])
        vid = data.get("view_id")
        if vid:
            return str(vid)
        raise FeishuAPIError("Missing view_id in create_view response", body=body)

    def patch_view(
        self,
        app_token: str,
        table_id: str,
        view_id: str,
        patch_body: dict[str, Any],
        *,
        token: str | None = None,
    ) -> dict[str, Any]:
        """PATCH .../views/:view_id — merge filter, hidden fields, etc."""
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "PATCH",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/views/{view_id}",
            headers=self._bearer_headers(access),
            json_body=patch_body,
        )
        data = body.get("data") or {}
        return data if isinstance(data, dict) else {}

    def get_view(
        self,
        app_token: str,
        table_id: str,
        view_id: str,
        *,
        token: str | None = None,
    ) -> dict[str, Any]:
        """GET .../views/:view_id — returns `data` (contains `view`)."""
        access = token or self.get_tenant_access_token()
        body = self._request_json(
            "GET",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/views/{view_id}",
            headers=self._bearer_headers(access),
        )
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    def delete_view(
        self,
        app_token: str,
        table_id: str,
        view_id: str,
        *,
        token: str | None = None,
    ) -> None:
        """DELETE .../views/:view_id"""
        access = token or self.get_tenant_access_token()
        self._request_json(
            "DELETE",
            f"/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/views/{view_id}",
            headers=self._bearer_headers(access),
        )

    def drive_add_collaborator(
        self,
        doc_token: str,
        *,
        doc_type: str = "bitable",
        member_type: str,
        member_id: str,
        perm: str = "edit",
        collaborator_type: str = "chat",
        need_notification: bool = False,
        token: str | None = None,
    ) -> dict[str, Any]:
        """
        POST /drive/v1/permissions/:token/members?type=bitable|...

        For a group: member_type=openchat, collaborator_type=chat, member_id=open_chat_id.
        For a user: member_type=openid|userid|unionid, collaborator_type=user.
        See: https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create
        """
        access = token or self.get_tenant_access_token()
        params: dict[str, Any] = {"type": doc_type}
        if need_notification:
            params["need_notification"] = "true"
        body = self._request_json(
            "POST",
            f"/open-apis/drive/v1/permissions/{doc_token}/members",
            headers=self._bearer_headers(access),
            params=params,
            json_body={
                "member_type": member_type,
                "member_id": member_id,
                "perm": perm,
                "type": collaborator_type,
            },
        )
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    def drive_transfer_owner(
        self,
        doc_token: str,
        *,
        new_member_type: str,
        new_member_id: str,
        doc_type: str = "bitable",
        remove_old_owner: bool = False,
        old_owner_perm: str | None = None,
        stay_put: bool | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        """
        POST /drive/v1/permissions/:token/members/transfer_owner?type=bitable

        See: https://open.feishu.cn/document/server-docs/docs/permission/permission-member/transfer_owner
        """
        access = token or self.get_tenant_access_token()
        params: dict[str, Any] = {
            "type": doc_type,
            "remove_old_owner": "true" if remove_old_owner else "false",
        }
        if old_owner_perm:
            params["old_owner_perm"] = old_owner_perm
        if stay_put is not None:
            params["stay_put"] = "true" if stay_put else "false"
        body = self._request_json(
            "POST",
            f"/open-apis/drive/v1/permissions/{doc_token}/members/transfer_owner",
            headers=self._bearer_headers(access),
            params=params,
            json_body={
                "member_type": new_member_type,
                "member_id": new_member_id,
            },
        )
        data = body.get("data")
        return data if isinstance(data, dict) else {}
