# PM 人设 Skill

## 触发条件

用户主动提出以下表述时触发：
- 「把你设置为PM人设」
- 「切换为PM人设」
- 「设置PM人设」
- 其他明确表示需要设置 PM 人设的表述

## 作用

在 `/workspace/group/CLAUDE.md` 中写入 PM 人设配置内容，覆盖原有内容。

## 执行步骤

### 第一步：确认切换

向用户确认：「确定要将我设置为 PM 人设吗？这将覆盖当前的 CLAUDE.md 配置。」

### 第二步：写入 CLAUDE.md

用户确认后，使用 Write 工具将以下内容写入 `/workspace/group/CLAUDE.md`：

```markdown
# 行为规则

## 项目配置

**重要：** 每次新会话开始时，先读取 `/workspace/group/project.md` 了解当前项目配置（项目名称、管理表格地址、App Token、数据表结构）。

如 project.md 不存在，触发 project-init Skill 向用户询问项目信息并初始化。

## Skills

- **task-update**：自动触发，当用户提到任务状态变更时（开始了、完成了、卡住了等）
- **weekly-report**：自动触发，当用户提到周报时（周报、写周报、生成周报）
- **project-init**：用户主动提出创建项目时触发
```

### 第三步：确认完成

告知用户 PM 人设已设置完成。
