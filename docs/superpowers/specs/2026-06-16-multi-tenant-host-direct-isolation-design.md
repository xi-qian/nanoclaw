# Multi-tenant Host-direct Isolation — Architecture Design

**Date**: 2026-06-16
**Status**: Design (pending implementation plan)
**Supersedes**: ADR-002, ADR-005, ADR-008, ADR-012, ADR-019 (parts), ADR-004 of `docs/runtime-rework/ADR.md`
**Keeps**: ADR-001, ADR-003, ADR-006, ADR-007, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016, ADR-017, ADR-018, ADR-020

## Background

The existing `docs/runtime-rework/` plan targets "one Docker container per agent service, per-group Linux users inside each container". This design reverses that: Linux users become the isolation unit on the host directly, and Docker drops to an optional deployment wrapper.

The shift is driven by three realisations:

1. Docker adds no credential isolation on top of Linux user separation. Process memory isolation, `/proc/<pid>/environ` restrictions, and file permissions already give different-UID processes different security domains. Docker's residual value is operational (image portability, cgroups, defence in depth), not security.
2. Deployment convenience matters: one NanoClaw instance supporting many tenants and many agents is simpler to operate than N Docker services.
3. Channel credentials (Feishu, Slack, etc.) and tenant runtime data — not LLM credentials — are the real protection targets. The current deployment uses an internal LLM gateway whose credentials are useless if leaked outside the internal network, which downgrades the LLM credential threat model.

## Goals

- One NanoClaw control plane process supports multiple tenants, multiple agents per tenant, multiple groups per agent.
- Isolation unit: Linux user `ncg-<tenant>-<agent>-<group>`.
- Per-(tenant, agent) external identity: each agent can have its own Feishu app, Slack bot, etc.
- Webhook URLs shaped `/<tenant>/<agent>/<channel>/event` route inbound events to the right channel instance.
- Clean replacement of the existing `docker-per-group` runtime. No fallback mode.
- Docker remains usable as a one-image deployment wrapper but is not the security boundary.

## Non-goals

- Per-group kernel namespace, per-group network namespace by default.
- Protection against kernel exploits or container escapes (same threat surface as Docker, since both share the host kernel).
- Backward-compatible operation of the existing `groups/<name>/` layout during transition. A one-shot migration script handles the cutover.
- Multi-tenant billing or quota enforcement inside NanoClaw (handled by the internal LLM gateway or external channel platforms).
- Approach A (separate supervisor process) — listed under "Future extensions" but not part of the initial implementation.

## Architecture Overview

```text
NanoClaw host (bare-metal systemd service OR one Docker container)
├── Control plane process (uid=nanoclaw-svc, no capabilities)
│   ├── HTTP webhook server: POST /<tenant>/<agent>/<channel>/event
│   ├── channels: per-(tenant, agent) Feishu / Slack / Telegram / ... clients
│   ├── router, scheduler, sender/trigger policy
│   ├── tool workers: Feishu / approval / file / task APIs (host-side)
│   ├── tenant config loader
│   ├── run lifecycle manager: spawn, monitor, reap, kill, idle-reap
│   └── run spawner: invokes nc-setuid-helper
├── nc-setuid-helper (SUID root binary, ~500 lines C)
│   └── privileged operations: spawn, kill, cgroup setup
└── Run processes (uid=ncg-<tenant>-<agent>-<group>)
    └── agent-runner: Claude / OpenCode / mock provider adapter
```

### Privilege model

Control plane never holds any Linux capability. All privileged operations go through `nc-setuid-helper`, a small SUID root binary installed at `/usr/lib/nanoclaw/nc-setuid-helper` (mode 4750, owner=root, group=nc-priv). Only the `nanoclaw-svc` user is in the `nc-priv` group, so only the control plane can invoke the helper.

The helper exposes four operations, each with strict argument validation:

```
nc-setuid-helper spawn  --uid=<u> --gid=<g> --cgroup=<path> --runtime-dir=<dir> -- <cmd...>
nc-setuid-helper kill   --pid=<p> --signal=<sig>
nc-setuid-helper cgroup --path=<path> --mem=<mb> --pids=<n> --cpu=<shares>
nc-setuid-helper status --pid=<p>
```

