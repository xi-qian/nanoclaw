# Runtime Rework Architecture Decision Record

This is the authoritative decision record for NanoClaw 2.0. The previous record at [`../runtime-rework-archived/ADR.md`](../runtime-rework-archived/ADR.md) is retained for historical reference but is no longer authoritative.

Decisions marked **Reversed** or **Deleted** were valid for the V1.x plan and have been superseded. Decisions marked **Revised** retain their original intent with an updated mechanism. New decisions introduced by the 2.0 design carry IDs from ADR-021.

## ADR-001: Do Tenant and Skill Boundary Before Runtime Isolation

Decision: Split platform code from tenant/agent-service/business skills before implementing the runtime.

Reason:

- Tenant is a deployment, configuration, and skill-management layer.
- Runtime mount and permission policy depends on whether a path is platform code, tenant-managed config, agent-service config, group runtime state, or secret state.
- Doing runtime first would make permission rules guesswork and cause rework.

Status: Accepted. Unchanged from V1.x.

## ADR-002: ~~Keep Per-group Docker Runtime Until New Runtime Has Parity~~

Original decision: Introduce `RuntimeDriver` and keep `docker-per-group` as default until Version 2.0.

Reason for reversal: The 2.0 design is a clean replacement. Maintaining both `docker-per-group` and `host-direct` runtimes doubles the test surface and complicates every cross-cutting change. Operators validate via the migration dry-run, not via parallel runtimes.

Status: **Reversed 2026-06-16.** No `docker-per-group` fallback is provided. Migration is one-shot.

## ADR-003: Use DB-backed IPC as the New Core IPC

Decision: Move core host-agent/group message exchange to SQLite `inbound.db`, `outbound.db`, `state.db`, and `tools.db`.

Reason:

- File queues and sentinel files are fragile with warm processes and isolated tasks.
- SQLite gives durable status, retry, ordering, and audit trails.

Status: Accepted. Unchanged from V1.x. Implementation paths updated to `/var/lib/nanoclaw/runtime/<tenant>/<agent>/<group>/`.

## ADR-004: ~~Preserve Legacy File IPC Temporarily~~

Original decision: Keep old file IPC as a compatibility layer while migrating business tools.

Reason for deletion: Clean replacement. The migration script moves what can be moved; legacy file IPC directories are backed up but not supported in the new runtime.

Status: **Deleted 2026-06-16.**

## ADR-005': Linux User Is the Isolation Unit; Docker Is an Optional Deployment Wrapper

Supersedes ADR-005 (one Docker container per agent service, per-group Linux users inside).

Decision: Each run process runs as a distinct Linux user `ncg-<tenant>-<agent>-<group>` directly on the host. Docker, when used, wraps the entire NanoClaw deployment (control plane + helper + run processes) as a single container for portability. It is not a security boundary.

Reason:

- Docker adds no credential isolation on top of Linux user separation. Different UIDs already give different security domains via process memory isolation, `/proc/<pid>/environ` restrictions, and file permissions.
- Deployment convenience favours one NanoClaw instance serving many tenants and agents over N Docker services.
- The real protection targets are channel credentials and tenant runtime data — both of which Linux user isolation handles.

Tradeoff:

- Weaker than one container per group: no per-group kernel namespace, no per-group network namespace by default.
- Same kernel-exploit threat surface as Docker (both share the host kernel).

Status: Accepted 2026-06-16.

## ADR-006: Isolated Task Uses Same Group User

Decision: An isolated task runs as the same Linux user as its parent group, but with its own runtime directory, DBs, continuation, and lifecycle.

Reason:

- Current semantics mean fresh context, not stronger security.
- The task should access the same files and tools the group can access.
- Creating a separate user per task would complicate ownership and not match product semantics.

Status: Accepted. Unchanged.

## ADR-007: Isolated Task Must Not Reuse Live Continuation

Decision: `context_mode: "isolated"` must not read or write the live chat continuation.

Reason:

- Current behavior is fresh session/no chat history.
- Task prompts must be self-contained.
- Prevents scheduled/background work from polluting live conversation context.

Status: Accepted. Unchanged.

## ADR-008': Control Plane Owns Lifecycle Policy; Privileged Mechanism Encapsulated in SUID Helper

Revises ADR-008 (supervisor owns group process lifecycle).

Decision: The control plane process owns run lifecycle **policy** — when to spawn, monitor, reap, kill, and reconcile. Privileged **mechanism** (`setuid`, signal, cgroup) is encapsulated in `nc-setuid-helper`, a SUID root binary invokable only by `nanoclaw-svc`. The control plane holds no Linux capabilities.

Reason:

