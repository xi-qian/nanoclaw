# NanoClaw 性能分析报告

> 分析日期: 2026-03-23

## 消息处理流程

```
用户消息
    │
    ▼
┌─────────────────┐
│  Channel 层     │  onMessage → storeMessage() → SQLite
│  (飞书/Telegram)│  ~1-5ms
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  消息轮询循环    │  每 2 秒轮询 (POLL_INTERVAL=2000ms)
│  startMessageLoop│  getNewMessages() → 检查trigger → 入队
└────────┬────────┘  ~10-50ms
         │
         ▼
┌─────────────────┐
│  群组队列        │  GroupQueue.enqueueMessageCheck()
│  GroupQueue     │  并发限制: MAX_CONCURRENT_CONTAINERS=5
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  容器启动 (container-runner.ts)                              │
│  ├── buildVolumeMounts()      ~50-200ms                     │
│  ├── fs.cpSync(skills)        ~100-500ms                    │
│  └── spawn(container)         ~500-2000ms                   │
└────────┬────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent 执行 (agent-runner)                                   │
│  ├── readStdin()              ~1-5ms                        │
│  ├── SDK 初始化 (新 session)  ~1700-2000ms                   │
│  ├── SDK 初始化 (复用)        ~5-10ms  ✅                    │
│  ├── Claude API TTFB          ~3000-13000ms  ⚠️ 瓶颈        │
│  └── 流式输出                  实时                          │
└─────────────────────────────────────────────────────────────┘
```

## 实测性能数据

### 查询对比

| 指标 | 查询1 (网络搜索) | 查询2 (简单回复) |
|------|------------------|------------------|
| SDK 初始化 | 1767ms | 9ms |
| TTFB (首次响应) | 3576ms | 12909ms |
| 总执行时间 | 21317ms | 13012ms |
| 结果类型 | 详细攻略 + WebSearch | "已收到" |

### 时间分布

```
查询1 (网络搜索) - 总计 21.3 秒:
├── 容器启动: 5ms (0.02%)
├── SDK 初始化: 1767ms (8.3%)
├── API TTFB: 1809ms (8.5%)
└── 执行+输出: 17.7s (83%) ← 包含 WebSearch

查询2 (简单回复) - 总计 13.0 秒:
├── SDK 初始化: 9ms (0.07%)  ← Session 复用极快
├── API TTFB: 12900ms (99%)  ← 瓶颈
└── 输出: 4ms (0.03%)
```

## 瓶颈分析

### 不是瓶颈
- **容器启动**: 5ms，几乎瞬间
- **SDK 初始化**: Session 复用后仅 9ms

### 主要瓶颈
- **API 响应时间**: 当前使用 `open.bigmodel.cn` 代理，响应不稳定
  - 简单回复需要 12.9 秒 TTFB
  - 网络搜索请求需要 3-18 秒

### API 端点测试

```bash
# 代理 API 响应速度
curl -w "TTFB: %{time_starttransfer}s\n" https://open.bigmodel.cn/api/anthropic
# 结果: 0.15 秒 (连接正常，但推理慢)
```

## 优化建议

| 优先级 | 方案 | 预期收益 |
|--------|------|----------|
| 高 | 切换到官方 API `api.anthropic.com` | 减少 50-80% API 延迟 |
| 中 | 使用更快的模型 (如 claude-3-haiku) | 减少推理时间 |
| 低 | 消息轮询改为事件驱动 | 减少平均 1 秒延迟 |

## 时间戳日志

已在 `container/agent-runner/src/index.ts` 添加详细时间戳日志：

```
[20:07:10.349] [+0ms] [perf] main: container started
[20:07:10.351] [+2ms] [perf] main: stdin read (2ms)
[20:07:10.353] [+5ms] [perf] runQuery: calling SDK query()
[20:07:12.120] [+1772ms] [perf] SDK: init complete (1767ms)
[20:07:13.929] [+3581ms] [perf] SDK: first assistant message (TTFB: 3576ms)
[20:07:31.670] [+21322ms] [perf] SDK: result #1 (total: 21317ms)
```

### 日志格式说明

```
[HH:MM:SS.mmm] [+累计ms] [类型] 消息
```

- `[perf]`: 性能日志，记录关键时间点
- `[agent-runner]`: 常规日志

### 查看日志

```bash
# 实时查看 systemd 日志
journalctl --user -u nanoclaw-fork -f

# 查看容器日志
docker logs <container-name> 2>&1 | grep -E "perf|agent-runner"
```

## 配置说明

关键配置项在 `src/config.ts`:

```typescript
export const POLL_INTERVAL = 2000;           // 消息轮询间隔
export const IPC_POLL_INTERVAL = 1000;       // IPC 轮询间隔
export const IDLE_TIMEOUT = 1800000;         // 容器空闲超时 (30分钟)
export const MAX_CONCURRENT_CONTAINERS = 5;  // 最大并发容器数
```