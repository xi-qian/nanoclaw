# hetang-payment 对外接口

Base URL 示例：`http://<host>:27298`

内网： http://192.168.100.1:27298/

## 通用说明

- 查询类接口均为 `GET`；数据推送类接口为 `POST`，见第 8 节
- 查询成功：`200`，格式 `{"ok": true, "data": {...}}` 或 `{"ok": true, ...}`（视接口而定）
- 未找到：`404`，格式 `{"detail": "..."}`
- 参数错误：`400`
- 数据库异常：`500`，格式 `{"detail": "..."}`

### 公共约定

| 约定 | 说明 |
| --- | --- |
| `project_code` | 表单「所属项目」多选时，多个 `payment_apply_projects.project_code` 以英文逗号连接 |
| `expense_date` | 费用/特殊事项日期时间，格式 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM`（到分钟） |
| `attachments_ocr_text` | JSON 字符串，key 为附件文件名（含业务前缀，见各接口说明）；普通附件 value 为 OCR 文本字符串；**zip/7z 压缩包** value 为嵌套对象（key=包内相对路径，value=OCR 文本，策略 A） |
| `attachments_json` | JSON 字符串，含 `ext`（文件名，含前缀）与 `value`（飞书 URL 列表）；仅特殊事项行等场景返回 |
| 不返回字段 | 内部键值 `*_key`、`parsed_form_items_json`、`created_at`、`update_at`；主表 `invoice_attachments_json` 不对外（发票 OCR 见 `attachments_ocr_text`）；付款主表 `budget_items_json`（资金预算明细）、采购主表 `upload_detail_attachments`（上传采购明细附件元数据）不对外 |
| 子表关联键 | 子表行均含 `approval_code`、`instance_code`；明细另有 `line_no`（特殊事项另有 `special_type`） |

### 采购 / 合同 / 付款 近期新增字段一览

| 流程 | 表 | 新增对外字段 | 查询接口 | 搜索接口 |
| --- | --- | --- | --- | --- |
| 付款 | `payment_apply_payment` | `project_code`、`has_affiliated_project_text`、`is_rd_expense_text`、`is_daily_expense_text`、`attachments_ocr_text` | 已支持（`SELECT *` 自动透出） | 已支持搜索 `project_code`、`has_affiliated_project_text`、`is_rd_expense_text`、`is_daily_expense_text`、`contract_instance_codes` |
| 采购（旧） | `payment_apply_buy` | `project_code`、`attachments_ocr_text` | 已支持 | 未纳入搜索字段 |
| 采购（v2） | `payment_apply_buy_v2` | `supplier_type_text`、`temp_supplier_remark`（替代原 `supplier_name`） | 已支持 | 已支持搜索上述字段 |
| 合同 | `payment_apply_contract` | `project_code`、`has_affiliated_project_text`、`is_rd_expense_text`、`is_daily_expense_text`、`related_buy_instance_codes`、`counterparty_contact`、`attachments_ocr_text` | 已支持 | 已支持搜索 `project_code`、`has_affiliated_project_text`、`is_rd_expense_text`、`is_daily_expense_text`、`counterparty_contact`、`related_buy_instance_codes` |

> 付款流程数据库另有 `budget_items_json`（资金预算明细），按内部字段处理，查询与搜索均不返回。

## 1) 查询付款数据

- **URL**: `/hetang-payment-apply/data/payment/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_payment`

### 业务字段说明（data 内）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码（付款流程固定模板） |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态：`PENDING` / `APPROVED` / `REJECTED` 等 |
| `topic` | string | 主题 |
| `project_code` | string | 所属项目编号，多选逗号连接 |
| `has_affiliated_project_text` | string | 是否有所属项目（是/否） |
| `is_rd_expense_text` | string | 是否是公司层面研发费用（是/否） |
| `is_daily_expense_text` | string | 是否是公司层面日常费用（是/否） |
| `amount` | number | 金额（元） |
| `apply_type_text` | string | 付款申请类型（文本） |
| `has_contract_text` | string | 是否有关联合同（文本） |
| `contract_instance_codes` | string | 关联合同实例编码，逗号分隔 |
| `pay_account_text` | string | 支付账户（文本） |
| `pay_method_text` | string | 支付方式（文本） |
| `payee_info` | string | 收款方信息 |
| `remark` | string | 备注 |
| `attachments_ocr_text` | string | 附件 OCR 汇总 JSON |

### 请求示例

`GET /hetang-payment-apply/data/payment/618C5EDD-2960-4D80-AC9B-DBECB5B39C43`

### 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": 128,
    "approval_code": "2C701485-AF89-4FB3-AA63-EFEDA4A0BD14",
    "instance_code": "618C5EDD-2960-4D80-AC9B-DBECB5B39C43",
    "approval_name": "北京荷塘生华 付款申请",
    "serial_number": "202605170021",
    "instance_status": "APPROVED",
    "topic": "供应商付款-聚合美",
    "project_code": "HTSH-26-NK-006",
    "has_affiliated_project_text": "是",
    "is_rd_expense_text": "否",
    "is_daily_expense_text": "否",
    "amount": "35200.00",
    "apply_type_text": "货款",
    "has_contract_text": "有",
    "contract_instance_codes": "56BF55C5-0826-4265-9E4D-827A59D79357",
    "pay_account_text": "北京荷塘生华-工行",
    "pay_method_text": "银行转账",
    "payee_info": "北京聚合美生物科技有限公司",
    "remark": "合同约定首付款",
    "attachments_ocr_text": "{\"付款申请单.pdf\":\"# 付款申请\\n金额：35200 元\\n...\"}"
  }
}
```

---

## 2) 查询采购数据（旧流程）

- **URL**: `/hetang-payment-apply/data/buy/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_buy`（审批模板 `F753B844-865B-4B3D-B44A-544F3178F8F1`，采购申请）

