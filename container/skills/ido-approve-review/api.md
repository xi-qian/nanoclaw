# hetang-payment 对外查询接口

Base URL 示例：`http://<host>:27298`

外网: http://moleagent.com:18080/
内网： http://192.168.100.1:27298/

## 通用说明

- 所有接口均为 `GET`
- 成功响应：`200`，格式 `{"ok": true, "data": {...}}`
- 未找到：`404`，格式 `{"detail": "..."}`
- 数据库异常：`500`，格式 `{"detail": "..."}`


---

## 1) 查询付款数据

- **URL**: `/hetang-payment-apply/data/payment/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_payment`

### 业务字段说明（data 内）

- `id`: 主键
- `approval_code`: 审批模板编码（付款流程固定模板）
- `instance_code`: 审批实例编码
- `approval_name`: 审批模板名称
- `serial_number`: 审批单号
- `instance_status`: 实例状态（如 `PENDING`/`APPROVED`/`REJECTED`）
- `topic`: 主题
- `amount`: 金额（元）
- `apply_type_text`: 付款申请类型（文本）
- `has_contract_text`: 是否有关联合同（文本）
- `contract_instance_codes`: 关联合同实例编码（逗号分隔）
- `pay_account_text`: 支付账户（文本）
- `pay_method_text`: 支付方式（文本）
- `payee_info`: 收款方信息
- `remark`: 备注
- `attachments_ocr_text`: 附件 OCR 汇总 JSON（key=文件名，value=OCR文本）

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

## 2) 查询采购数据

- **URL**: `/hetang-payment-apply/data/buy/{instance_code}`
- **说明**: 按 `instance_code` 查询 `payment_apply_buy`

### 业务字段说明（data 内）

- `id`: 主键
- `approval_code`: 审批模板编码（采购流程固定模板）
- `instance_code`: 审批实例编码
- `approval_name`: 审批模板名称
- `serial_number`: 审批单号
- `instance_status`: 实例状态
- `topic`: 主题
- `buy_type_text`: 采购类型（文本）
- `total_amount`: 采购总金额
- `supplier_type_text`: 供应商类型（文本）
- `contract_template_text`: 合同模板（文本）
- `attachments_ocr_text`: 附件 OCR 汇总 JSON（key=文件名，value=OCR文本）

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
    "buy_type_text": "物料采购",
    "total_amount": "9800.00",
    "supplier_type_text": "长期供应商",
    "contract_template_text": "无",
    "attachments_ocr_text": "{\"采购明细.xlsx\":\"采购清单\\n1. 培养基 ...\"}"
  }
}
```

---

## 3) 查询项目数据

- **URL**: `/hetang-payment-apply/data/project/{project_code}`
- **说明**: 按 `project_code` 查询 `payment_apply_projects`

### 业务字段说明（data 内）

- `id`: 主键
- `project_code`: 项目编码（唯一）
- `project_name`: 项目名称
- `global_pi`: 总负责人
- `pipeline_directive`: 管线方向
- `ethics_review_passed`: 伦理审批状态
- `indications`: 适应症
- `chassis_cell`: 底盘细胞
- `target`: 靶点
- `hospital`: 医院
- `department`: 科室
- `pi`: PI
- `progress`: 进度
- `risk_level`: 风险等级
- `risk`: 风险描述
- `pending_coordinate_matters`: 待协调事项
- `project_budget`: 项目预算
- `task_num`: 任务数
- `task_completion_rate`: 任务完成率
- `mark`: 备注
- `doc_link`: 文档链接
- `parent_id`: 父级项目ID

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

- `id`: 主键
- `approval_code`: 审批模板编码（9个合同流程之一）
- `instance_code`: 审批实例编码
- `approval_name`: 审批模板名称
- `serial_number`: 审批单号
- `instance_status`: 实例状态
- `topic`: 主题
- `seal_type_text`: 盖章类型（文本）
- `contract_template_text`: 合同模板（文本）
- `contract_type_text`: 合同类型（文本）
- `purpose`: 目的
- `contract_no`: 合同编号
- `counterparty_name`: 对方单位名称
- `counterparty_owner`: 对方负责人
- `amount`: 金额
- `related_buy_instance_codes`: 关联采购申请实例编码（逗号分隔）
- `remark`: 备注
- `attachments_ocr_text`: 附件 OCR 汇总 JSON（key=文件名，value=OCR文本）

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
    "seal_type_text": "合同专用章",
    "contract_template_text": "无",
    "contract_type_text": "采购类",
    "purpose": "用于广州生产细胞储存",
    "contract_no": "无",
    "counterparty_name": "广州粤佳气体有限公司",
    "counterparty_owner": "陈志文",
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

## 5) 模糊搜索

- **URL**: `/hetang-payment-apply/data/search?q={keyword}&scope={table}&limit=50`
- **Method**: `GET`
- **说明**:
  - `q`: 搜索关键词（必填）
  - `scope`: 搜索范围，可选 `project` / `buy` / `payment` / `contract` / `project_weekreport` / `all`
  - 也支持表名：`payment_apply_projects` / `payment_apply_buy` / `payment_apply_payment` / `payment_apply_contract` / `payment_apply_projects_weekreport`
  - `limit`: 返回上限，默认 50，最大 50
  - 查询逻辑：在该 scope 已建 GIN 索引的中文业务字段上，用 `LIKE '%q%'` 通过 `OR` 组合搜索

### 请求示例

`GET /hetang-payment-apply/data/search?q=荷塘&scope=contract&limit=20`

### 使用注意事项

**中文字符需要 URL 编码**：Windows 环境下 curl 直接在 URL 中放置中文字符，未经过 URL 编码，uvicorn 会收到非法 HTTP 请求字节并报 `Invalid HTTP request received`。

正确用法（使用 `--data-urlencode` 让 curl 自动编码）：

```bash
curl --get "http://127.0.0.1:27298/hetang-payment-apply/data/search" --data-urlencode "q=北赛泓升" -d "scope=contract" -d "limit=20"
``

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
      "contract_type_text": "采购类",
      "counterparty_name": "广州粤佳气体有限公司",
      "attachments_ocr_text": "{\"液氮采购合同.pdf\":\"...\"}",
      "_scope": "contract",
      "_table": "payment_apply_contract"
    }
  ]
}
```
