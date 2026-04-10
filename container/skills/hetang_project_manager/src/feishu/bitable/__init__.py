"""Feishu 多维表格 (Bitable) API.

默认模板路径（`default_template_path` / `default_*_template_path`）对应荷塘 **单独项目管理** skill 的 `single_project/*.json`。
"""

from feishu.bitable.client import FeishuBitableClient
from feishu.credentials import resolve_app_credentials
from feishu.bitable.provision import (
    default_template_path,
    hetang_bitable_template_path,
    load_template,
    provision_bitable_from_template,
)
from feishu.bitable.view_provision import (
    default_forms_template_path,
    default_views_template_path,
    load_view_template,
    provision_forms_from_template,
    provision_views_from_template,
)

__all__ = [
    "FeishuBitableClient",
    "resolve_app_credentials",
    "default_template_path",
    "hetang_bitable_template_path",
    "load_template",
    "provision_bitable_from_template",
    "default_views_template_path",
    "default_forms_template_path",
    "load_view_template",
    "provision_views_from_template",
    "provision_forms_from_template",
]