### 业务字段说明（data 内）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码（采购流程固定模板） |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态 |
| `topic` | string | 主题 |
| `project_code` | string | 所属项目编号，多选逗号连接 |
| `buy_type_text` | string | 采购类型（文本） |
| `total_amount` | number | 采购总金额（元） |
| `supplier_type_text` | string | 供应商类型（文本） |
| `contract_template_text` | string | 合同模板（文本） |
| `attachments_ocr_text` | string | 附件 OCR 汇总 JSON |

### 请求示例

`GET /hetang-payment-apply/data/buy/A61916FB-4B27-4981-8260-F79DB0D6AE07`

### 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": 66,
    "approval_code": "F753B844-865B-4B3D-B44A-544F3178F8F1",
    "instance_code": "A61916FB-4B27-4981-8260-F79DB0D6AE07",
    "approval_name": "北京荷塘生华 采购申请",
    "serial_number": "202605160009",
    "instance_status": "APPROVED",
    "topic": "细胞培养耗材采购",
    "project_code": "HTSH-26-NK-006",
    "buy_type_text": "物料采购",
    "total_amount": "9800.00",
    "supplier_type_text": "长期供应商",
    "contract_template_text": "无",
    "attachments_ocr_text": "{\"采购明细.xlsx\":\"采购清单\\n1. 培养基 ...\"}"
  }
}
```

---

## 2b) 查询采购新流程数据（v2）

- **URL**: `/hetang-payment-apply/data/buy-v2/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_buy_v2`（审批模板 `6F2782E2-6312-437B-8DC3-A8720757484A`，采购新流程申请）

### 业务字段说明（data 内）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码（固定为采购新流程） |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态 |
| `apply_department_name` | string | 申请部门名称 |
| `apply_department_open_id` | string | 申请部门 open_id |
| `is_project_payment_text` | string | 是否为项目付款（是/否） |
| `project_code` | string | 所属项目编号，多选逗号连接；非项目付款或无「所属项目」控件时可能为空 |
| `is_rd_expense_text` | string | 是否为公司层面研发费用（是/否） |
| `is_daily_expense_text` | string | 是否为公司层面日常费用（是/否） |
| `buy_type_text` | string | 采购类型（文本） |
| `procurement_content` | string | 采购内容 |
| `apply_company_text` | string | 申请公司（文本） |
| `total_amount` | number | 采购总金额（元） |
| `supplier_type_text` | string | 物料供应商信息（文本，与旧采购同名字段含义） |
| `temp_supplier_remark` | string | 临时合格供应商说明（选「临时合格供应商」时填写） |
| `remark` | string | 备注 |
| `attachments_ocr_text` | string | 附件 OCR 汇总 JSON（上传采购明细等） |

> 与旧采购接口差异：v2 **无** `topic`、`contract_template_text`；**有** 申请部门、是否项目付款、公司层面费用、采购内容、申请公司、临时供应商说明等。

### 请求示例

`GET /hetang-payment-apply/data/buy-v2/<instance_code>`

### 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "approval_code": "6F2782E2-6312-437B-8DC3-A8720757484A",
    "instance_code": "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
    "approval_name": "采购新流程申请",
    "serial_number": "202606020001",
    "instance_status": "PENDING",
    "apply_department_name": "企管部",
    "apply_department_open_id": "od-8b1c999dee949396eba8d66b0b616369",
    "is_project_payment_text": "是",
    "project_code": "0",
    "is_rd_expense_text": "否",
    "is_daily_expense_text": "否",
    "buy_type_text": "办公用品",
    "procurement_content": "哈哈哈",
    "apply_company_text": "北京水木生华医疗科技有限公司",
    "total_amount": "777.00",
    "supplier_type_text": "临时合格供应商",
    "temp_supplier_remark": "临时说明",
    "remark": "新飞猪",
    "attachments_ocr_text": "{\"Screenshot_....jpg\":\"...\"}"
  }
}
```

### 错误说明

| HTTP | detail 示例 |
| --- | --- |
| `404` | `未找到采购新流程记录: instance_code=...` |
| `500` | `查询 payment_apply_buy_v2 失败: ...` |

---

## 3) 查询项目数据

- **URL**: `/hetang-payment-apply/data/project/{project_code}`
- **说明**: 按 `project_code` 查询 `payment_apply_projects`

### 业务字段说明（data 内）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `project_code` | string | 项目编码（唯一） |
| `project_name` | string | 项目名称 |
| `global_pi` | string | 总负责人 |
| `pipeline_directive` | string | 管线方向 |
| `ethics_review_passed` | string | 伦理审批状态 |
| `indications` | string | 适应症 |
| `chassis_cell` | string | 底盘细胞 |
| `target` | string | 靶点 |
| `hospital` | string | 医院 |
| `department` | string | 科室 |
| `pi` | string | PI |
| `progress` | string | 进度 |
| `risk_level` | string | 风险等级 |
| `risk` | string | 风险描述 |
| `pending_coordinate_matters` | string | 待协调事项 |
| `project_budget` | number | 项目预算 |
| `update_date_time` | string | 更新日期 |
| `task_num` | int | 任务数 |
| `task_completion_rate` | string | 任务完成率 |
| `mark` | string | 备注 |
| `doc_link` | string | 文档链接 |
| `parent_id` | string | 父级项目 ID |

### 请求示例

`GET /hetang-payment-apply/data/project/HTSH-26-NK-006`

