# 项目初始化 Skill

## 触发条件

以下情况发生时触发：
- **用户主动提出**：「创建项目」「初始化项目」「新建项目」「设置项目」
- 其他明确表示需要初始化/创建项目的表述

## 作用

在群组的 workspace 目录下创建 `project.md`，记录：
- 项目名称
- 项目管理表格地址
- 项目 App Token
- 数据表结构（Table ID 和用途）

## App Token 提取规则

从飞书多维表格 URL 中提取，格式：
```
https://<domain>.feishu.cn/base/<APP_TOKEN>?...
```
截取 `https://.../base/` 和第一个 `?` 之间的字符串即为 App Token。

## 执行步骤

### 第一步：获取用户提及的项目名称

向用户询问：「您想初始化哪个项目？请提供项目名称。」

用户回复项目名称后，进入第二步。

### 第二步：在项目表中查找匹配

在项目表（tblW0xITjmuIuTZb）中搜索用户提供的项目名称，查找是否有匹配：

- **完全匹配**：项目名称完全一致
- **模糊匹配**：项目名称中包含用户关键词（如「天津肿瘤医院冷冻消融」匹配「天津肿瘤医院 | 冷冻消融联合PD-L1...」）

### 第三步：确认或新建

**匹配到项目时：**
向用户展示匹配到的项目，确认：「在表格中找到了这个项目：「XXX」（编号：XXX），确认使用这个项目吗？」

- 用户确认 → 进入第三步写入 project.md
- 用户否认 → 询问是否需要新建项目记录

**未匹配到任何项目时：**
向用户确认：「在表格中没有找到「XXX」项目，是否需要新建一条项目记录？」

- 用户确认新建 → 询问项目编号等信息，先在项目表中新建记录，再写入 project.md
- 用户选择使用现有项目 → 请用户重新提供项目名称

### 第四步：获取管理表格地址

如果用户还未提供飞书管理表格地址，向用户询问：
「请提供这个项目的飞书多维表格链接」

### 第五步：读取并记录数据表结构

获取项目管理表格的字段和数据表信息：
1. 调用 `feishu_list_bitable_tables` 获取所有数据表（名称 + Table ID）
2. 对每个数据表调用 `feishu_list_bitable_fields` 获取字段列表
3. 整理数据表结构备用

### 第六步：创建 project.md

在 `/workspace/group/` 目录下创建 `project.md`，内容模板：

```markdown
# 项目配置

## 当前项目

* **项目名称**: <确认的项目名称>
* **管理表格**: <用户提供的飞书表格链接>
* **App Token**: <从链接中提取的 app_token>

## 数据表结构

| 数据表 | Table ID | 用途 |
|--------|----------|------|
| <表名1> | <Table ID 1> | <用途> |
| <表名2> | <Table ID 2> | <用途> |
...
```

## 工具说明

**查询项目表：**
```
feishu_list_bitable_records
- app_token: "<app_token>"
- table_id: "tblW0xITjmuIuTZb"
- page_size: 50
```

**新建项目记录：**
```
feishu_add_bitable_records
- app_token: "<app_token>"
- table_id: "tblW0xITjmuIuTZb"
- records: [{ fields: { 项目名称: "<项目名称>", 项目编号: "<编号>" } }]
```

**读取表格结构：**
```
feishu_list_bitable_tables
- app_token: "<app_token>"

feishu_list_bitable_fields
- app_token: "<app_token>"
- table_id: "<table_id>"
```

**创建项目文件：**
使用 Write 工具写入 `/workspace/group/project.md`
