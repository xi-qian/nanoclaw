# Cross-cutting Contracts

This document captures behaviour that spans implementation phases. The phase plan defines when work happens; this file defines behaviour that must not be lost while moving from the V1.x runtime to the V2.0 host-direct multi-tenant runtime.

Implementation phases are produced by the implementation plan. Read this document before implementing any phase.

## Current Source Inventory

Code that the rework will touch or replace:

**Control plane (host-side, current process)**:

- `src/index.ts` — orchestrator: state, message loop, agent invocation. Channel callbacks, sender filtering, auto-registration, message cursors, typing indicators, scheduler/IPC/reporter wiring.
- `src/db.ts` — current central SQLite for chats, messages, scheduled tasks, task run logs, router cursors, sessions, registered groups. Target shape is one control-plane SQLite DB per `(tenant, agent)`, with channel-scoped keys inside each DB.
- `src/router.ts` — channel ownership lookup and XML prompt formatting (sender IDs, attachments, card actions, timezone context).
- `src/group-queue.ts` — per-group concurrency, follow-up message reuse, retry backoff, idle close, active process tracking.
- `src/task-scheduler.ts` — `context_mode` semantics and isolated task runs.
- `src/sender-allowlist.ts`, `src/approval-allowlist.ts` — host-side authorization gates.
- `src/mount-security.ts` — external mount allowlist and non-main read-only policy.
- `src/remote-control.ts` — main-group host process for Claude remote control.
- `src/reporter/*` — monitor/local API, group memory and skill editing.

**Runtime launch and filesystem (to be replaced by host-direct + SUID helper)**:

- `src/container-runner.ts` — Docker args, mounts, per-group `.claude`, task/group snapshots, output sentinel parsing, idle timeout handling.
- `src/container-runtime.ts` — Docker runtime selection, host gateway, read-only mount helpers, orphan cleanup.
- `src/group-folder.ts` — folder validation and runtime path resolution.
- `src/credential-proxy.ts` — Anthropic credential proxy (no longer needed under two-tier model; will be removed or repurposed).

**Channels and Feishu (to become multi-instance per (tenant, agent))**:

- `src/channels/registry.ts` — singleton-keyed registry. Will move to composite `(tenant, agent, type)` keys.
- `src/channels/feishu.ts` — singleton Feishu channel. Will become multi-instance.
- `src/feishu/auth.ts` — hardcoded credential file path. Will resolve typed refs under `/var/lib/nanoclaw/auth/tenants/<tenant>/<agent>/`.
- `src/feishu/client.ts` — per-instance client. Already state-safe for multi-instance.

**IPC, tools, and host-only capabilities**:

- `src/ipc.ts` — legacy file IPC watcher for messages, scheduling, group registration, session reset, Feishu tools, approvals, uploads/downloads, P2P chat auto-registration.
- `container/agent-runner/src/ipc-mcp-stdio.ts` — MCP tool definitions that write legacy IPC files and wait for result files.
- `container/agent-runner/src/index.ts` — container entrypoint. Becomes the run process entrypoint, invoked by SUID helper.

**Setup and operations**:

- `setup/*` — setup, status, service, verify, environment, container, group registration flows.
- Docker image entrypoint, Kubernetes manifests, `deploy.sh`, and legacy launchd/systemd wrappers — service management.
- Root config: `.env`, `approval-allowlist.json`, `~/.config/nanoclaw/*.json`.

## Host DB and Runtime DB

The control-plane source of truth is partitioned by `(tenant, agent)`: each agent service has its own host DB, e.g. `/var/lib/nanoclaw/data/tenants/<tenant>/<agent>/messages.db`. Per-run runtime DBs are durable queues and state for one live run or isolated task; they are not a replacement for host routing state.

Tenant and agent are the physical DB partition. `channel_type` remains a required logical key inside each DB because one agent may bind multiple channels whose chat IDs, message IDs, cursor formats, and timestamp ordering are independent.

### Central DB ownership

- `chats` — channel/chat discovery and names. Identity is `(channel_type, jid)` within the per-agent DB.
- `messages` — authoritative inbound history, bot-message filtering, attachments, card actions, scheduled task linkage. Uniqueness includes `channel_type` plus the channel message identity.
- `scheduled_tasks`, `task_run_logs` — task source of truth and audit.
- `router_state` — per-channel `last_timestamp` and per-`(channel_type, chat_jid)` `last_agent_timestamp`.
- `sessions` — legacy Claude session IDs until provider state is fully runtime-scoped. Keys must not be bare JIDs; use runtime group identity.
- `registered_groups` — group-folder routing, trigger config, JID/channel ownership. Identity is `(channel_type, jid)` within the per-agent DB.
- `active_runs` — run lifecycle identity for restart reconciliation and kill/status validation: `pid`, `/proc/<pid>/stat` start time ticks, expected uid, runtime dir, cgroup path, tenant, agent, group, and run id.