Validation rules:

- `--uid` and `--gid` must match `^ncg-` and correspond to a user the helper itself created earlier in this host's lifetime (tracked via a state file under `/var/lib/nanoclaw/users.db`, owned by root).
- `--runtime-dir` must be owned by `--uid:--gid` and live under `/var/lib/nanoclaw/runtime/`.
- `kill --pid` must point to a process whose real UID matches an `ncg-*` user.
- `cgroup` paths must live under `/sys/fs/cgroup/nanoclaw/`.

Any violation: helper exits non-zero without performing the operation. Control plane sees the failure and reports it.

### Process lifecycle

| Operation | Owner | Mechanism |
|-----------|-------|-----------|
| Spawn | control plane | `posix_spawn` → child execs `nc-setuid-helper spawn` → helper setuids, sets up cgroup, execs agent-runner |
| Liveness check | control plane | `stat("/proc/<pid>")` (works for any UID) |
| Stop (SIGTERM/SIGKILL) | helper | `nc-setuid-helper kill --pid --signal` (validates pid owner) |
| Cgroup / resource limits | helper | Set up at spawn time; subsequent adjustments via `cgroup` command |
| Zombie reaping | control plane | Run process is direct child of control plane (helper only bridges exec); normal SIGCHLD + `waitpid` |
| Idle reap / timeout kill | control plane | Periodic timer scans active runs; calls helper kill when thresholds exceeded |
| Host-restart reconcile | control plane | DB-listed active PIDs are checked against `/proc/`; missing ones marked crashed |

Two Linux rules shape this split:

- `waitpid` ignores UID — control plane (uid=nanoclaw-svc) can reap a child whose UID was changed to `ncg-...` by the helper.
- `kill` requires same-UID (or privilege) — control plane cannot signal `ncg-*` processes, so killing always goes through the helper.

This keeps the privilege surface to a single auditable binary while letting control plane own all lifecycle policy.

## User model

### Naming convention

Linux user name:

```
ncg-<tenant>-<agent>-<group>
```

Sanitisation:

- All segments lowercased.
- Allowed characters: `[a-z0-9-]`. Anything else replaced with `-`.
- Tenant and agent IDs: max 16 chars each, validated at tenant-config load time.
- Group ID: variable length, sanitised to `[a-z0-9-]+`. If the resulting username would exceed 32 chars (Linux username limit), the group segment is replaced with `g<sha1(group).substr(0,8)>`.

Each user gets:

- A matching primary group (`ncg-<t>-<a>-<g>`).
- Home directory is the runtime directory itself (`/var/lib/nanoclaw/runtime/<t>/<a>/<g>/`). No separate `/home/ncg-*`.
- No supplementary groups. Platform code under `/opt/nanoclaw/` is world-readable (mode 0755, owner=nanoclaw-svc) so no special group is needed for the run process to read it.

### Control plane access to runtime directories

The control plane (`uid=nanoclaw-svc`) needs to read and write the IPC databases inside each runtime directory without compromising isolation between `ncg-*` users. The mechanism is a single shared group:

- Group `nc-runtime` exists, with **only** `nanoclaw-svc` as a member.
- Every runtime directory is `owner=ncg-<t>-<a>-<g>`, `group=nc-runtime`, `mode=0770`.
- Owner (the ncg user) gets rwx. Group (only nanoclaw-svc) gets rwx. Other ncg-* users have no access.

This gives nanoclaw-svc transparent read/write access to every runtime dir's IPC files without elevating through the helper, while keeping ncg-* users fully isolated from each other.

### Lifecycle

Users are created lazily by the helper on first run for a given (tenant, agent, group) tuple, and **never deleted**. Idle runs stop the process but keep the user and runtime directory on disk so the next message has a warm path. A separate `nanoclaw-user-gc` admin command can prune users for tenants that have been removed from config; this is operator-driven, not automatic.

State file `/var/lib/nanoclaw/users.db` (SQLite, owned by root, mode 0600) tracks every user the helper has created, so the helper can validate `spawn --uid` requests against history.

## Tenant configuration

### Source