- Two Linux rules shape the split: `waitpid` ignores UID (control plane can reap its child whose UID was changed by the helper), but `kill` requires same-UID or privilege (control plane cannot signal `ncg-*` processes).
- Keeping the privilege surface in a single small auditable binary is cleaner than running the entire control plane with elevated capabilities.
- The supervisor-process approach (ADR-008 original, plus V1.x plan) is a future extension, not the initial implementation.

Status: Accepted 2026-06-16. The original ADR-008 design is listed under "Future extensions" in the spec.

## ADR-009: Provider Differences Stay Behind AgentProvider

Decision: Claude, OpenCode, and future providers must implement `AgentProvider`; scheduler/router must not contain provider-specific branches.

Reason:

- Claude Agent SDK and OpenCode have different session, hooks, tool, and event models.
- Keeping provider differences isolated prevents runtime code from becoming provider-specific.

Status: Accepted. Unchanged.

## ADR-010: OpenCode Is Optional Before It Is Default

Decision: OpenCode provider is added as an option first. Claude remains available.

Reason:

- OpenCode reduces overhead for simple workloads but is not a drop-in equivalent for Claude Agent SDK.
- Hooks, resume, and subagent behavior differ.
- Production deployments need fallback.

Status: Accepted. Unchanged.

## ADR-011: Secrets Stay Host-side; Two-tier Credential Threat Model

Sharpens the original ADR-011 (secrets stay host/supervisor-side).

Decision: Tenant repositories may reference secrets but may not store secret values. Channel credentials (`app_secret`, bot tokens) live only in `0600` files owned by `nanoclaw-svc` and in control plane process memory; run processes access channels via tool IPC. LLM credentials, because they target an internal gateway and are useless if leaked outside, may be injected directly via env at spawn time.

Reason:

- Business skill repositories may be shared or versioned.
- Channel credentials are real external credentials; leaking them enables tenant impersonation and data exfiltration.
- LLM credentials target an internal gateway; even if a `ncg-*` process leaks them, they cannot be used outside the internal network.

Status: Accepted. Sharpened 2026-06-16 by ADR-024.

## ADR-012: No World-writable Runtime IPC

Decision: Runtime directories must not rely on `0777` directories or `0666` files.

Reason:

- World-writable IPC defeats Linux user isolation.
- Per-group ownership plus shared `nc-runtime` group access (containing only `nanoclaw-svc`) is the intended security boundary.

Status: Accepted. Unchanged.

## ADR-013: Registered Groups Are Not the Same as Active Runs

Decision: Capacity planning and runtime status must distinguish configured groups from active runs.

Reason:

- Stopped idle groups should consume no RAM.
- The new architecture optimizes active light workloads.
- Scheduling and monitoring need queue/run state, not only group registration state.

Status: Accepted. Unchanged.

## ADR-015: Tenant Skills Enter Runtime as Read-only Agent Inputs

Decision: Tenant-managed and agent-managed skills are resolved during deployment/config loading and exposed to run processes as read-only inputs. Run processes can read these skills but cannot modify them.

Reason:

- Tenant is a management layer, not the runtime isolation unit.
- One control plane can serve multiple groups that share the agent's configured skill set.
- Group write access to tenant skill repositories would bypass review and make configuration drift hard to audit.

Status: Accepted. Unchanged.

## ADR-016: Generated Skills Are Group-local Until Promoted

Decision: Skills created or modified by a group at runtime are stored under that group's runtime directory and are not copied into tenant repositories automatically.

Reason:

- Runtime-generated content should not mutate deployment source of truth.
- Promotion to tenant skill should be explicit and reviewable.
- Group-local generated skills preserve isolation expectations.

Status: Accepted. Unchanged.

## ADR-017: Central Host DB Remains the Control-plane Source of Truth

Decision: Per-run runtime DBs are queues and run-local state. The existing host DB remains authoritative for chats, message history, scheduled tasks, task run logs, registered groups, router cursors, and legacy session IDs.

Reason:

- The host message loop uses `last_timestamp` and `last_agent_timestamp` to avoid duplicate replies and to retry failed runs.
- Scheduled tasks, registered groups, sender policy, card actions, and channel metadata are host-level control-plane data, not one-run runtime data.
- Treating runtime DBs as a second source of truth would create cursor drift and duplicate delivery risks.

Status: Accepted. Unchanged.

## ADR-018: Host-side Authorization Gates Stay Host-side

Decision: Sender allowlists, trigger rules, main-group privileges, approval allowlists, mount allowlists, group registration rights, and channel credential checks remain enforced by the control plane before work is executed.

Reason:

- Run processes are not trusted to self-report authorization.
- Feishu and channel credentials are control-plane capabilities.
- Main/self authorization semantics must survive the tool IPC migration.