### Runtime DB ownership

- `inbound.db` — claimed work for one run.
- `outbound.db` — delivery requests emitted by one run.
- `state.db` — run-local control keys and provider continuation. Also used for per-run audit (model, tokens, latency, status).
- `tools.db` — tool requests generated by one run.

Do not let both DB layers independently decide routing progress. The host must advance and roll back cursors in one place.

### Cursor rules

- `last_timestamp[channel_type]` means "messages from this channel seen by the host message loop".
- `last_agent_timestamp[channel_type, chat_jid]` means "latest user message from this channel/chat successfully handed to an agent run or active run".
- If an agent run fails before any user-visible output is delivered, roll back `last_agent_timestamp[channel_type, chat_jid]` so the next run can retry the same messages.
- If output was delivered and a later provider error happens, do not roll back the cursor (would risk duplicate replies).
- Runtime inbound rows should carry `channel_type` and source message IDs so retries are idempotent.

## Message Metadata Contract

DB-backed IPC must preserve all metadata that currently reaches the prompt or delivery layer.

### Inbound records

- tenant ID, agent ID, group folder, chat JID, channel type/name (required routing identity)
- source message ID or scheduled task ID
- sender ID, sender name, `is_from_me`, trigger reason
- content, timestamp, message type, attachment JSON, card action JSON
- dedupe key, attempt count

### Outbound records

- tenant ID, agent ID, group folder, chat JID, channel type/name (required routing identity)
- source inbound IDs or tool request ID
- text content, optional sender/persona, message type, attachment path/key
- delivery status, channel message ID, error, retry count, idempotency key

The host outbound poller is responsible for channel delivery, typing indicator cleanup, and any central DB updates needed for audit.

## Routing and Authorization

These gates stay host-side. A run process can request work or tools, but the control plane must validate identity and policy before executing.

### Inbound message gates

- Channel ownership via composite key `(tenant, agent, channelType)`.
- Registered group lookup (now scoped by tenant).
- Auto-registration when enabled (tenant-scoped).
- Sender allowlist drop mode before storing content.
- Trigger allowlist for non-main groups.
- Card actions bypass normal trigger delay and enqueue immediately.

### Group privileges

- Main group can register groups, refresh group metadata, operate across groups within its tenant.
- Non-main groups can only send/schedule/update/cancel for themselves unless a tenant policy explicitly grants more.
- P2P chats created by `send_to_user` retain `source_group` for authorization and audit.

### Tool gates

- Scheduling tools enforce main/self authorization.
- Approval tools enforce `approval-allowlist.json`.
- Feishu and other channel tools execute on the host side where channel credentials live.
- Additional mounts use the external mount allowlist and blocked-pattern policy.

## Tenant, Agent, and Group Configuration

### Tenant config requirements

`tenant.json` must provide:

- `id` — tenant identifier (max 16 chars, `[a-z][a-z0-9-]*`)
- `name` — display name
- `enabled` — boolean

### Agent config requirements

`agent.json` must provide:

- `id` — agent identifier (max 16 chars, `[a-z][a-z0-9-]*`)
- `tenant` — parent tenant ID
- `provider` — `claude`, `opencode`, or `mock`
- `model` — provider-specific model identifier
- `instructions` — path to instructions file
- `skills` — list of skill references (`builtin:`, `tenant:`, `agent:`)
- `channels` — list of channel types this agent uses
- `envRefs` — list of typed LLM secret references (`llm:<name>`) resolved at load time; channel secrets are not valid run env refs
- `limits` — resource limits (memoryMb, pids, concurrentTasksPerGroup)

### Group representation

A group is the runtime representation of a chat — identified by `(tenant, agent, channel_type, chat_jid)`. Host DBs are already partitioned by `(tenant, agent)`, so `registered_groups` is keyed by `(channel_type, jid)` inside each per-agent DB. Fields that must round-trip through migration:

- JID and channel ownership (`channel_type`, channel-specific chat ID)
- display name
- folder (mapped to `<tenant>/<agent>/<group>` runtime path)
- trigger pattern
- `requiresTrigger`
- `isMain`
- `containerConfig.timeout` (becomes `limits`)
- `containerConfig.additionalMounts` (classified agent-wide vs group-specific; see below)
- P2P metadata if present: `is_p2p`, `p2p_user`, `source_group`