### 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": 12,
    "project_code": "HTSH-26-NK-006",
    "project_name": "北京高博医院 | 评价自体NK细胞治疗实体瘤的安全性和有效性的单臂、开放、单次/多次用药、单中心临床试验",
    "global_pi": "刘鸿飞",
    "pipeline_directive": "评价自体NK细胞治疗实体瘤的安全性和有效性的单臂、开放、单次/多次用药、单中心临床试验",
    "ethics_review_passed": "是",
    "indications": "实体瘤",
    "chassis_cell": "自体NK细胞",
    "target": "无",
    "hospital": "北京高博医院",
    "department": "胸外科",
    "pi": "秦海峰",
    "progress": "高博秦海峰主任NK针对实体瘤项目，因8月8号文件正式执行，相关项目暂缓执行。",
    "risk_level": "中风险",
    "risk": "因8月8号文件正式执行，高博医院全院IIT研究NK项目暂缓执行，需等待政策明朗后恢复。",
    "pending_coordinate_matters": "",
    "project_budget": 0,
    "task_num": 0,
    "task_completion_rate": "0",
    "mark": "1",
    "doc_link": "",
    "parent_id": null
  }
}
```

---

## 4) 查询合同数据

- **URL**: `/hetang-payment-apply/data/contract/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_contract`

### 业务字段说明（data 内）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码（9 个合同流程之一） |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态 |
| `topic` | string | 主题 |
| `project_code` | string | 所属项目编号，多选逗号连接 |
| `has_affiliated_project_text` | string | 是否有所属项目（是/否） |
| `is_rd_expense_text` | string | 是否是公司层面研发费用（是/否） |
| `is_daily_expense_text` | string | 是否是公司层面日常费用（是/否） |
| `seal_type_text` | string | 盖章类型（文本） |
| `contract_template_text` | string | 合同模板（文本） |
| `contract_type_text` | string | 合同类型（文本） |
| `purpose` | string | 目的 |
| `contract_no` | string | 合同编号 |
| `counterparty_name` | string | 对方单位名称 |
| `counterparty_owner` | string | 对方负责人 |
| `counterparty_contact` | string | 对方联系方式 |
| `amount` | number | 金额（元） |
| `related_buy_instance_codes` | string | 关联采购申请实例编码，逗号分隔 |
| `remark` | string | 备注 |
| `attachments_ocr_text` | string | 附件 OCR 汇总 JSON |

### 请求示例

`GET /hetang-payment-apply/data/contract/56BF55C5-0826-4265-9E4D-827A59D79357`

### 成功响应示例

```json
{
  "ok": true,
  "data": {
    "id": 301,
    "approval_code": "1B8B163C-F4F3-4733-B7C0-C73120240917",
    "instance_code": "56BF55C5-0826-4265-9E4D-827A59D79357",
    "approval_name": "广东荷塘生华 合同审核流程",
    "serial_number": "202605110003",
    "instance_status": "APPROVED",
    "topic": "液氮采购-广州粤佳气体有限公司",
    "project_code": "HTSH-26-NK-006",
    "has_affiliated_project_text": "是",
    "is_rd_expense_text": "否",
    "is_daily_expense_text": "否",
    "seal_type_text": "合同专用章",
    "contract_template_text": "无",
    "contract_type_text": "采购类",
    "purpose": "用于广州生产细胞储存",
    "contract_no": "无",
    "counterparty_name": "广州粤佳气体有限公司",
    "counterparty_owner": "陈志文",
    "counterparty_contact": "13800138000",
    "amount": "1200.00",
    "related_buy_instance_codes": "A61916FB-4B27-4981-8260-F79DB0D6AE07",
    "remark": "1200 元 / 罐（195L），月结",
    "attachments_ocr_text": "{\"液氮采购合同.pdf\":\"采购合同\\n甲方:...\\n乙方:...\"}"
  }
}
```

---

## 错误响应示例

### 未找到

```json
{
  "detail": "未找到合同记录: instance_code=xxx"
}
```

### 数据库异常

```json
{
  "detail": "查询 payment_apply_contract 失败: ..."
}
```

---

## 5) 查询费用报销数据

- **URL**: `/hetang-payment-apply/data/expense-reimbursement/{instance_code}`
- **Method**: `GET`
- **说明**: 按 `instance_code` 查询旧费用报销主表及全部明细（生产 `2CA3FB36-1000-4022-A27B-57B7AF7CF0B9` / 测试 `9C15548B-F967-48EB-A22E-2BA4FAA5CD8C`）

主表字段与子表数组**同级**，均在 `data` 内。无数据的子表数组为空数组 `[]`。

### 5.0 主表字段（data 根级）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码 |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态 |
| `reimbursement_type_texts` | string | 报销类型多选文本，逗号连接（差旅费/业务招待费/其他日常费用） |
| `company_text` | string | 所属公司 |
| `total_amount` | number | 费用合计（含超额或特殊事项费用） |
| `has_special_expense_text` | string | 是否涉及超标或特殊事项（如 `否` / `是（业务招待费）` / `是（其他日常）` / `是（差旅费）`） |
| `trip_apply_instance_codes` | string | 出差申请关联实例编码，逗号分隔（仅含差旅费时可能有值） |
| `travel_purpose` | string | 差旅目的 |
| `travel_origin` | string | 起始地 |
| `travel_destination` | string | 目的地 |
| `form_remark` | string | 备注 |
| `attachments_ocr_text` | string | **仅**主表「附件：发票及明细」的 OCR 汇总 JSON；文件名前缀 `invoice_` |

### 5.1 子表 `travel_lines[]`（差旅费报销明细）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `line_no` | int | 行号，从 1 起 |
| `expense_date` | string | 日期，到分钟 |
| `category_text` | string | 费用说明（如高铁、网约车） |
| `origin` | string | 起始地 |
| `destination` | string | 目的地 |
| `amount` | number | 金额（元） |
| `receipt_count` | int | 单据张数 |
| `line_remark` | string | 备注 |
| `project_code` | string | 所属项目编号，多选逗号连接 |

### 5.2 子表 `entertainment_lines[]`（业务招待报销明细）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `line_no` | int | 行号 |
| `expense_date` | string | 日期，到分钟 |
| `guest_target` | string | 招待对象 |
| `guest_count` | int | 招待人数 |
| `entertainment_reason` | string | 招待事由 |
| `invoice_count` | int | 发票张数 |
| `amount` | number | 业务招待报销金额（元） |
| `project_code` | string | 所属项目编号 |

### 5.3 子表 `daily_lines[]`（日常费用报销明细）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `line_no` | int | 行号 |
| `expense_reason` | string | 报销事由 |
| `invoice_count` | int | 发票张数 |
| `amount` | number | 报销金额（元） |
| `project_code` | string | 所属项目编号 |

> 日常费用明细表单无「日期」字段，故本表无 `expense_date`。

### 5.4 子表 `special_lines[]`（特殊事项说明）

对应表单 fieldList：`差旅特殊事项说明` / `业务招待特殊事项说明` / `其他日常特殊事项说明`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `special_type` | string | 类型：`travel`（差旅）/ `entertainment`（业务招待）/ `daily`（其他日常） |
| `line_no` | int | 该类型内行号，从 1 起 |
| `expense_date` | string | 日期，到分钟 |
| `category_texts` | string | 差旅特殊事项多选文本，逗号连接（**仅** `special_type=travel` 时有值） |
| `reason` | string | 事由 |
| `excess_amount` | number | 超出报销标准部分金额（元） |
| `project_code` | string | 所属项目编号 |
| `attachments_json` | string | 行内「附件」元数据 JSON |
| `attachments_ocr_text` | string | 行内附件 OCR 汇总 JSON |

**行内附件文件名前缀**

| `special_type` | 前缀示例 |
| --- | --- |
| `travel` | `special_travel_L1_原文件名.jpg` |
| `entertainment` | `special_ent_L1_原文件名.jpg` |
| `daily` | `special_daily_L1_原文件名.jpg` |

### 返回结构示例

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "approval_code": "9C15548B-F967-48EB-A22E-2BA4FAA5CD8C",
    "instance_code": "4D629FF8-5CB1-4209-A4BB-EBFE1ACF17F7",
    "serial_number": "202605270022",
    "reimbursement_type_texts": "业务招待费,其他日常费用",
    "total_amount": "785.00",
    "has_special_expense_text": "是（业务招待费）",
    "attachments_ocr_text": "{\"invoice_IMG.jpg\":\"...\"}",
    "travel_lines": [],
    "entertainment_lines": [ { "line_no": 1, "expense_date": "2026-05-27 01:51", "..." : "..." } ],
    "daily_lines": [ { "line_no": 1, "..." : "..." } ],
    "special_lines": [ { "special_type": "entertainment", "line_no": 1, "expense_date": "2026-05-27 14:51", "..." : "..." } ]
  }
}
```