All tenant and agent configuration is loaded from a tenant repository on startup. The path is set via `NANOCLAW_TENANTS_DIR`. Loader validates schemas, resolves skill references, and produces in-memory `RegisteredTenant` / `RegisteredAgent` objects. No ad-hoc `groups/<name>/` directory is supported.

### Layout

```text
nanoclaw-tenants/
  tenants/
    <tenant>/
      tenant.json                      # tenant metadata, enabled flag
      skills/                          # tenant-level skills (read-only inputs)
        <skill>/
          SKILL.md
          manifest.json
      agents/
        <agent>/
          agent.json                   # provider, model, instructions, skill refs, limits
          instructions.md
          skills/                      # agent-local skills
          channels/                    # per-(tenant, agent) external identity config
            feishu.json                # mode (websocket/webhook), webhook settings, secret refs
            slack.json                 # (optional)
            telegram.json              # (optional)
```

### `agent.json` example

```json
{
  "id": "finance",
  "tenant": "acme",
  "name": "Finance Bot",
  "provider": "claude",
  "model": "claude-sonnet-4",
  "instructions": "./instructions.md",
  "skills": [
    "builtin:welcome",
    "tenant:acme-approval",
    "agent:finance-local"
  ],
  "channels": ["feishu"],
  "envRefs": ["ANTHROPIC_API_KEY"],
  "limits": {
    "memoryMb": 1024,
    "pids": 256,
    "concurrentTasksPerGroup": 1
  }
}
```

### `channels/feishu.json` example

```json
{
  "mode": "websocket",
  "appId": "cli_acme_finance",
  "appSecretRef": "FEISHU_APP_SECRET",
  "webhook": {
    "encryptKeyRef": "FEISHU_WEBHOOK_ENCRYPT_KEY",
    "verificationTokenRef": "FEISHU_WEBHOOK_VERIFICATION_TOKEN"
  }
}
```

Actual secret values are never in the tenant repo. They live in `store/auth/tenants/<tenant>/<agent>/feishu/credentials.json` (mode 0600, owner=nanoclaw-svc). The repo carries only references.

## Channel registry and webhook routing

### Registry key

Channel registry uses composite key `(tenant_id, agent_id, channel_type)`. For each `agent.json` that declares a channel, the loader constructs a channel instance with that agent's external identity and registers it under the composite key. Lookup goes through `getChannel(tenantId, agentId, channelType)`; the existing singleton `getFeishuChannel()` accessor is removed.

### Inbound webhook server

Control plane runs **one** HTTP server. Each channel instance registers its URL prefix:

```
POST /<tenant>/<agent>/feishu/event       → FeishuChannel(tenant, agent).handleWebhook
POST /<tenant>/<agent>/slack/event        → SlackChannel(tenant, agent).handleWebhook
GET  /<tenant>/<agent>/<channel>/verify   # challenge / verification responses
```

Feishu developer console configures the webhook URL to `https://nanoclaw.example.com/<tenant>/<agent>/feishu/event`. Different (tenant, agent) tuples get different URLs.

For channels using outbound connections (Feishu WebSocket mode, Slack Socket Mode, Telegram long-poll), each channel instance owns its connection. NanoClaw identifies the source tenant/agent by which connection the event arrived on, not by URL path.

### Channel isolation

Each `FeishuClient` (and equivalent for other channels) is constructed with its own credentials, owns its own `Lark.Client` / WebSocket connection / event handler map, and is state-safe for multiple instances in one process. The current code already supports this; the only changes are:

1. `src/channels/feishu.ts:1026` — registry key from string literal to composite `(tenant, agent, type)`.
2. `src/feishu/auth.ts:13-14` — credential file path from `store/auth/feishu/credentials.json` to `store/auth/tenants/<tenant>/<agent>/feishu/credentials.json`.
3. `src/feishu/auth.ts:72-88` — drop env-var overrides; webhook settings come from `channels/feishu.json`.
4. `src/index.ts:899` / `src/ipc.ts:242` — replace `getFeishuChannel()` with `getChannel(tenantId, agentId, 'feishu')`.

Plus the architectural change: webhook HTTP server moves from per-`FeishuClient` to a shared server in the control plane.

## Credential model

Two-tier threat model:

