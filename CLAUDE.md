# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (Feishu, WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Docker on Linux, Docker Sandboxes on macOS/Windows). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/channels/feishu.ts` | Feishu channel implementation |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals, monitor config |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/container-runtime.ts` | Docker/container runtime management |
| `src/task-scheduler.ts` | Runs scheduled tasks (cron) |
| `src/db.ts` | SQLite operations |
| `src/remote-control.ts` | Remote control session management |
| `src/sender-allowlist.ts` | Sender permission control |
| `src/reporter/index.ts` | Monitor reporting (WebSocket to central monitor) |
| `src/feishu/client.ts` | Feishu API client |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser/SKILL.md` | Browser automation tool |
| `packages/monitor/` | Web UI monitor dashboard (workspace) |

## Container Skills

| Skill | Purpose |
|-------|---------|
| `agent-browser` | Browser automation (Playwright) |
| `capabilities` | Agent capability declarations |
| `file-reader` | File reading with path validation |
| `status` | Container status reporting |
| `pm-persona` | Project manager persona |
| `feishu-doc` | Feishu document operations |
| `hetang_project_manager` | Hetang project management |
| `hetang_task_update` | Hetang task updates |
| `pptx` | PowerPoint generation |
| `weekly-report-summary` | Weekly report summarization |
| `weekly-report-sync` | Weekly report synchronization |

## Host Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |
| `/add-feishu` | Add Feishu channel |
| `/add-whatsapp` | Add WhatsApp channel |
| `/add-telegram` | Add Telegram channel |
| `/add-slack` | Add Slack channel |
| `/add-discord` | Add Discord channel |
| `/add-gmail` | Add Gmail integration |

## Development

**部署和日志查看方法见 [deploy.sh](deploy.sh)**

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
npm run test         # Run tests (vitest)
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
systemctl --user status nanoclaw
journalctl --user -u nanoclaw -f  # view logs
```

## Monitor Dashboard

The `packages/monitor` workspace provides a web UI for monitoring NanoClaw instances. Enable by setting:

```bash
NANOCLAW_MONITOR_ENABLED=true
NANOCLAW_MONITOR_URL=http://your-monitor-server  # central monitor URL
NANOCLAW_INSTANCE_ID=your-instance-name           # optional instance identifier
```

Build and run monitor:
```bash
cd packages/monitor
npm run build
npm start
```

## Configuration

Key environment variables (see `src/config.ts`):

| Variable | Description | Default |
|----------|-------------|---------|
| `ASSISTANT_NAME` | Bot name for @mentions | `Andy` |
| `AUTO_REGISTER_GROUPS` | Auto-register new chats | `true` |
| `CONTAINER_TIMEOUT` | Container max runtime (ms) | `1800000` (30min) |
| `IDLE_TIMEOUT` | Keep container alive after last output | `1800000` (30min) |
| `MAX_CONCURRENT_CONTAINERS` | Max parallel containers | `5` |
| `TZ` / `TIMEZONE` | Timezone for cron tasks | System timezone |

## Project Structure

```
nanoclaw/
├── src/                    # Main application source
├── container/              # Agent container definition
│   ├── agent-runner/       # Container entry point
│   ├── skills/             # Container skills
│   └── Dockerfile
├── packages/               # Workspaces
│   └ monitor/              # Web UI monitor
├── groups/                 # Per-group isolated storage
├── store/                  # Auth credentials (not mounted)
├── data/                   # SQLite database
├── logs/                   # Application logs
├── docs/                   # Documentation
└── .claude/skills/         # Host skills (channel integrations)
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate channel skill, not bundled in core. Run `/add-whatsapp` to install it.

**Feishu authentication:** Credentials stored in `store/auth/feishu/credentials.json`. Re-authenticate with `/add-feishu` if needed.

**Container build cache:** The buildkit caches aggressively. `--no-cache` alone doesn't invalidate COPY steps. To force a clean rebuild:
```bash
docker builder prune
./container/build.sh
```

**Container troubleshooting and cleanup:**

Each nanoclaw instance labels its containers with `nanoclaw.instance=<INSTANCE_ID>` to isolate cleanup from other users/instances.

```bash
# List all nanoclaw containers
docker ps --filter name=nanoclaw-

# Check container labels (verify instance isolation)
docker inspect --format '{{.Config.Labels.nanoclaw.instance}}' <container>

# List containers from current instance only
docker ps --filter "name=nanoclaw-" --filter "label=nanoclaw.instance=<INSTANCE_ID>"

# Stop orphaned containers manually
docker stop <container_name>
```

On startup, `cleanupOrphans()` stops containers matching the current `INSTANCE_ID`. This prevents one nanoclaw instance from killing containers belonging to other users.

- `INSTANCE_ID` = `NANOCLAW_INSTANCE_ID` env var, or `os.userInfo().username` by default
- Multi-instance setups: set different `NANOCLAW_INSTANCE_ID` for each instance (e.g., production, testing)

**Database issues:** SQLite database in `data/nanoclaw.db`. Backup before modifications.

## Security Notes

- Secrets (API keys, tokens) are only loaded by the credential proxy, never exposed to containers
- Mount allowlist stored in `~/.config/nanoclaw/mount-allowlist.json`
- Sender allowlist in `~/.config/nanoclaw/sender-allowlist.json`
- Auth credentials in `store/auth/` (never mounted into containers)