---

## 5.5) 查询出差费用报销数据

- **URL**: `/hetang-payment-apply/data/travel-expense-reimbursement/{instance_code}`
- **Method**: `GET`
- **说明**: 按 `instance_code` 查询出差费用报销（生产 `73ED8C14-29E7-4B5F-90B4-663D36D4A78F` / 测试 `FF106475-6689-4370-A67E-AB788623A506`）

主表字段与子表数组**同级**，均在 `data` 内。

### 5.5.1 主表字段（data 根级）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 主键 |
| `approval_code` | string | 审批模板编码 |
| `instance_code` | string | 审批实例编码 |
| `approval_name` | string | 审批模板名称 |
| `serial_number` | string | 审批单号 |
| `instance_status` | string | 实例状态 |
| `project_code` | string | 表单顶层「所属项目」，多选逗号连接 |
| `company_text` | string | 所属公司 |
| `total_amount` | number | 费用合计（含超额或特殊事项费用） |
| `has_special_expense_text` | string | 是否涉及超标或特殊事项 |
| `trip_apply_instance_codes` | string | 出差申请关联实例编码 |
| `travel_purpose` | string | 差旅目的 |
| `travel_origin` | string | 起始地 |
| `travel_destination` | string | 目的地 |
| `form_remark` | string | 备注 |
| `attachments_ocr_text` | string | **仅**主表「附件：发票及明细」OCR；文件名前缀 `invoice_` |

### 5.5.2 子表 `travel_lines[]`（差旅费报销明细）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `line_no` | int | 行号 |
| `expense_date` | string | 日期，到分钟 |
| `category_text` | string | 费用说明 |
| `origin` | string | 起始地 |
| `destination` | string | 目的地 |
| `amount` | number | 金额（元） |
| `receipt_count` | int | 单据张数 |
| `line_remark` | string | 备注 |

> 出差新流程明细行无行内「所属项目」，项目在主表 `project_code`。

### 5.5.3 子表 `special_lines[]`（差旅特殊事项说明）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | int | 行主键 |
| `approval_code` / `instance_code` | string | 关联主表 |
| `line_no` | int | 行号 |
| `expense_date` | string | 日期，到分钟 |
| `category_texts` | string | 差旅特殊事项多选文本，逗号连接 |
| `reason` | string | 事由 |
| `excess_amount` | number | 超出报销标准部分金额（元） |
| `attachments_json` | string | 行内「附件」元数据 JSON |
| `attachments_ocr_text` | string | 行内附件 OCR；文件名前缀 `special_L{n}_` |

### 返回结构示例

```json
{
  "ok": true,
  "data": {
    "id": 12,
    "approval_code": "FF106475-6689-4370-A67E-AB788623A506",
    "instance_code": "0F760E85-73F3-4ED3-9DBA-0998AE8C0396",
    "serial_number": "202605250001",
    "project_code": "HTSH-26-EV-002",
    "total_amount": "1200.00",
    "attachments_ocr_text": "{\"invoice_xxx.jpg\":\"...\"}",
    "travel_lines": [ { "line_no": 1, "expense_date": "2026-05-25 08:05", "..." : "..." } ],
    "special_lines": [ { "line_no": 1, "reason": "...", "attachments_ocr_text": "{...}" } ]
  }
}
```

---

## 6) 采购核查数据查询

### 6.1 物料价格历史（按物料名称）

- **URL**: `/hetang-payment-apply/data/procurement/price-history`
- **Method**: `GET`
- **说明**: 按 `material_name` 查询 `payment_apply_procurement_price_history`，模糊匹配，按采购日期倒序

