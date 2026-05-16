# Vendored Lark CLI Assets

This directory contains NanoClaw runtime assets derived from the Lark CLI project.

Rules:

1. Runtime code must only read from `vendor/lark-cli`, not from `../../cli`.
2. Update vendored assets via `npm run sync:lark-cli`.
3. Host-side credentials remain outside this directory. This folder only stores the binary and skill docs.