### LLM credentials (low risk)

Anthropic API credentials point at an internal gateway. They are useless if leaked outside the internal network. Delivery: env injection at spawn time.

```
ANTHROPIC_BASE_URL=<internal-gateway-url>      # from tenant/agent config
ANTHROPIC_API_KEY=<internal-credential>        # from store/auth/tenants/.../credentials.json
```

No credential proxy, no scoped tokens, no `SO_PEERCRED`. Files are still 0600 / owned by `nanoclaw-svc` for general hygiene.

### Channel credentials (high risk)

Feishu `app_secret`, Slack bot tokens, Telegram bot tokens, Discord bot tokens are real external credentials. They live only in:

- `store/auth/tenants/<tenant>/<agent>/<channel>/credentials.json` — 0600, owner=`nanoclaw-svc`
- Control plane process memory after load

Run processes **never** see channel credentials. They request channel operations through tool IPC (write to `tools.db`), control plane tool worker executes against the channel client, result written back to `tools.db`.

This pattern is inherited from the current architecture and is unchanged in the new design.

### Runtime data (high risk)

Chat history, provider continuation, generated skills, downloaded files. Protected by Linux user ownership and 0700 directory modes. Cross-group, cross-agent, cross-tenant reads fail with permission denied.

## Runtime directories

### Host layout

```text
/var/lib/nanoclaw/                          # NANOCLAW_DATA_DIR (configurable)
  users.db                                  # state: users created by helper (root:root 0600)
  tenants -> /path/to/nanoclaw-tenants      # symlink, or direct path
  auth/
    tenants/
      <tenant>/<agent>/<channel>/credentials.json   # 0600, owner=nanoclaw-svc
  runtime/
    <tenant>/<agent>/<group>/
      live/
        inbound.db
        outbound.db
        state.db
        tools.db
        files/
        downloads/
      runs/<runId>/                         # isolated task runs
        inbound.db
        outbound.db
        state.db
        tools.db
        files/
        downloads/
      skills/
        generated/                          # group-created skills (writable by group user only)
  logs/
    <tenant>/<agent>/<group>/
      live.log
      runs/<runId>.log
```

Runtime directory ownership:

- Owner: `ncg-<tenant>-<agent>-<group>`
- Group: `nc-runtime` (single shared group containing only `nanoclaw-svc`)
- Mode: 0770

Control plane accesses IPC files (inbound, outbound, tools DBs) transparently via its `nc-runtime` membership. See "Control plane access to runtime directories" under User model for the rationale.

### Run process view

The run process's cwd and home are `/var/lib/nanoclaw/runtime/<t>/<a>/<g>/{live|runs/<runId>}`. It can see:

- Its own `inbound.db` / `outbound.db` / `state.db` / `tools.db` (read/write)
- Its own `skills/generated/` (read/write)
- Shared read-only `/opt/nanoclaw/skills/{builtin,tenant/<t>,agent/<t>/<a>}/` (mounted in, owner=nanoclaw-svc, mode 0755)
- `/opt/nanoclaw/agent-runner/` (read-only platform code)

It cannot see:

- Other tenants/agents/groups runtime directories (owned by other users, mode 0770)
- `auth/` and `users.db` (owned by nanoclaw-svc or root, mode 0600)
- Tenant repo source files (loaded only into control plane memory; run process gets a resolved skill manifest copy under its own runtime dir)

## IPC and data flow

DB-backed IPC is inherited unchanged from `docs/runtime-rework/03-db-backed-ipc.md`. Only the path prefix changes from `/runtime/groups/<group>/` to `/var/lib/nanoclaw/runtime/<tenant>/<agent>/<group>/`.

| File | Writer | Reader |
|------|--------|--------|
| `inbound.db` | control plane | run process |
| `outbound.db` | run process | control plane |
| `state.db` | run process | run process (continuation, audit) |
| `tools.db` | run process (request) / control plane tool worker (result) | both |

Tool workers receive `(tenant, agent, group, runId)` from the request row's source identity, then look up the channel instance via `getChannel(tenantId, agentId, channelType)`. No global singleton lookup.

### Audit logging