#### 查询参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `material_name` | string | 是 | — | 物料名称，模糊匹配（`LIKE %name%`） |
| `limit` | int | 否 | 50 | 返回条数上限，范围 1–200 |

#### 业务字段说明（data 数组元素）

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `material_name` | 物料名称 |
| `catalog_no` | 货号 |
| `specification` | 规格 |
| `purchase_date` | 采购日期（`YYYY-MM-DD`） |
| `quantity` | 数量 |
| `unit_price_tax_incl` | 含税单价 |
| `amount_tax_incl` | 含税金额 |
| `supplier_name` | 供应商 |
| `manufacturer` | 生产厂商 |
| `serial_number` | 流水号（审批单号） |
| `approval_status` | 审批状态 |
| `purchase_type` | 采购类型 |
| `supplier_tag` | 供应商标签 |
| `project_name` | 所属项目 |
| `created_at` / `update_at` | 创建 / 更新时间 |

#### 请求示例

`GET /hetang-payment-apply/data/procurement/price-history?material_name=微网雾化器&limit=20`

#### 成功响应示例

```json
{
  "ok": true,
  "material_name": "微网雾化器",
  "limit": 20,
  "count": 2,
  "data": [
    {
      "id": 1,
      "material_name": "微网雾化器",
      "catalog_no": "M113",
      "specification": "网筛为高分子材料",
      "purchase_date": "2026-05-22",
      "quantity": 3,
      "unit_price_tax_incl": 490,
      "amount_tax_incl": 1470,
      "supplier_name": "京东鱼跃自营旗舰店",
      "manufacturer": "鱼跃医疗",
      "serial_number": "202605220009",
      "approval_status": "PENDING",
      "purchase_type": "设备",
      "supplier_tag": "临时合格供应商",
      "project_name": "北京胸科医院IIT项目"
    },
    {
      "id": 451,
      "material_name": "微网雾化器",
      "catalog_no": "M113",
      "specification": "网筛为高分子材料",
      "purchase_date": "2026-05-06",
      "quantity": null,
      "unit_price_tax_incl": 569,
      "amount_tax_incl": null,
      "supplier_name": "京东鱼跃京东自营旗舰店",
      "manufacturer": "鱼跃医疗",
      "serial_number": "202605060003",
      "approval_status": "APPROVED",
      "purchase_type": "设备",
      "supplier_tag": "临时合格供应商",
      "project_name": "北京胸科医院IIT项目"
    }
  ]
}
```

#### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `material_name 不能为空` |
| `500` | 数据库查询失败 |

---

### 6.2 供应商主表（按供应商名称）

- **URL**: `/hetang-payment-apply/data/procurement/supplier`
- **Method**: `GET`
- **说明**: 按 `supplier_name` 查询 `payment_apply_procurement_supplier`，模糊匹配

#### 查询参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `supplier_name` | string | 是 | — | 供应商名称，模糊匹配 |
| `limit` | int | 否 | 50 | 返回条数上限，范围 1–200 |

#### 业务字段说明（data 数组元素）

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `supplier_name` | 供应商名称 |
| `in_qualified_library` | 是否在合格供应商库（是/否） |
| `covered_categories` | 库内覆盖类别 |
| `library_material_count` | 库内物料数 |
| `library_material_samples` | 库内物料示例 |
| `history_purchase_count` | 历史采购次数 |
| `latest_purchase_serial` | 最近采购流水号 |
| `latest_purchase_date` | 最近采购日期 |
| `purchased_material_kind_cnt` | 采购物料种类 |
| `created_at` / `update_at` | 创建 / 更新时间 |

#### 请求示例

`GET /hetang-payment-apply/data/procurement/supplier?supplier_name=迈邦生物科技&limit=10`

#### 成功响应示例

```json
{
  "ok": true,
  "supplier_name": "迈邦生物科技",
  "limit": 10,
  "count": 1,
  "data": [
    {
      "id": 36,
      "supplier_name": "上海迈邦生物科技有限公司",
      "in_qualified_library": "是",
      "covered_categories": "原材料",
      "library_material_count": 2,
      "library_material_samples": "HEK293 MaxD",
      "history_purchase_count": 0,
      "latest_purchase_serial": null,
      "latest_purchase_date": null,
      "purchased_material_kind_cnt": 0
    }
  ]
}
```

#### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `supplier_name 不能为空` |
| `500` | 数据库查询失败 |

---

### 6.3 物料均价速查（按物料名称）

- **URL**: `/hetang-payment-apply/data/procurement/material-avg`
- **Method**: `GET`
- **说明**: 按 `material_name` 查询 `payment_apply_procurement_material_avg`，模糊匹配

#### 查询参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `material_name` | string | 是 | — | 物料名称，模糊匹配 |
| `limit` | int | 否 | 50 | 返回条数上限，范围 1–200 |

#### 业务字段说明（data 数组元素）

| 字段 | 说明 |
| --- | --- |
| `id` | 主键 |
| `material_name` | 物料名称 |
| `catalog_no` | 货号 |
| `specification` | 规格 |
| `purchase_count` | 采购次数 |
| `historical_avg_price` | 历史均价 |
| `min_price` | 最低价 |
| `max_price` | 最高价 |
| `price_spread` | 价差 |
| `has_price_spread` | 有价差（是/否） |
| `spread_anomaly_reason` | 价差异常原因 |
| `latest_supplier` | 最近供应商 |
| `latest_purchase_date` | 最近采购日期 |
| `latest_unit_price` | 最近单价 |
| `created_at` / `update_at` | 创建 / 更新时间 |

#### 请求示例

`GET /hetang-payment-apply/data/procurement/material-avg?material_name=细胞扩增培养基&limit=10`

#### 成功响应示例

