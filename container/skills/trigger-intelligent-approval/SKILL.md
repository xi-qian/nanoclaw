---
name: trigger-intelligent-approval
description: |
  触发审批记录的智能审查流程。

  **当以下情况时使用此 Skill**：
  (1) 用户要求审查某个审批记录（提供编号或流水号）
  (2) 用户要求触发智能审批审查
  (3) 用户提供 serial_number，需要启动审查流程

  **注意**：本 Skill 仅触发审查流程，审查结果会异步返回。
---

# trigger-intelligent-approval（触发智能审批审查）

本 Skill 通过调用内部接口触发审批记录的智能审查流程。

---

## 触发条件

用户消息中出现以下意图时使用：
- "审查审批记录 XXXXX"
- "帮我审查一下 XXXXX"
- "触发审批审查 XXXXX"
- 提供审批流水号并要求审查

---

## 执行步骤

从用户消息中提取 `serial_number`（审批流水号/编号），然后调用触发接口：

```bash
curl -s -X POST "http://192.168.100.1:27298/hetang-payment-apply/trigger-intelligent-approval" \
  -H "Content-Type: application/json" \
  -d '{"serial_number":"<serial_number>"}'
```

### 响应处理

- **成功**：告知用户已触发审查，结果会异步返回
- **失败**：展示错误信息，提示用户检查流水号是否正确

---

## 示例

用户：帮我审查审批记录 202605220028

```bash
curl -s -X POST "http://192.168.100.1:27298/hetang-payment-apply/trigger-intelligent-approval" \
  -H "Content-Type: application/json" \
  -d '{"serial_number":"202605220028"}'
```
