# NanoClaw 部署与数据库迁移指南

## 部署方式

### 方式一：deploy-webhook.sh（Webhook 模式，全量打包）

```bash
echo "n" | bash deploy-webhook.sh root@<server> /root/nanoclaw-webhook
```

适用场景：首次部署或全新安装（webhook 模式）。

**注意**：此脚本会 `rm -rf` 部署目录，但自动备份并恢复 `store/` 和 `.env`。不会备份 `data/sessions/`（会话数据丢失，下次请求自动重建）。

### 方式二：Git 推送合并（推荐，保留全部数据）

适用场景：已有运行中的服务，需要增量更新代码，不破坏数据。

```bash
# 1. 添加服务器为 remote（首次）
git remote add <name> ssh://<user>@<host>:<port>/<project-path>

# 2. 推送当前分支到服务器
git push <name> main:refs/heads/deploy-<date>

# 3. SSH 到服务器，合并部署
ssh <user>@<host> -p <port>
cd <project-path>
git stash                          # 暂存本地改动
git merge deploy-<date> --no-edit  # 合并新代码
git stash pop                      # 恢复本地改动（手工解冲突）
npm install --ignore-scripts       # 安装新依赖
npm rebuild better-sqlite3         # 重建 native 模块
npm run build                      # 编译
sudo systemctl restart nanoclaw    # 或 systemctl --user restart nanoclaw
```

**冲突处理**：`git stash pop` 时如有冲突，优先保留合并后的版本：

```bash
git checkout --ours <file>   # 出错时用合并版本覆盖
git add <file>
git stash drop               # 丢弃 stash
```

### 方式三：GitHub PR 合并后拉取

如果服务器追踪 GitHub 仓库：

```bash
ssh <user>@<host> -p <port>
cd <project-path>
git fetch origin
git merge origin/main
npm install --ignore-scripts
npm rebuild better-sqlite3
npm run build
sudo systemctl restart nanoclaw
```

## 数据库迁移

### 当前迁移列表

| 日期 | 迁移 | SQL |
|------|------|-----|
| 2026-05-05 | 添加 `scheduled_task_id` 列 | `ALTER TABLE messages ADD COLUMN scheduled_task_id TEXT` |

### 执行迁移

数据库文件位于 `store/messages.db`（由 `STORE_DIR` 配置）。

```bash
cd <project-path>
node -e "
const D = require('better-sqlite3');
const d = new D('store/messages.db');
try {
  d.exec('ALTER TABLE messages ADD COLUMN scheduled_task_id TEXT');
  console.log('migration: column added');
} catch(e) {
  if (e.message.includes('duplicate')) {
    console.log('migration: already exists');
  } else {
    throw e;
  }
}
d.close();
"
```

迁移是**幂等**的——列已存在时自动跳过，可安全重复执行。

### deploy-webhook.sh 内置迁移

`deploy-webhook.sh` 已在服务器端安装步骤中自动执行迁移和 `npm rebuild`：

```bash
# 重建 native 模块 (适配服务器 Node 版本)
npm rebuild better-sqlite3

# 数据库迁移 (幂等)
node -e "..." # ALTER TABLE messages ADD COLUMN scheduled_task_id TEXT
```

## 当前部署实例

| 账号 | 服务器 | 目录 | 服务名 | 模式 |
|------|--------|------|--------|------|
| root | 163.7.5.173 | `/root/nanoclaw-webhook` | `nanoclaw-webhook` (system) | Webhook |
| qianx | moleagent.com:51023 | `/data/user/qianxi/nanoclaw` | `nanoclaw` (user) | WebSocket |
| hetang-test | moleagent.com:51023 | `/home/hetang-test/nanoclaw` | `nanoclaw` (system) | WebSocket |

### 各实例 Git Remote

```bash
# qianx (WebSocket)
git remote add nanoclaw-ws ssh://qianx@moleagent.com:51023/data/user/qianxi/nanoclaw

# hetang-test (WebSocket)
git remote add hetang-test ssh://hetang-test@moleagent.com:51023/home/hetang-test/nanoclaw
```

## 部署后验证

```bash
# 查看服务状态
ssh <user>@<host> -p <port> "systemctl status nanoclaw"
# 或
ssh <user>@<host> -p <port> "systemctl --user status nanoclaw"

# 查看实时日志
ssh <user>@<host> -p <port> "journalctl -u nanoclaw -f"
# 或
ssh <user>@<host> -p <port> "journalctl --user -u nanoclaw -f"

# 检查定时任务
ssh <user>@<host> -p <port> "cd <project-path> && node -e \"
const D=require('better-sqlite3');const d=new D('store/messages.db');
const tasks=d.prepare('SELECT id, schedule_value, context_mode, next_run, status FROM scheduled_tasks').all();
tasks.forEach(t => console.log(JSON.stringify(t)));
d.close();
\""

# 检查容器运行
ssh <user>@<host> -p <port> "docker ps --filter name=nanoclaw"
```