```json
{
  "ok": true,
  "material_name": "细胞扩增培养基",
  "limit": 10,
  "count": 1,
  "data": [
    {
      "id": 285,
      "material_name": "CTS Optimizer T细胞扩增培养基",
      "catalog_no": "A37040-01",
      "specification": "1000ml/瓶",
      "purchase_count": 1,
      "historical_avg_price": 2275.5,
      "min_price": 2275.5,
      "max_price": 2275.5,
      "price_spread": 0,
      "has_price_spread": "否",
      "spread_anomaly_reason": null,
      "latest_supplier": "赛默飞",
      "latest_purchase_date": "2025-10-31",
      "latest_unit_price": 2275.5
    }
  ]
}
```

#### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `material_name 不能为空` |
| `500` | 数据库查询失败 |

---

## 7) 模糊搜索

- **URL**: `/hetang-payment-apply/data/search?q={keyword}&scope={table}&limit=50`
- **Method**: `GET`
- **说明**:
  - `q`: 搜索关键词（必填）
  - `scope`: 搜索范围（必填），可选值见下表；也支持**表名**作为 scope 别名
  - `limit`: 返回上限，默认 50，最大 50
  - 查询逻辑：在该 scope 已建 GIN 索引的文本字段，以及数值/日期字段（转为文本）上，用 `LIKE '%q%'` 通过 `OR` 组合搜索
  - 每条命中记录会附带 `_scope`（scope 别名）与 `_table`（表名）
  - **子表 scope**：命中时关联查询主表，结构与详情接口一致；对应明细数组**仅含本次命中行**，其余明细数组为空 `[]`
  - **主表 scope**：命中时关联查询**全部**子表明细

#### scope 一览

| scope | 数据表 | 说明 |
| --- | --- | --- |
| `project` | `payment_apply_projects` | 项目基础信息 |
| `buy` | `payment_apply_buy` | 采购审批（旧流程） |
| `buy_v2` | `payment_apply_buy_v2` | 采购新流程申请 |
| `payment` | `payment_apply_payment` | 付款审批 |
| `contract` | `payment_apply_contract` | 合同审批 |
| `project_weekreport` | `payment_apply_projects_weekreport` | 项目周报 |
| `supplier_materials` | `payment_apply_supplier_materials` | 合格供应商物料库 |
| `procurement_price_history` | `payment_apply_procurement_price_history` | 采购核查-物料价格历史 |
| `procurement_supplier` | `payment_apply_procurement_supplier` | 采购核查-供应商 |
| `procurement_material_avg` | `payment_apply_procurement_material_avg` | 采购核查-物料均价 |
| `expense_reimbursement` | `payment_apply_expense_reimbursement` | 旧费用报销主表 |
| `expense_travel_line` | `payment_apply_expense_reimbursement_travel_line` | 旧费用-差旅明细 |
| `expense_entertainment_line` | `payment_apply_expense_reimbursement_entertainment_line` | 旧费用-业务招待明细 |
| `expense_daily_line` | `payment_apply_expense_reimbursement_daily_line` | 旧费用-日常明细 |
| `expense_special_line` | `payment_apply_expense_reimbursement_special_line` | 旧费用-特殊事项 |
| `travel_expense_reimbursement` | `payment_apply_travel_expense_reimbursement` | 出差费用报销主表 |
| `travel_expense_line` | `payment_apply_travel_expense_reimbursement_line` | 出差-差旅明细 |
| `travel_expense_special_line` | `payment_apply_travel_expense_reimbursement_special_line` | 出差-特殊事项 |
| `all` | 上述全部 | 合并搜索，总条数受 `limit` 限制 |

#### 各 scope 可搜索字段

| scope | 可搜索字段 |
| --- | --- |
| `project` | `project_name`, `global_pi`, `pipeline_directive`, `indications`, `chassis_cell`, `target`, `hospital`, `department`, `pi`, `progress`, `risk_level`, `risk`, `pending_coordinate_matters`, `mark` |
| `payment` | `approval_name`, `serial_number`, `topic`, `project_code`, `has_affiliated_project_text`, `is_rd_expense_text`, `is_daily_expense_text`, `apply_type_text`, `has_contract_text`, `contract_instance_codes`, `pay_account_text`, `pay_method_text`, `payee_info`, `remark`, `attachments_ocr_text` |
| `buy` | `approval_name`, `serial_number`, `topic`, `buy_type_text`, `supplier_type_text`, `contract_template_text`, `upload_detail_attachments`, `attachments_ocr_text` |
| `buy_v2` | `approval_name`, `serial_number`, `apply_department_name`, `is_project_payment_text`, `buy_type_text`, `procurement_content`, `apply_company_text`, `supplier_type_text`, `temp_supplier_remark`, `remark`, `upload_detail_attachments`, `attachments_ocr_text` |
| `contract` | `approval_name`, `serial_number`, `topic`, `project_code`, `has_affiliated_project_text`, `is_rd_expense_text`, `is_daily_expense_text`, `seal_type_text`, `contract_template_text`, `contract_type_text`, `purpose`, `contract_no`, `counterparty_name`, `counterparty_owner`, `counterparty_contact`, `related_buy_instance_codes`, `remark`, `attachments_ocr_text` |
| `project_weekreport` | `report_title`, `reporter`, `reporting_department`, `affiliated_project`, `project_count`, `progress_content`, `next_week_plan`, `risk_level`, `risk_content`, `need_coordination_support`, `coordination_support_content` |
| `supplier_materials` | `supplier_name`, `material_name`, `catalog_no`, `specification`, `manufacturer`, `remark` |
| `procurement_price_history` | `material_name`, `catalog_no`, `specification`, `purchase_date`, `quantity`, `unit_price_tax_incl`, `amount_tax_incl`, `supplier_name`, `manufacturer`, `serial_number`, `approval_status`, `purchase_type`, `supplier_tag`, `project_name` |
| `procurement_supplier` | `supplier_name`, `in_qualified_library`, `covered_categories`, `library_material_count`, `library_material_samples`, `history_purchase_count`, `latest_purchase_serial`, `latest_purchase_date`, `purchased_material_kind_cnt` |
| `procurement_material_avg` | `material_name`, `catalog_no`, `specification`, `purchase_count`, `historical_avg_price`, `min_price`, `max_price`, `price_spread`, `has_price_spread`, `spread_anomaly_reason`, `latest_supplier`, `latest_purchase_date`, `latest_unit_price` |
| `expense_reimbursement` | `approval_name`, `serial_number`, `attachments_ocr_text` |
| `expense_travel_line` | `category_text`, `origin`, `destination`, `line_remark`, `project_code`, `expense_date`, `amount`, `receipt_count` |
| `expense_entertainment_line` | `guest_target`, `entertainment_reason`, `project_code`, `expense_date`, `guest_count`, `invoice_count`, `amount` |
| `expense_daily_line` | `expense_reason`, `project_code`, `invoice_count`, `amount` |
| `expense_special_line` | `special_type`, `category_texts`, `reason`, `project_code`, `expense_date`, `excess_amount`, `attachments_ocr_text` |
| `travel_expense_reimbursement` | `approval_name`, `serial_number`, `project_code`, `attachments_ocr_text` |
| `travel_expense_line` | `category_text`, `origin`, `destination`, `line_remark`, `expense_date`, `amount`, `receipt_count` |
| `travel_expense_special_line` | `category_texts`, `reason`, `expense_date`, `excess_amount`, `attachments_ocr_text` |

