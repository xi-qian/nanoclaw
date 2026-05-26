---
name: ido-approve-review
description: |
  付款/合同审批智能审查工具。接受 instance_code（UUID 格式），执行审查并生成建议卡。

  **触发方式**：通常由 webhook 自动触发，prompt 中已包含实际的 instance_code。
  当 prompt 直接要求使用本 skill 时，直接执行，不要重定向到其他 skill。
  trigger-intelligent-approval 是另一个 skill，仅用于用户在聊天中主动提供 serial_number 的场景，与本 skill 无关。

  **重要说明**：
  - 必须提供审批实例 ID (instance_code)
  - 依据同目录 STANDARDS.md 执行标准进行审查
  - 通过 API.md 定义的数据接口查询相关数据
  - 审查结果写入飞书审批备注并上传飞书文档
---

# ido-approve-review（审批智能审查 Skill）

本 Skill 对付款审批或合同审批实例进行智能审查，生成符合 IDO SPACE 标准的建议卡。

---

## 执行流程

### 1. 获取审批实例基本信息

调用飞书 MCP 工具获取审批实例详情：

```
feishu_approval_get_instance(instance_code: "审批实例ID")
```

获取关键信息：
- `approval_code`: 审批定义 Code（用于判断审批类型）
- `instance_code`: 审批实例 Code
- `status`: 审批实例状态
- `form`: 表单数据

### 2. 判断审批类型并查询数据

根据 `approval_code` 判断是付款审批还是合同审批，调用对应的 API 查询详细数据：

| 审批类型 | API 接口 |
|---------|---------|
| 付款审批 | `GET http://192.168.100.1:27298/hetang-payment-apply/data/payment/{instance_code}` |
| 合同审批 | `GET http://192.168.100.1:27298/hetang-payment-apply/data/contract/{instance_code}` |

使用 `curl` 命令调用 API：

```bash
curl -s "http://192.168.100.1:27298/hetang-payment-apply/data/payment/{instance_code}"
```

返回数据包含：
- 金额、供应商、合同关联、附件 OCR 等
- 关联的合同实例编码 `contract_instance_codes`
- 关联的采购实例编码 `related_buy_instance_codes`

### 3. 查询关联数据（如有）

根据返回的关联编码查询合同、采购、项目数据：

```
# 查询关联合同
curl -s "http://192.168.100.1:27298/hetang-payment-apply/data/contract/{contract_instance_code}"

# 查询关联采购
curl -s "http://192.168.100.1:27298/hetang-payment-apply/data/buy/{buy_instance_code}"

# 查询项目（如有项目编码）
curl -s "http://192.168.100.1:27298/hetang-payment-apply/data/project/{project_code}"
```

### 4. 依据标准进行审查

读取同目录的 `IDO_SPACE_审批Agent执行标准_v1.2.md` 作为审查标准。

#### 付款审批五项判断

按标准第四章执行五项判断：

| 判断项 | 检查内容 |
|-------|---------|
| **真实性** (F1-F5) | 合同、发票、验收、供应商账户是否一致 |
| **合规性** (R1-R5) | 付款节点、预算规则、合同条款是否满足 |
| **必要性** (N1-N7) | 为什么现在要付，不付的影响 |
| **价值性** (V1-V8) | 付款对应的投入产出是否成立 |
| **承受性** (C1-C5) | 现金流是否支持本次付款 |

#### 合同审批七项判断

按标准第五章执行七项判断：

| 判断项 | 检查内容 |
|-------|---------|
| **场景归因** | 合同从哪个真实业务场景来 |
| **真实性** | 交易背景和合同信息真实性 |
| **合规性** | 法律红线、标准模板、授权审批 |
| **风险性** | 权利义务和条款风险 |
| **必要性** | 现在是否有必要签 |
| **价值性** | 签了是否值得 |
| **履约性** | 企业能否做到 |

### 5. 生成建议卡

按标准第八章模板生成建议卡，包含：

```
## 付款/合同审批建议卡：{审批单号}

### 建议动作：{通过/条件通过/不通过/驳回补材料/暂缓/升级特批}
### 风险等级：{低/中/中高/高}
### 建议信心：{高/中/低}——{信心来源说明}

### 主判定
{最核心问题的一句话说明}

### 关键证据 / 异常点
| 证据点 | 内容 | 影响的判断项 |
|-------|------|-------------|
| ... | ... | ... |

### 五项/七项判断摘要
真实性：{结论}｜{关键描述}
合规性：{结论}｜{关键描述}
必要性：{结论}｜{关键描述}
价值性：{结论}｜{关键描述}
承受性：{结论}｜{关键描述}

### 条件明细（仅条件通过时）
| # | 条件内容 | 责任人 | 截止时间 | 逾期处理 |
|-------|---------|---------|---------|---------|
| ... | ... | ... | ... |

### AI 建议方案
{具体建议方案}

### 需补充 / 确认
| 缺口 | 补充人 | 优先级 |
|-------|-------|-------|
| ... | ... | P0/P1/P2 |
```