## Additional Mounts

Current additional mounts are declared per group and validated against `~/.config/nanoclaw/mount-allowlist.json`. In the new runtime, one control plane can serve multiple groups, so mount scope matters.

Rules:

- Agent-wide mounts are visible to every group handled by that agent.
- Group-specific mounts must be mounted under a per-group path and permissioned to that group user, or rejected.
- Non-main read-only policy must remain enforced.
- Blocked secret patterns stay blocked even if a tenant config requests them.
- Host `.env` and other secret files must remain shadowed or unmounted.
- `/workspace/extra/*` behaviour used by Claude `additionalDirectories` must be mapped deliberately for every provider.

## Secrets and Provider Credentials

Two-tier credential threat model (ADR-024):

- **LLM credentials (low risk)**: point at NanoClaw's internal LLM gateway. The agent connects to the internal gateway endpoint with an internal credential that is accepted only inside the internal network, not to a public LLM provider endpoint. Delivered via env at spawn time. No proxy, no scoped tokens. Still kept in `0600` files under `/var/lib/nanoclaw/auth/tenants/<tenant>/<agent>/llm/credentials.json` for general hygiene.
- **Channel credentials (high risk)**: real external credentials. Live only in `0600` files owned by `nanoclaw-svc` under `/var/lib/nanoclaw/auth/tenants/<tenant>/<agent>/<channel>/credentials.json` and in control plane process memory. Run processes access channels via tool IPC.
- **Runtime data (high risk)**: chat history, continuation, generated skills, downloaded files. Protected by Linux user ownership, `0700` runtime directories, and per-runtime POSIX ACLs that grant only `nanoclaw-svc` access.

Secret references are typed:

- `llm:<name>` may resolve into a run environment.
- `channel:<name>` may resolve only inside the control plane.
- Unknown or untyped refs fail config validation.

Do not put real channel credentials into:

- tenant repositories
- runtime DB rows
- control plane shared environment (only specific run envs)
- logs
- group-readable snapshots

## Mutable Runner and Group-local Customization

NanoClaw V1.x copies `container/agent-runner/src` into a per-group writable path and mounts it as `/app/src`. That self-modification mechanism does **not** carry into V2.0.

Final rule:

- Platform runner, helper, and provider code is image/distribution-owned and read-only.
- Group-created behaviour lives in group-generated skills or group memory files.
- Tenant/agent skills are reviewed inputs and exposed read-only through a per-run resolved skill bundle under the run runtime directory. They must not be copied into world-readable `/opt` paths.
- Runtime-generated skills remain under the group runtime directory until explicit promotion.

Reporter/local API methods that edit skills or memory must write to the new generated skill root or group memory path, never to tenant skill repositories.

## Tool Inventory That Must Migrate

Tool IPC migration moves tools from legacy file IPC to `tools.db`. The inventory:

- `send_message`
- `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task`, `update_task`
- `new_session`
- `register_group`, `refresh_groups`
- Feishu docs: fetch, create, update, delete, search
- Feishu bitable: app/table/field/record CRUD and listing
- Feishu permissions/collaboration/ownership/public settings
- Feishu card/rich text sends
- Feishu resource download and file send
- Feishu P2P/user tools: send to user, user department/name lookup
- Feishu task and tasklist operations
- Approval query/get/approve/reject/transfer/comment

For downloads/uploads, DB rows should reference files by controlled runtime file IDs or paths under the run's `files/` or `downloads/` directory. Avoid returning host paths to run processes.

## Provider Parity Checks

The Claude provider currently relies on behaviour that must either be preserved or explicitly documented as unsupported for other providers:

- session resume and session-not-found recovery
- `resumeSessionAt` / last assistant UUID behaviour
- PreCompact transcript archive to `conversations/`
- additional directories and `CLAUDE.md` loading
- MCP server inheritance by subagents
- agent teams tools
- allowed tool set and permission mode
- streaming result markers and null-result session updates
- follow-up messages pushed during active query

OpenCode may implement these differently, but the provider adapter must expose a stable result, continuation, error, and follow-up contract to the poll loop.

## Host-only Operations

Keep these outside run processes:

- `/remote-control` and `/remote-control-end`
- setup/status/verify/service management
- channel connection and credential refresh
- reporter websocket/local API server
- orphan cleanup (legacy Docker containers; new runtime has no orphans in the same sense)
- migration commands

The final runtime status command should include host process state, active runs, queue depth, helper health, and (post-migration) verify output.