> 采购核查专用查询接口（第 6 节）按单一维度过滤；通用搜索可在上表字段中模糊匹配。  
> 费用/出差类子表 scope 命中时，响应字段说明见第 5 / 5.5 节；并额外含 `_scope`、`_table`。

### 请求示例

合同搜索：`GET /hetang-payment-apply/data/search?q=荷塘&scope=contract&limit=20`

采购新流程（v2）：`GET /hetang-payment-apply/data/search?q=临时合格供应商&scope=buy_v2&limit=10`

采购核查-物料价格历史： `GET /hetang-payment-apply/data/search?q=M113&scope=procurement_price_history&limit=10`

采购核查-供应商： `GET /hetang-payment-apply/data/search?q=跃动&scope=procurement_supplier`

周报搜索: `GET /hetang-payment-apply/data/search?q=积水潭医院&scope=project_weekreport&limit=20`


全局搜索：`GET /hetang-payment-apply/data/search?q=培养基&scope=all&limit=20`



### 成功响应示例

```json
{
  "ok": true,
  "q": "荷塘",
  "scope": "contract",
  "limit": 20,
  "count": 2,
  "data": [
    {
      "id": 301,
      "approval_code": "1B8B163C-F4F3-4733-B7C0-C73120240917",
      "instance_code": "56BF55C5-0826-4265-9E4D-827A59D79357",
      "approval_name": "广东荷塘生华 合同审核流程",
      "serial_number": "202605110003",
      "instance_status": "APPROVED",
      "topic": "液氮采购-广州粤佳气体有限公司",
      "has_affiliated_project_text": "是",
      "is_rd_expense_text": "否",
      "is_daily_expense_text": "否",
      "contract_type_text": "采购类",
      "counterparty_name": "广州粤佳气体有限公司",
      "counterparty_contact": "13800138000",
      "attachments_ocr_text": "{\"液氮采购合同.pdf\":\"...\"}",
      "_scope": "contract",
      "_table": "payment_apply_contract"
    }
  ]
}
```

### 采购核查搜索响应示例

```json
{
  "ok": true,
  "q": "M113",
  "scope": "procurement_price_history",
  "limit": 10,
  "count": 1,
  "data": [
    {
      "id": 1,
      "material_name": "微孔板（96孔）",
      "catalog_no": "M113",
      "specification": "低吸附高分子材料",
      "purchase_date": "2026-05-22",
      "supplier_name": "北京跃动运营旗舰店",
      "serial_number": "202605220009",
      "_scope": "procurement_price_history",
      "_table": "payment_apply_procurement_price_history"
    }
  ]
}
```

### 子表搜索响应示例（含主表）

`GET /hetang-payment-apply/data/search?q=北京&scope=travel_expense_line&limit=10`

```json
{
  "ok": true,
  "q": "北京",
  "scope": "travel_expense_line",
  "limit": 10,
  "count": 1,
  "data": [
    {
      "id": 12,
      "approval_code": "FF106475-6689-4370-A67E-AB788623A506",
      "instance_code": "0F760E85-73F3-4ED3-9DBA-0998AE8C0396",
      "serial_number": "202605250001",
      "approval_name": "出差费用报销",
      "...": "其他主表字段",
      "travel_lines": [
        {
          "line_no": 1,
          "origin": "上海",
          "destination": "北京",
          "...": "本次命中的明细行"
        }
      ],
      "special_lines": [],
      "_scope": "travel_expense_line",
      "_table": "payment_apply_travel_expense_reimbursement_line"
    }
  ]
}
```

### 主表搜索响应示例（含全部子表）

`GET /hetang-payment-apply/data/search?q=202605250001&scope=travel_expense_reimbursement&limit=10`

```json
{
  "ok": true,
  "q": "202605250001",
  "scope": "travel_expense_reimbursement",
  "limit": 10,
  "count": 1,
  "data": [
    {
      "id": 12,
      "approval_code": "FF106475-6689-4370-A67E-AB788623A506",
      "instance_code": "0F760E85-73F3-4ED3-9DBA-0998AE8C0396",
      "serial_number": "202605250001",
      "approval_name": "出差费用报销",
      "...": "其他主表字段",
      "travel_lines": [ { "...": "全部差旅明细" } ],
      "special_lines": [ { "...": "全部特殊事项明细" } ],
      "_scope": "travel_expense_reimbursement",
      "_table": "payment_apply_travel_expense_reimbursement"
    }
  ]
}
```

#### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `q 不能为空`；`scope` 不在允许列表 |
| `500` | 数据库查询失败 |

