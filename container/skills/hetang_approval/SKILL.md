---
name: hetang-approval
description: >-
  荷塘员工发起公章/资质文件审批。给员工发 AppLink，员工自行在飞书客户端填表提交。
  主体和审批码仅从同目录 APPROVALS.md 读取，禁止臆造。
triggers:
  - 申请公章
  - 公章申请
  - 资质文件申请
  - 我要申请公章
  - 提交审批
  - 发起审批
---

# hetang_approval（荷塘审批 Skill）

本 Skill 处理荷塘员工的**公章 / 资质文件审批**申请，通过给员工发 AppLink 让其在飞书客户端自行填表提交。

---

## 数据源

**→ [`APPROVALS.md`](APPROVALS.md)**（含：`approval_name`、`approval_code`、`definition_id`、是否启用）

**硬门禁**：
1. 每次处理审批任务时，先读取 `APPROVALS.md`，只使用「启用」为「是」的行。
2. 禁止臆造或硬编码任何 `approval_code` / `definition_id`。
3. 员工未指明主体时，必须列出所有启用主体让员工选择，禁止默认指定。

---

## 执行步骤

1. 确认主体，从 `APPROVALS.md` 取 `definition_id`
2. 按终端判断规则拼装链接，交付给员工

### 终端判断与链接拼装

应用已申请 `im:user_agent:read` 时，飞书事件里会带 `message.user_agent`，**必须**从事件 JSON 按 key 读取并注入每轮上下文，**禁止**用正文长度或内容形态猜测。

**字段路径**：`event.message.user_agent` 或 `message.user_agent`（以线上实际 payload 为准）。

#### 情况 A：有 `user_agent`（只发一条链接）

| UA 含以下任一关键字 | 判定 | 只发 |
|---|---|---|
| `iPhone` / `iPad` / `iPod` / `CPU iPhone OS` / `Android` / `HarmonyOS` / `Mobile/` / `Mobile Safari` | 移动端 | ① |
| `Macintosh` / `Windows NT` / `Win64` / `X11` / `Linux`（且不含移动关键字） | PC | ② |

- 判为移动：回复中**禁止**出现「电脑」「电脑端」`mode=appCenter` 或 ② 的 URL
- 判为 PC：回复中**禁止**出现「手机飞书」「手机端」或 ① 的 URL
- **禁止**同时发 ① 和 ②；**禁止**「第一条/第二条」话术

#### 情况 B：无 `user_agent`

- 员工明确说「手机/电脑」→ 只给对应一条
- 终端不明 → 可同时给 ① 和 ②，首句用**中性**话术（如「请按您所用设备选择」），链接文字用「手机端」「电脑端」区分，**禁止**用「第一/第二」

#### 链接模板（`definition_id` 来自 `APPROVALS.md`）

**① 手机端**
```
https://applink.feishu.cn/client/mini_program/open?appId=cli_9cb844403dbb9108&path=pages%2Fapproval-form%2Findex%3Fid%3D<definition_id>
```

**② 电脑端（应用中心）**
```
https://applink.feishu.cn/client/mini_program/open?mode=appCenter&appId=cli_9cb844403dbb9108&path=pc%2Fpages%2Fcreate-form%2Findex%3Fid%3D<definition_id>
```

- 每条必须写成 **Markdown 可点击链接**：`[说明文字](完整URL)`
- **禁止**用代码块包裹链接行（代码块内链接不可点击）
- **禁止**只给裸 URL

#### 多轮对话注意

用户后续只发数字选项（如 `1`～`4`）或极短确认时，正文里没有 UA 信息；集成侧须对**当次事件 JSON** 再取 `message.user_agent` 并注入上下文，或缓存最近一次非空 UA。**禁止**因回复很短就省略注入。

---

## 禁止事项

- **禁止**未确认主体就拼装链接
- **禁止**使用 `APPROVALS.md` 中未出现的 `definition_id`
- **禁止**在回复中粘贴 `feishu.cn/wiki` 链接作为前置步骤
- **禁止**只给裸 URL，必须是 Markdown 可点击链接

---

## 依赖

- 主体数据：同目录 `APPROVALS.md`
- 参考文档：[打开飞书审批（AppLink）](https://open.feishu.cn/document/applink-protocol/supported-protocol/open-an-approval-page)
