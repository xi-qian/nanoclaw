# Feishu Webhook 路径修改指南

以将 `/nanoclaw-andy` 改为 `/feishu-damo/events/andy` 为例。

## 背景

nanoclaw 通过 Higress Ingress + McpBridge 对外暴露 webhook，路径需同步修改三处：nanoclaw 配置、Higress 路由、飞书后台。

## 确认当前状态

先确认端口对应的服务和 Ingress：

```bash
# 端口 → 进程 → 服务
ss -tlnp | grep 8092
ps -p <pid> -o pid,args --no-headers      # 确认 WorkingDirectory
systemctl --user list-units --type=service | grep nanoclaw

# Higress 侧
docker exec higress cat /data/ingresses/nanoclaw-andy.yaml
docker exec higress cat /data/mcpbridges/default.yaml | grep -A3 nanoclaw-andy
```

## 修改步骤

### 1. 修改 nanoclaw .env

```bash
sed -i 's|FEISHU_WEBHOOK_PATH=/nanoclaw-andy|FEISHU_WEBHOOK_PATH=/feishu-damo/events/andy|' /data/user/qianxi/nanoclaw/.env
```

### 2. 修改 Higress Ingress

```bash
docker exec higress sed -i 's|path: /nanoclaw-andy|path: /feishu-damo/events/andy|' /data/ingresses/nanoclaw-andy.yaml
```

### 3. 重启服务

```bash
systemctl --user restart nanoclaw.service
docker restart higress
```

### 4. 验证

```bash
# 本地验证
curl -s -X POST 'http://127.0.0.1:8092/feishu-damo/events/andy'
# 返回 "Bad Request" 正常 — 说明路径匹配，缺少飞书 headers

# 外网验证
curl -sv -X POST 'http://moleagent.com:18080/feishu-damo/events/andy'
```

### 5. 更新飞书后台

在飞书开放平台修改 webhook 地址为新 URL。