---

## 8) 推送合同扩展数据

- **URL**: `/hetang-payment-apply/push-contract-ext-data`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **说明**: 按 `serial_number` 写入或更新 `payment_apply_contract_ext`；`serial_number` 为唯一主键，存在则更新，不存在则插入。`created_at`、`update_at` 由服务端自动写入，无需在请求体中传递。

### 请求字段

| 字段 | 类型 | 必填 | 说明            |
| --- | --- | --- |---------------|
| `serial_number` | string | 是 | 审批单号（唯一主键）    |
| `approval_code` | string | 否 | 审批模板编码        |
| `instance_code` | string | 否 | 审批实例编码        |
| `approval_name` | string | 否 | 审批模板名称        |
| `contract_summary` | string | 否 | 合同一句话摘要       |
| `contract_start_date` | string | 否 | 合同开始日期        |
| `contract_end_date` | string | 否 | 合同结束日期        |
| `is_framework_contract` | string | 否 | 是否为框架合同       |
| `tax_rate` | string | 否 | 税率            |
| `payment_nodes` | string | 否 | 付款节点（采购类合同才有值） |

### 请求示例

```bash
curl -X POST "http://127.0.0.1:27298/hetang-payment-apply/push-contract-ext-data" \
  -H "Content-Type: application/json" \
  -d '{
    "approval_code": "1B8B163C-F4F3-4733-B7C0-C73120240917",
    "instance_code": "56BF55C5-0826-4265-9E4D-827A59D79357",
    "approval_name": "广东荷塘生华 合同审核流程",
    "serial_number": "202605110003",
    "contract_summary": "液氮采购合同",
    "contract_start_date": "2026-01-01",
    "contract_end_date": "2026-12-31",
    "is_framework_contract": "否",
    "tax_rate": "13%",
    "payment_nodes": "预付30%，验收70%"
  }'
```

### 成功响应示例

```json
{
  "ok": true,
  "serial_number": "202605110003"
}
```

### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `serial_number 不能为空` |
| `500` | `数据库写入失败: ...` |

---

## 9) 推送采购价格历史

- **URL**: `/hetang-payment-apply/push-procurement-price-history`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **说明**: 按审批单号 `serial_number` 全量替换该单号下的物料价格历史：先删除库中同单号全部记录，再插入 `items` 数组中的有效行。`created_at`、`update_at` 由服务端自动写入。
- **写入条件**: `items` 中每条记录须满足 `material_name`、`purchase_date`、`quantity`、`unit_price_tax_incl`、`amount_tax_incl` 均有效，否则**静默跳过**该条（计入响应 `skipped`）。`serial_number` 取自请求体顶层，无需在 `items` 元素中重复传递。
- **空值处理**: `catalog_no`、`specification`、`supplier_name`、`manufacturer` 为空时，入库前写入 `"无"`

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `serial_number` | string | 是 | 审批单号（流水号） |
| `items` | array | 是 | 该单号下的物料明细，可为空数组（仅删除旧数据） |

**items 数组元素字段**

| 字段 | 类型 | 写入必填 | 说明 |
| --- | --- | --- | --- |
| `material_name` | string | 是 | 物料名称 |
| `purchase_date` | string | 是 | 采购日期（`YYYY-MM-DD`） |
| `quantity` | number | 是 | 数量 |
| `unit_price_tax_incl` | number | 是 | 含税单价 |
| `amount_tax_incl` | number | 是 | 含税金额 |
| `catalog_no` | string | 否 | 货号（空则写 `"无"`） |
| `specification` | string | 否 | 规格（空则写 `"无"`） |
| `supplier_name` | string | 否 | 供应商（空则写 `"无"`） |
| `manufacturer` | string | 否 | 生产厂商（空则写 `"无"`） |
| `approval_status` | string | 否 | 审批状态 |
| `purchase_type` | string | 否 | 采购类型 |
| `supplier_tag` | string | 否 | 供应商标签 |
| `project_name` | string | 否 | 所属项目 |

### 请求示例

**示例：一个单号下两条物料**

```bash
curl -X POST "http://192.168.100.1:27298/hetang-payment-apply/push-procurement-price-history" \
  -H "Content-Type: application/json" \
  -d '{
    "serial_number": "202605220009",
    "items": [
      {
        "material_name": "温湿度记录仪",
        "catalog_no": "RCW-360Plus",
        "specification": "药品转运温度记录仪",
        "purchase_date": "2026-05-22",
        "quantity": 1,
        "unit_price_tax_incl": 740,
        "amount_tax_incl": 740,
        "supplier_name": "精创京东官方旗舰店",
        "manufacturer": "精创（elitech）",
        "approval_status": "PENDING",
        "purchase_type": "设备",
        "supplier_tag": "临时合格供应商",
        "project_name": "北京胸科医院IIT项目"
      },
      {
        "material_name": "5ml细胞冻存管",
        "catalog_no": "OB02007",
        "specification": "25个/包，1000个/箱",
        "purchase_date": "2026-03-27",
        "quantity": 1,
        "unit_price_tax_incl": 3600,
        "amount_tax_incl": 3600,
        "supplier_name": "北京钎铧科技",
        "manufacturer": "德国SARSTEDT",
        "approval_status": "APPROVED",
        "purchase_type": "生产原料",
        "supplier_tag": "合格供应商",
        "project_name": "通用项目"
      }
    ]
  }'
```

### 成功响应示例

**写入成功**

```json
{
  "ok": true,
  "serial_number": "202605220009",
  "deleted": 2,
  "inserted": 2,
  "skipped": 0
}
```

**部分行无效被跳过**

```json
{
  "ok": true,
  "serial_number": "202605220009",
  "deleted": 0,
  "inserted": 1,
  "skipped": 1
}
```

### 错误响应

| HTTP | 说明 |
| --- | --- |
| `400` | `serial_number 不能为空` |
| `500` | `数据库写入失败: ...` |