Each run writes its own API usage (model, tokens, latency, status) into `state.db` or `outbound.db` as it goes. Control plane aggregates per-(tenant, agent) views on demand for the status dashboard. This avoids a central proxy while still allowing per-tenant reporting.

## ADR changes

### Reversed

- **ADR-002** (keep `docker-per-group` as fallback) → reversed. Clean replacement.
- **ADR-005** (one Docker per agent service) → reversed. New ADR-005': Linux user is the isolation unit; Docker is an optional deployment wrapper.
- **ADR-008** (supervisor owns group process lifecycle) → revised. Control plane owns lifecycle *policy*; privileged *mechanism* (setuid, signal, cgroup) is encapsulated in `nc-setuid-helper`. Control plane holds no capabilities.

### Deleted

- **ADR-004** (legacy file IPC compatibility) → deleted. Clean replacement, no compatibility layer.
- **ADR-019** (runtime code is immutable by default) → narrowed. The principle still applies to platform code under `/opt/nanoclaw/agent-runner/`, but the "no per-group writable runner source" rationale is now structural (Linux user can't write outside its runtime dir) rather than policy.

### Added

- **ADR-021**: Each (tenant, agent) tuple may declare its own external channel identity. Channel registry key is `(tenant_id, agent_id, channel_type)`.
- **ADR-022**: Inbound webhook URL `/<tenant>/<agent>/<channel>/event` is the routing key. One shared HTTP server in control plane dispatches by path.
- **ADR-023**: Privileged operations only through `nc-setuid-helper` (SUID root). Control plane holds no Linux capabilities.
- **ADR-024**: Two-tier credential threat model. LLM credentials (internal gateway) — env injection. Channel credentials (real external) — host-side only, run processes use tool IPC. Runtime data — Linux user isolation.
- **ADR-025**: Channel registry uses composite key. All `getFeishuChannel()`-style singleton accessors are removed in favour of `getChannel(tenantId, agentId, channelType)`.

### Kept unchanged

ADR-001 (tenant/skill boundary), ADR-003 (DB IPC), ADR-006 (isolated task uses same group user), ADR-007 (isolated task does not reuse live continuation), ADR-009 (provider differences behind `AgentProvider`), ADR-010 (OpenCode optional), ADR-011 (secrets host-side — now sharpened by ADR-024), ADR-012 (no world-writable IPC), ADR-013 (registered ≠ active), ADR-015 (tenant skills read-only inputs), ADR-016 (generated skills group-local), ADR-017 (central host DB source of truth), ADR-018 (host-side authz), ADR-020 (additional mount scope explicit).

## Migration

One-shot script: `npm run migrate:to-multi-tenant -- --tenant <default-tenant-id> --source ./legacy-backup --target ./nanoclaw-tenants`

The script:

1. Runs in `--dry-run` first; produces a migration report listing every transformation. Waits for explicit confirmation before mutating anything.
2. Backs up all source data to `legacy-backup-<timestamp>/` before any write.
3. Transforms layout:

   ```text
   legacy                                          new
   ─────────────────────────────────────────────────────────────────────────
   groups/<name>/CLAUDE.md                  →     tenants/<t>/agents/<name>/instructions.md
                                                                                   + agent.json (provider=claude)
   store/auth/feishu/credentials.json       →     store/auth/tenants/<t>/<name>/feishu/credentials.json
   data/sessions/<group>/                          → /var/lib/nanoclaw/runtime/<t>/<name>/<group>/live/
     (Claude SDK state repacked into state.db)
     agent-runner-src/                             ← dropped (platform code is shared in new model)
   data/ipc/<group>/                               → dropped (file IPC not supported; backed up only)
   data/nanoclaw.db                                → schema migration adds tenant_id, agent_id columns
                                                    (default tenant=<default-tenant-id>, agent=<folder>)
   data/messages.db, store/messages.db             → schema migration adds tenant_id column
   ```

4. Verifies result via `npm run verify:migration`:
   - Every legacy group has a 1:1 mapping to a new (tenant, agent, group) tuple.
   - Message counts match between source and target DBs.
   - Every credentials file is mode 0600, owner=nanoclaw-svc.
   - Tenant config loader successfully loads the new repo with no diagnostics.

The migration is **irreversible** by design (no `docker-per-group` fallback). Operators must validate the dry-run report before confirming.

## Testing

### Permission isolation (`npm run test:isolation`)

Run inside a test host with multiple `ncg-*` users created:

- `ncg-a-x-y` cannot read or write `ncg-a-x-z`'s `state.db`.
- `ncg-a-x-y` cannot read any file under `auth/`.
- `ncg-a-x-y` cannot read `ncg-b-x-y`'s runtime directory (cross-tenant).
- Run process environment contains only `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and run config — no channel credentials, no other tenant's data.

### Webhook routing

- POST `/t1/a1/feishu/event` triggers only `FeishuChannel(t1, a1)`.
- POST to `/t1/a1/...` does not affect `FeishuChannel(t1, a2)` or `FeishuChannel(t2, a1)`.
- WebSocket-mode channel events route to the correct (tenant, agent) based on connection identity.

### Channel credential isolation

- Run process for `(t1, a1, g1)` calls feishu tool → tool worker uses `FeishuChannel(t1, a1)` credentials, never `(t2, a1)` or `(t1, a2)`.
- Grep on run process memory dump (test-only) finds no `app_secret` strings.

### Lifecycle

- Control plane kills a run → process exits, audit row written, runtime directory preserved.
- Run process crashes → control plane detects via SIGCHLD and `/proc/<pid>` absence, DB state reconciled.
- Idle-reap timer fires → idle runs killed via helper.
- Host restart → control plane reconciles DB-listed active PIDs against `/proc/`; missing PIDs marked crashed.

### Setuid helper

Standalone C test suite for the helper binary:

- Rejects `spawn --uid` not matching `^ncg-`.
- Rejects `spawn --uid` for users not in `users.db`.
- Rejects `spawn --runtime-dir` not owned by `--uid`.
- Rejects `kill --pid` whose real UID is not `ncg-*`.
- Rejects invocations from any UID other than `nanoclaw-svc`.
- After successful `spawn`, the exec'd process has dropped all capabilities and runs with the requested UID/GID.

## Future extensions

### Approach A: separate supervisor process

If the control plane grows to the point where privilege separation inside NanoClaw itself is desirable, introduce a long-lived supervisor process that owns user lifecycle and run spawning. Control plane talks to supervisor via Unix socket. This:

- Further shrinks the privilege surface (control plane no longer invokes the helper directly).
- Allows the supervisor to be the only process needing `nc-priv` group membership.
- Adds one IPC boundary and one long-lived process to operate.

Not part of the initial implementation. Triggered when the control plane binary exceeds a complexity threshold or when audit requirements demand clearer separation between routing logic and privileged operations.

### Per-run Unix socket credential proxy

If NanoClaw ever runs untrusted tenants (e.g., multi-customer SaaS), upgrade credential delivery from env injection to a per-run Unix socket proxy:

- Each run gets its own Unix socket at `/var/run/nanoclaw/cred-proxy.<runId>.sock`.
- Socket file mode 0660, owner=nanoclaw-svc, group=ncg-<t>-<a>-<g>.
- Kernel-enforced access control: only that run can connect.
- Anthropic SDK configured with custom HTTP agent targeting the socket.
- Proxy injects credentials server-side.

Not needed for current internal deployment but documented as the upgrade path.

### Skill hot-reload

Once the basic runtime is stable, add `skills.reload` to the run lifecycle so tenant skill changes can take effect without restarting active runs. Requires provider-specific adapter support.

## Open questions

Deferred to implementation planning:

- Exact JSON schemas for `tenant.json`, `agent.json`, `channels/<channel>.json`, skill manifests.
- Whether the host-side DB (`data/nanoclaw.db`) stays as SQLite or moves to embedded Postgres for multi-tenant query patterns.
- Resource limit defaults (memoryMb, pids, cpuShares) per agent — likely tenant-overridable.
- Whether `/var/lib/nanoclaw/users.db` should be SQLite (current proposal) or a simpler append-only format.
- Cgroup v2 delegation: does the control plane get its own delegated cgroup subtree, or does the helper manage the full `/sys/fs/cgroup/nanoclaw/` tree as root?