## Deployment Wrapper Requirements

The reference production deployment is a single NanoClaw Docker image. Run one long-lived container per NanoClaw instance, not one container per tenant, agent, or group.

Docker image configuration must provide:

- A privilege profile that allows the helper to do its narrow job. The default operational profile is `--privileged`; a hardened profile must still allow SUID execution, `setuid/setgid`, signalling mapped `ncg-*` processes, POSIX ACL changes, and cgroup v2 writes.
- `no_new_privileges` disabled, so `/usr/lib/nanoclaw/nc-setuid-helper` can execute as SUID root.
- Persistent `/var/lib/nanoclaw` storage backed by a filesystem with POSIX ACL support.
- Writable or delegated cgroup v2 access at `/sys/fs/cgroup/nanoclaw/`.
- Container-local user/group management, or an equivalent helper-owned local user database, so `prepare` can create mapped `ncg-*` users.
- Separate mounts for tenant repositories and auth storage when operators want independent backup and rotation policies.

Kubernetes uses one equivalent pod per NanoClaw instance with matching `securityContext`, persistent volume, ACL support, and cgroup v2 delegation.

The default Docker profile is `--privileged --security-opt no-new-privileges:false --cgroupns=host` with persistent `/var/lib/nanoclaw` and writable `/sys/fs/cgroup` mounts. A tighter runtime profile is acceptable only after the helper operations and isolation test suite pass under that profile.

## Cleanup and Migration Data

The one-shot migration command must classify and either transform or back up:

- `groups/<group>/CLAUDE.md` and other group memory files → `tenants/<t>/agents/<name>/instructions.md` + `agent.json`
- `groups/<group>/logs` → `logs/<t>/<a>/<group>/`
- `store/auth/feishu/credentials.json` → `/var/lib/nanoclaw/auth/tenants/<t>/<name>/feishu/credentials.json`
- `data/ipc/<group>/**` → backed up only; not migrated (file IPC unsupported in V2.0)
- `data/sessions/<group>/.claude` → repacked into runtime `state.db`
- `data/sessions/<group>/agent-runner-src` → dropped (platform code is shared)
- `data/sessions/<group>/isolated-ipc-*` → dropped
- `data/nanoclaw.db`, `data/messages.db`, `store/messages.db` → split into per-`(tenant, agent)` host DBs under `/var/lib/nanoclaw/data/tenants/<tenant>/<agent>/`; legacy sources without tenant/agent identity use `tenant=<configured-default>` and `agent=<folder>`
- `chats`, `messages`, `registered_groups`, `router_state`, `sessions`, `scheduled_tasks` → populate `channel_type` wherever the table stores channel/chat/message identity; legacy single-channel rows default to the source channel (for example `feishu`)
- `approval-allowlist.json` → retained (host-side policy)
- `~/.config/nanoclaw/mount-allowlist.json` → retained
- `~/.config/nanoclaw/sender-allowlist.json` → retained

Do not delete legacy runtime data during migration unless the operator passes an explicit cleanup flag. The migration is one-shot; restoration is by file-level backup recovery.

## Acceptance Gates

Before declaring V2.0 shippable:

- Normal messages do not duplicate or skip replies across control plane restarts.
- Triggered and non-triggered messages preserve current behaviour.
- Sender allowlist drop and trigger modes still work.
- Card actions still enqueue immediately.
- Group and isolated scheduled tasks preserve context semantics.
- `new_session` clears the correct provider continuation.
- Main/self authorization is enforced for message, task, group, and approval tools.
- File download/send works without exposing host paths or secrets.
- Reporter skill/memory edits target the new runtime paths.
- Remote control remains main-group-only and host-side.
- Run process cannot read another run's runtime DBs.
- Run process cannot read channel credentials.
- Run process cannot read another tenant/agent's resolved skill bundle.
- `nanoclaw-svc` and the mapped run user can both read/write runtime DB files and SQLite sidecars created by either process.
- Run process env contains only typed `llm:` credentials and run config — no `channel:` secrets.
- Webhook routing distinguishes (tenant, agent) tuples correctly.
- Helper prepares users/runtime dirs idempotently, rejects tuple-to-username collisions, rejects PID start-time/cgroup/runtime-dir mismatches, and rejects out-of-scope spawn/kill/cgroup requests.
- Restart reconciliation treats PID reuse as stale and never kills a process unless PID, start time, expected UID, runtime dir, and cgroup all match the active-run record.
- Migration dry-run produces an accurate transformation report; verify passes after migration.