### 6. 写入审批备注

调用飞书 MCP 工具将 **AI 建议方案**（建议卡中"AI 建议方案"部分）写入审批备注，同时 @ 审批任务负责人和提交人。

**步骤 A：获取用户姓名**

从步骤 1 获取的审批实例中提取：
- **提交人 open_id**：`data.instance.initiator` 字段
- **当前审批任务负责人 open_id**：`data.instance.task_list` 中状态为 PENDING 的任务的 `user_id` 字段

调用工具解析姓名：
```
feishu_get_user_name(
  open_ids: ["提交人open_id", "审批人open_id"]
)
```

**步骤 B：发送评论并 @ 相关人**

**重要：content 参数格式要求**
- content 必须是 JSON 字符串，包含 `text` 字段，不能是纯文本
- 正确格式：`'{"text": "评论内容"}'`
- 错误格式：`"评论内容"` 或 `'评论内容'`
- 文本中不能包含未转义的双引号，需用中文引号或单引号替代
- @ 提及**必须集中在文本开头**，不要穿插在正文中，避免 offset 计算错误导致文字错乱
- 要 @ 用户时，在 text 中对应位置写 `@姓名`，并在 at_info_list 中声明位置

```
feishu_approval_comment(
  instance_id: "审批实例ID",
  content: '{"text": "@审批人姓名 @提交人姓名 AI 建议方案内容"}',
  at_info_list: [
    { user_id: "审批人open_id", name: "审批人姓名", offset: "0" },
    { user_id: "提交人open_id", name: "提交人姓名", offset: "审批人姓名长度+1" }
  ]
)
```

**offset 计算规则**：从 `@` 符号开始计算，`@` 占 1 个字符，姓名从 offset 位置开始。第一个 @ 的 offset 为 0。

**注意**：如果审批实例状态为 REJECTED（已结束），飞书 API 可能不允许追加评论（错误码 60001/60003）。此时应跳过备注写入步骤，仅上传飞书文档即可。

### 7. 上传飞书文档并链接

将完整建议卡上传为飞书文档，并把链接追加到备注：

```
# 使用 lark-doc skill 创建飞书文档
# 将完整建议卡内容作为 Markdown 写入文档

# 获取文档链接后追加到备注
feishu_approval_comment(
  instance_id: "审批实例ID",
  content: '{"text": "完整审查报告见飞书文档：https://..."}'
)
```

**注意**：如果审批实例状态为 REJECTED（已结束），飞书 API 可能不允许追加评论（错误码 60001/60003）。此时应跳过备注写入步骤，仅上传飞书文档即可。

### 8. 设置文档权限

创建飞书文档后，调用权限设置接口将文档设置为组织内可阅读，使提交人和所有审批参与人都能查看：

```
feishu_update_public_setting(
  token: "文档 token（从创建文档返回的 URL 中提取，如 https://feishu.cn/docx/xxxxxx 中的 xxxxxx）",
  file_type: "docx",
  link_share_entity: "tenant_readable"
)
```

---

## API 接口说明

详细接口定义见同目录 `api.md`。

### Base URL

- 内网：`http://192.168.100.1:27298`

### 主要接口

| 接口 | 说明 |
|------|------|
| `/hetang-payment-apply/data/payment/{instance_code}` | 查询付款数据 |
| `/hetang-payment-apply/data/contract/{instance_code}` | 查询合同数据 |
| `/hetang-payment-apply/data/buy/{instance_code}` | 查询采购数据 |
| `/hetang-payment-apply/data/project/{project_code}` | 查询项目数据 |
| `/hetang-payment-apply/data/search?q={keyword}&scope={scope}` | 模糊搜索 |

---

## 审查标准说明

详细执行标准见同目录 `IDO_SPACE_审批Agent执行标准_v1.2.md`。

### 核心原则

- 判断可追溯：每个结论必须附带信息来源
- 量化优于定性：金额、风险必须有阈值标准
- 条件可关闭：条件必须包含四要素
- 证据对应金额：附件描述必须逐项列出
- 禁止主观断言：如「不需要合同」「金额较小」

### 禁止表述

| 禁止表述 | 替代表述 |
|---------|---------|
| 「不需要合同」 | 「未查询到合同先例，建议法务确认」 |
| 「金额较小」 | 「按公司阈值标准属『小』级别」 |
| 「价格合理」 | 「价格较历史均价偏差 X%」 |

---

## 输出要求

1. **建议卡格式**：严格遵循标准第八章模板
2. **附件描述**：必须包含文件名、对应金额、凭证类型、风险评估
3. **条件四要素**：内容 + 责任人 + 截止时间 + 逾期处理
4. **建议信心**：高/中/低 + 信心来源说明

---

## 依赖文件

- `IDO_SPACE_审批Agent执行标准_v1.2.md` — 审查执行标准
- `api.md` — 数据查询接口定义
