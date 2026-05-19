# Higress Webhook 配置指南

使用 Higress API Gateway 配置 Feishu Webhook 回调，实现外网请求路由到内网 NanoClaw 服务。

## 架构概览

```
外网请求 (Feishu)
  │
  ▼
moleagent.com:18080 ──► Higress Gateway (docker) ──► 192.168.100.1:8090 ──► nanoclaw webhook server
                             │                         (docker host 网关)
                             │
                        Ingress + McpBridge 做路由
```

## 网络拓扑

| 组件 | IP/地址 | 说明 |
|------|---------|------|
| Higress all-in-one 容器 | `192.168.100.3` | Docker 网络 `damo-manager_gateway-net` |
| Docker 宿主机 | `192.168.100.1` | 容器通过此网关 IP 访问宿主机 |
| nanoclaw 服务 | `0.0.0.0:8090` | 监听所有接口（确保容器可访问） |

## NanoClaw 侧配置

### 环境变量

所有 webhook 相关环境变量，在 `.env` 或 systemd `EnvironmentFile` 中配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FEISHU_WEBHOOK_HOST` | `127.0.0.1` | 监听地址，容器访问宿主机时必须设为 `0.0.0.0` |
| `FEISHU_WEBHOOK_PORT` | `8080` | 监听端口 |
| `FEISHU_WEBHOOK_PATH` | `/feishu/webhook` | 回调 URL 路径 |
| `FEISHU_WEBHOOK_ENCRYPT_KEY` | — | 飞书事件加密密钥（可选，飞书后台配置） |
| `FEISHU_WEBHOOK_VERIFICATION_TOKEN` | — | 飞书验证 Token（可选，飞书后台配置） |

优先级：环境变量 > `credentials.json` 的 `webhook` 字段 > 默认值。

### 配置示例（.env）

```bash
# === 必须监听到 0.0.0.0，否则 Docker 容器无法访问 ===
FEISHU_WEBHOOK_HOST=0.0.0.0
FEISHU_WEBHOOK_PORT=8090
FEISHU_WEBHOOK_PATH=/feishu-nanoclaw-test
```

### 配置示例（credentials.json）

也可以在 `store/auth/feishu/credentials.json` 中配置：

```json
{
  "appId": "cli_xxx",
  "appSecret": "xxx",
  "mode": "webhook",
  "webhook": {
    "host": "0.0.0.0",
    "port": 8090,
    "path": "/feishu-nanoclaw-test"
  }
}
```

### 监听地址说明

默认值 `127.0.0.1` 仅允许本地进程访问。当 nanoclaw 和 Higress 不在同一容器时（Higress 在 Docker 内，nanoclaw 在宿主机），Docker 容器通过 `192.168.100.1` 网关访问宿主机，`127.0.0.1` 绑定无法被访问到，必须改为 `0.0.0.0`。

### 端口选择

避免与 Higress 自身端口冲突（Higress all-in-one 默认占用 8080）。建议使用 8090 或其他空闲端口。

### 启动服务

```bash
systemctl --user restart nanoclaw-test
# 检查监听
ss -tlnp | grep 8090
```

## Higress 配置

### 1. McpBridge — 注册后端服务

文件路径：Higress 容器内 `/data/mcpbridges/default.yaml`

```yaml
spec:
  registries:
    # nanoclaw-test 后端：指向宿主机 IP + 端口
    - domain: 192.168.100.1:8090
      name: nanoclaw-test
      port: 80
      protocol: http
      type: static
    # 其他 nanoproxy 后端（如有）...
```

- `domain`：实际后端地址 `192.168.100.1:8090`
- `name`：后端名称，供 Ingress 引用
- `type: static`：静态 IP 后端，不走 DNS 解析

### 2. Ingress — 配置路由规则

文件路径：Higress 容器内 `/data/ingresses/nanoclaw-test.yaml`

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    higress.io/destination: nanoclaw-test.static:80
    higress.io/ignore-path-case: "false"
  labels:
    higress.io/domain_higress-default-domain: "true"
    higress.io/resource-definer: higress
  name: nanoclaw-test
  namespace: higress-system
spec:
  ingressClassName: higress
  rules:
    - http:
        paths:
          - backend:
              resource:
                apiGroup: networking.higress.io
                kind: McpBridge
                name: default
            path: /feishu-nanoclaw-test
            pathType: Prefix
```

- `higress.io/destination`：格式为 `<mcpbridge-name>.<type>:<port>`，即 `nanoclaw-test.static:80`
- `path`：URL 路径，与 NanoClaw 的 `FEISHU_WEBHOOK_PATH` 一致
- `pathType: Prefix`：前缀匹配

### 3. 应用配置

修改 McpBridge 或 Ingress 后需要重启 Higress：

```bash
docker restart higress
```

## 外网端口

需要运维开放 Higress Gateway 的端口（本例为 18080），确保不被边缘代理（如 OpenResty）拦截。

如果边缘代理做了 HTTP→HTTPS 301 重定向，Feishu webhook 验证会收到 HTML 而非 JSON，导致验证失败报「返回数据不是合法的JSON格式」。

## 验证

从外网测试 webhook 端点：

```bash
curl -sv -X POST 'http://moleagent.com:18080/feishu-nanoclaw-test'
```

成功应返回 HTTP 200 + JSON：

```json
{"challenge":"test"}
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 404 text/plain | nanoclaw webhook 只接受 POST | 用 `-X POST` 测试 |
| 返回 HTML 而非 JSON | 边缘代理做了 301 重定向 | 开放 Higress 端口直连，绕过边缘代理 |
| 容器访问不到宿主 | nanoclaw 监听 127.0.0.1 | 改为 `FEISHU_WEBHOOK_HOST=0.0.0.0` |
| 端口冲突 | 8080 被 Higress 自身占用 | 用其他端口（如 8090） |

## 与 nginx 反向代理的对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| Higress Ingress | 统一网关管理，K8s 风格配置，可视化控制台 | 需维护容器内部配置文件 |
| nginx 反向代理 | 简单直接，宿主机直接配置 | 多实例时配置分散 |
