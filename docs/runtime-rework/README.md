# NanoClaw 2.0 Runtime Rework

This directory documents the runtime architecture for NanoClaw 2.0: a host-direct, multi-tenant, Linux-user-isolated runtime that replaces the previous Docker-per-agent-service model.

## Current Direction

The design is finalised in [`docs/superpowers/specs/2026-06-16-multi-tenant-host-direct-isolation-design.md`](../superpowers/specs/2026-06-16-multi-tenant-host-direct-isolation-design.md). This directory mirrors the design as authoritative project documentation (decision record, target architecture, cross-cutting contracts). When the two disagree, the spec is the source of truth — fix the docs here.

The previous V1.x → V2.0 plan (Docker-per-agent-service) is archived at [`docs/runtime-rework-archived/`](../runtime-rework-archived/). Decisions recorded there are no longer authoritative.

## Target Architecture at a Glance

```text
NanoClaw deployment (single Docker image OR equivalent pod)
├── Control plane process (uid=nanoclaw-svc, no capabilities)
│   ├── HTTP webhook server: POST /<tenant>/<agent>/<channel>/event
│   ├── channels: per-(tenant, agent) Feishu / Slack / Telegram / ... clients
│   ├── router, scheduler, sender/trigger policy
│   ├── tool workers (host-side: Feishu, approval, file, task APIs)
│   ├── tenant config loader
│   ├── run lifecycle manager (prepare, spawn, monitor, reap, kill, idle-reap)
│   └── run spawner → invokes nc-setuid-helper
├── nc-setuid-helper (SUID root binary, ~500 lines C)
└── Run processes (uid=mapped ncg-* user for tenant/agent/group)
    └── agent-runner (Claude / OpenCode / mock provider)
```

Key shifts from V1.x plan:

- **Isolation unit**: one mapped `ncg-*` Linux user per `(tenant, agent, group)` inside a single NanoClaw Docker image or equivalent pod. Docker/Kubernetes is the packaging boundary, not one security boundary per tenant, agent, or group.
- **Docker deployment**: default operational profile is one long-running container with `--privileged`, SUID enabled, persistent `/var/lib/nanoclaw`, and writable/delegated cgroup v2 access; tighter profiles must pass helper and isolation tests.
- **Process topology**: Single control plane process directly spawns runs via the SUID helper. No supervisor process in the initial implementation.
- **Multi-tenant, multi-agent per host**: One NanoClaw instance supports many tenants and many agents. Each (tenant, agent) tuple may have its own external channel identity.
- **Webhook routing**: URL path `/<tenant>/<agent>/<channel>/event` is the routing key for a single shared HTTP server.
- **Two-tier credential model**: LLM credentials are internal-gateway credentials accepted only by NanoClaw's internal LLM gateway, so they may be injected via env. Channel credentials (real external) stay host-side, accessed via tool IPC.
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
- LLM credentials may be injected via env at spawn time because the agent calls an internal LLM gateway with an internal credential that is not usable against the external provider or from outside the internal network.
- Secret references are typed: only `llm:` refs may enter run envs; `channel:` refs are control-plane-only.
- Linux user isolation plus per-runtime ACLs protect runtime data: chat history, continuation, generated skills.
- Tenant/agent skills are exposed to runs only through per-run read-only resolved bundles, never world-readable tenant paths.
- Privileged operations (`prepare`, `setuid`, signal, cgroup) only through `nc-setuid-helper`. The control plane holds no Linux capabilities.
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
| `src/feishu/auth.ts` | Hardcoded credential file path (must resolve typed refs under `/var/lib/nanoclaw/auth/tenants/<tenant>/<agent>/`) |
| `src/feishu/client.ts` | Per-instance FeishuClient (already state-safe for multi-instance) |
| `src/container-runner.ts` | Spawns Docker containers — to be replaced by `nc-setuid-helper` invocation |
| `src/group-queue.ts` | Active group process tracking |
| `src/task-scheduler.ts` | Cron tasks with `context_mode` semantics |
| `src/ipc.ts` | Legacy file IPC watcher — to be replaced by DB IPC + tool workers |
| `src/db.ts` | Control-plane SQLite, target shape is per-`(tenant, agent)` DBs with channel-scoped routing, tasks, and cursors |
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
