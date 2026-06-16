# NanoClaw 2.0 Runtime Rework

This directory documents the runtime architecture for NanoClaw 2.0: a host-direct, multi-tenant, Linux-user-isolated runtime that replaces the previous Docker-per-agent-service model.

## Current Direction

The design is finalised in [`docs/superpowers/specs/2026-06-16-multi-tenant-host-direct-isolation-design.md`](../superpowers/specs/2026-06-16-multi-tenant-host-direct-isolation-design.md). This directory mirrors the design as authoritative project documentation (decision record, target architecture, cross-cutting contracts). When the two disagree, the spec is the source of truth — fix the docs here.

The previous V1.x → V2.0 plan (Docker-per-agent-service) is archived at [`docs/runtime-rework-archived/`](../runtime-rework-archived/). Decisions recorded there are no longer authoritative.

## Target Architecture at a Glance

```text
NanoClaw host (bare-metal systemd service OR one Docker container)
├── Control plane process (uid=nanoclaw-svc, no capabilities)
│   ├── HTTP webhook server: POST /<tenant>/<agent>/<channel>/event
│   ├── channels: per-(tenant, agent) Feishu / Slack / Telegram / ... clients
│   ├── router, scheduler, sender/trigger policy
│   ├── tool workers (host-side: Feishu, approval, file, task APIs)
│   ├── tenant config loader
│   ├── run lifecycle manager (spawn, monitor, reap, kill, idle-reap)
│   └── run spawner → invokes nc-setuid-helper
├── nc-setuid-helper (SUID root binary, ~500 lines C)
└── Run processes (uid=ncg-<tenant>-<agent>-<group>)
    └── agent-runner (Claude / OpenCode / mock provider)
```

Key shifts from V1.x plan:

- **Isolation unit**: Linux user `ncg-<tenant>-<agent>-<group>`. Docker is an optional deployment wrapper, not a security boundary.
- **Process topology**: Single control plane process directly spawns runs via the SUID helper. No supervisor process in the initial implementation.
- **Multi-tenant, multi-agent per host**: One NanoClaw instance supports many tenants and many agents. Each (tenant, agent) tuple may have its own external channel identity.
- **Webhook routing**: URL path `/<tenant>/<agent>/<channel>/event` is the routing key for a single shared HTTP server.
- **Two-tier credential model**: LLM credentials (internal gateway, low risk) injected via env. Channel credentials (real external) stay host-side, accessed via tool IPC.
- **Clean replacement**: No `docker-per-group` fallback. A one-shot migration script handles the cutover.

## Documents in This Directory

| Document | Purpose |
|----------|---------|
| [ADR.md](./ADR.md) | Architecture Decision Record. Authoritative; supersedes `runtime-rework-archived/ADR.md`. |
| [TARGET_ARCHITECTURE_DETAILS.md](./TARGET_ARCHITECTURE_DETAILS.md) | Component responsibilities, data flows, message/task/tool/skill sequences. |
| [CROSS_CUTTING_CONTRACTS.md](./CROSS_CUTTING_CONTRACTS.md) | Behaviour that spans implementation phases: message metadata, cursor rules, authorization gates, tool inventory. |

Implementation-phase documents (version sequence, concrete coding tasks) are produced by the implementation plan and live alongside this directory when written.

## Guiding Rules

- Do not mix tenant business code with platform code.
- Channel credentials (Feishu `app_secret`, Slack tokens, etc.) never leave the control plane process memory or `0600` files. Run processes access channels via tool IPC only.
- LLM credentials may be injected via env at spawn time (internal gateway, low risk if leaked outside).
- Linux user isolation protects runtime data: chat history, continuation, generated skills.
- Privileged operations (`setuid`, signal, cgroup) only through `nc-setuid-helper`. The control plane holds no Linux capabilities.
- Move IPC to SQLite queues (`inbound.db`, `outbound.db`, `state.db`, `tools.db`).
- Provider differences stay behind `AgentProvider`.
- Implementation tests must cover every isolation boundary before the runtime is considered shippable.

## Existing Code Hotspots

Code that the rework will touch or replace:

| File | Current role |
|------|--------------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Singleton-keyed channel registry (must move to composite `(tenant, agent, type)` keys) |
| `src/channels/feishu.ts` | Singleton Feishu channel (must become multi-instance per (tenant, agent)) |
| `src/feishu/auth.ts` | Hardcoded credential file path (must accept per-tenant path) |
| `src/feishu/client.ts` | Per-instance FeishuClient (already state-safe for multi-instance) |
| `src/container-runner.ts` | Spawns Docker containers — to be replaced by `nc-setuid-helper` invocation |
| `src/group-queue.ts` | Active group process tracking |
| `src/task-scheduler.ts` | Cron tasks with `context_mode` semantics |
| `src/ipc.ts` | Legacy file IPC watcher — to be replaced by DB IPC + tool workers |
| `src/db.ts` | Central SQLite (stays authoritative for routing, tasks, cursors) |
| `src/router.ts` | Message formatting and outbound routing |
| `src/credential-proxy.ts` | Anthropic credential proxy (no longer needed under two-tier model; will be removed or repurposed) |
| `container/agent-runner/src/index.ts` | Container entrypoint (becomes the run process entrypoint, invoked by SUID helper) |

## Migration

A single one-shot migration script handles the cutover. No fallback mode is provided. See the spec's "Migration" section for the transformation table and verification steps.

Before running the migration in production:

1. Validate the dry-run report end-to-end.
2. Back up all source data.
3. Confirm `verify:migration` passes.
4. Have a rollback-by-restore plan (file-level backup restoration) — there is no in-process rollback.
