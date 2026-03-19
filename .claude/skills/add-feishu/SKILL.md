# Add Feishu Channel to NanoClaw

安装飞书（Lark/Feishu）通道支持，包括消息通讯和文档操作功能。

## 概述

此 Skill 将为 NanoClaw 添加以下功能：

- **消息通讯**：接收和发送飞书消息（私聊、群聊）
- **文档操作**：创建、读取、更新、搜索飞书云文档
- **企业功能**：（可选）日历、任务、多维表格等

## 架构说明

飞书集成采用 IPC（进程间通信）架构：

- Host 进程运行飞书 SDK，持有凭证
- 容器内的 Agent 通过 IPC 调用飞书 API
- 所有文档操作通过安全的 IPC 文件通信

## 步骤

### 1. 准备飞书应用

1. 访问飞书开放平台：https://open.feishu.cn/

2. 创建企业自建应用：
   - 登录飞书开放平台
   - 点击"创建自建应用"
   - 选择"企业自建应用"
   - 填写应用名称（如 "NanoClaw Assistant"）
   - 同意并创建

3. 获取凭证：
   - 在应用详情页，找到"凭证与基础信息"
   - 复制 `App ID` 和 `App Secret`

4. 配置权限：
   - 进入"权限管理"
   - 搜索并添加以下权限：
     - **必需权限**：
       - `im:message` - 获取与发送消息
       - `im:message:send_as_bot` - 以机器人身份发送
       - `doc:document` - 文档操作
       - `doc:document:readonly` - 文档读取
       - `drive:drive` - 云空间访问
     - **可选权限**（根据需要添加）：
       - `calendar:calendar` - 日历访问
       - `task:task` - 任务管理
       - `bitable:app` - 多维表格

5. 发布应用：
   - 在应用管理页面，点击"发布"
   - 选择版本并发布
   - 等待审核通过（通常几分钟）

### 2. 添加代码

以下文件已创建，无需手动操作：

- ✅ `src/channels/feishu.ts` - 飞书通道实现
- ✅ `src/feishu/types.ts` - 类型定义
- ✅ `src/feishu/client.ts` - 飞书 SDK 客户端封装
- ✅ `src/feishu/auth.ts` - 认证管理
- ✅ `src/feishu/logger.ts` - 日志记录器
- ✅ `src/channels/index.ts` - 已添加飞书通道导入
- ✅ `src/ipc.ts` - 已添加飞书 IPC 处理
- ✅ `container/agent-runner/src/ipc-mcp-stdio.ts` - 已添加飞书工具
- ✅ `package.json` - 已添加飞书 SDK 依赖

### 3. 配置认证

创建飞书凭证文件：

```bash
mkdir -p store/auth/feishu
cat > store/auth/feishu/credentials.json << 'EOF'
{
  "appId": "cli_xxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxx"
}
EOF
```

替换 `appId` 和 `appSecret` 为你在步骤 1 中获取的值。

### 4. 安装依赖

```bash
npm install
```

### 5. 编译并运行

```bash
npm run build
npm start
```

## 验证

### 测试消息功能

1. 在飞书中，搜索你的机器人应用名称
2. 向机器人发送消息：`@Andy 你好`
3. 检查日志确认连接成功

### 测试文档功能

向机器人发送以下指令测试：

```
@Andy 创建一个测试文档，标题为"Hello World"
@Andy 获取这个文档的内容：[文档ID或URL]
@Anna 搜索包含"项目计划"的文档
```

## 可用工具

Agent 可使用的飞书工具：

| 工具 | 描述 | 参数 |
|------|------|------|
| `feishu_fetch_doc` | 获取文档内容 | doc_id, offset?, limit? |
| `feishu_create_doc` | 创建文档 | title, markdown, folder_token?, wiki_node? |
| `feishu_update_doc` | 更新文档 | doc_id, markdown |
| `feishu_search_docs` | 搜索文档 | query, limit? |

## 故障排查

### 连接问题

**症状**：机器人无响应

**解决方案**：
1. 检查 `store/auth/feishu/credentials.json` 是否正确
2. 查看日志：`tail -f logs/nanoclaw.log`
3. 确认飞书应用已发布并审核通过

### 权限问题

**症状**：Agent 调用工具时返回权限错误

**解决方案**：
1. 检查飞书应用的权限配置
2. 确认已添加所需的权限（见步骤 1.4）
3. 重新发布应用

### 文档操作失败

**症状**：创建/更新文档失败

**解决方案**：
1. 确认文档 ID 或 URL 正确
2. 检查是否有该文档的编辑权限
3. 查看详细错误日志

## 进阶配置

### 指定品牌（飞书/Lark）

如果需要使用 Lark 而非 Feishu，修改 `src/feishu/client.ts`：

```typescript
this.client = new Lark.Client({
  appId,
  appSecret,
  domain: Lark.Domain.Lark, // 改为 Lark
});
```

### 调整超时时间

修改 `container/agent-runner/src/ipc-mcp-stdio.ts` 中的 `timeoutMs`：

```typescript
const result = await waitForFeishuResult(requestId, 60000); // 60秒
```

## 安全说明

- ✅ 凭证存储在 `store/auth/feishu/`（不会提交到 git）
- ✅ 凭证只在 Host 进程中，容器无法访问
- ✅ IPC 文件有权限保护
- ⚠️ 不要将 `credentials.json` 提交到版本控制系统
- ⚠️ 定期更新 `appSecret`

## 卸载

如需移除飞书集成：

```bash
# 删除凭证
rm -rf store/auth/feishu

# 删除代码文件
rm src/channels/feishu.ts
rm -rf src/feishu

# 恢复修改的文件
git checkout src/channels/index.ts src/ipc.ts container/agent-runner/src/ipc-mcp-stdio.ts

# 重新编译
npm run build
```

## 参考

- [设计文档](../../docs/DESIGN_FEISHU_INTEGRATION.md)
- [飞书开放平台文档](https://open.feishu.cn/document/)
- [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