Status: Accepted. Unchanged.

## ADR-020: Additional Mount Scope Must Be Explicit

Decision: Additional host mounts must declare whether they are agent-wide or group-specific. Group-specific mounts must not be promoted silently to agent-wide mounts.

Reason:

- One control plane can serve multiple groups; an agent-wide mount becomes visible to every group user unless permissions prevent it.
- The existing external mount allowlist and non-main read-only policy are part of the security model.

Status: Accepted. Unchanged.

## ADR-021: Per-(tenant, agent) External Channel Identity

Decision: Channel registry uses composite key `(tenant_id, agent_id, channel_type)`. For each `agent.json` declaring a channel, the loader constructs a channel instance with that agent's external identity and registers it under the composite key.

Reason:

- Different agents under the same tenant may have different Feishu apps, Slack workspaces, or Telegram bots.
- The webhook URL pattern `/<tenant>/<agent>/<channel>/event` requires per-(tenant, agent) granularity to be useful.
- Singleton accessors (`getFeishuChannel()`) collapse to lookup-by-composite-key.

Status: Accepted 2026-06-16.

## ADR-022: Shared Webhook HTTP Server with Path-based Routing

Decision: The control plane runs a single HTTP server. Each channel instance registers its URL prefix. Routing is by path: `/<tenant>/<agent>/<channel>/event`.

Reason:

- Per-instance HTTP servers would require N exposed ports for N tenants — operationally infeasible.
- WebSocket-mode channels (Feishu WS, Slack Socket Mode) need no HTTP path; their events are routed by connection identity.
- Webhook-mode channels point their external configuration to the matching path on the single shared server.

Status: Accepted 2026-06-16.

## ADR-023: Privileged Operations Only Through nc-setuid-helper

Decision: All privileged operations (`setuid`/`setgid` for run spawning, process signal, cgroup setup) go through `nc-setuid-helper`, a SUID root binary installed at `/usr/lib/nanoclaw/nc-setuid-helper` (mode 4750, owner=root, group=nc-priv). Only the `nanoclaw-svc` user is in `nc-priv`. The helper validates all arguments against an allowlist: UIDs must match `^ncg-` and exist in `users.db`; runtime dirs must be owned by the target UID; PIDs for `kill` must be owned by `ncg-*` users.

Reason:

- Keeping the privilege surface in a single small auditable binary is cleaner than running the control plane with elevated capabilities.
- The helper rejects all out-of-scope invocations, so a control plane compromise cannot escalate to arbitrary root.
- Works uniformly across deployment modes (bare-metal systemd, single Docker container, Kubernetes pod).

Status: Accepted 2026-06-16.

## ADR-024: Two-tier Credential Threat Model

Decision: Credentials are categorised and handled by tier:

- **LLM credentials (low risk)**: point at an internal gateway, useless if leaked outside. Delivered via env at spawn time. No proxy, no scoped tokens.
- **Channel credentials (high risk)**: real external credentials (Feishu `app_secret`, Slack bot tokens, Telegram bot tokens, Discord bot tokens). Stored only in `0600` files owned by `nanoclaw-svc` and in control plane process memory. Run processes access channels via tool IPC — never see the raw credentials.
- **Runtime data (high risk)**: chat history, provider continuation, generated skills, downloaded files. Protected by Linux user ownership and `0770` directory modes.

Reason:

- Treating all credentials as equally sensitive would force a credential proxy for LLM access, adding complexity without security benefit (the internal gateway is the real boundary).
- Treating all credentials as equally low-risk would expose channel secrets to run processes, creating a real attack surface.
- The two-tier model focuses protection effort where the threat actually is.

Status: Accepted 2026-06-16.

## ADR-025: Channel Registry Uses Composite Key; Singleton Accessors Removed

Decision: All `getXxxChannel()` singleton accessors are removed. Channel lookup goes through `getChannel(tenantId, agentId, channelType)`. The registry is a `Map<compositeKey, ChannelInstance>`.

Reason:

- Singleton accessors encode the assumption of one channel per type, which breaks under multi-tenant.
- Composite-key lookup makes tenant routing explicit at every call site, surfacing mistakes at compile time rather than runtime.

Status: Accepted 2026-06-16.

## Future ADRs

Decisions deferred to implementation:

- Whether the central host DB stays SQLite or moves to embedded Postgres for multi-tenant query patterns.
- Cgroup v2 delegation: whether the control plane gets its own delegated cgroup subtree or the helper manages the full `/sys/fs/cgroup/nanoclaw/` tree as root.
- Per-(tenant, agent) resource limit defaults.
- Whether to introduce a separate supervisor process (ADR-008 original) as the codebase grows.
