"""Errors shared across Feishu Open API clients."""

from __future__ import annotations


class FeishuAPIError(Exception):
    """Open API returned a non-zero code or an unexpected payload."""

    def __init__(self, message: str, *, code: int | None = None, body: dict | None = None):
        super().__init__(message)
        self.code = code
        self.body = body or {}
