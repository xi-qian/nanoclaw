import json
import sys
from datetime import datetime, timezone, timedelta

TZ_CN = timezone(timedelta(hours=8))

# 读取数据
try:
    with open('/workspace/group/bitable_data.json', 'r', encoding='utf-8') as f:
        projects = json.load(f)
except (FileNotFoundError, json.JSONDecodeError) as e:
    print(f"错误: 无法读取数据文件 - {e}", file=sys.stderr)
    sys.exit(1)

# 任务执行日期（北京时间）
execution_date = datetime.now(tz=TZ_CN)
five_days_ago = execution_date - timedelta(days=5)
cutoff = datetime(five_days_ago.year, five_days_ago.month, five_days_ago.day)

print(f"任务执行日期: {execution_date.date()}")
print(f"5天前日期: {five_days_ago.date()}")
print()

# 过滤5天内更新的项目（更新日期 >= 五天前）
filtered = []
for p in projects:
    update_date_str = p.get('更新日期')
    if not update_date_str:
        continue
    try:
        update_date = datetime.strptime(update_date_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        continue
    if update_date >= cutoff:
        filtered.append(p)

print(f"5天内更新的项目（共{len(filtered)}个）：")
for p in filtered:
    update_date_str = p.get('更新日期', '') or ''
    # 项目风险是数组，取第一项
    risk_arr = p.get('项目风险') or []
    risk = risk_arr[0] if isinstance(risk_arr, list) and risk_arr else ''
    risk_content = p.get('风险内容') or ''
    coord = p.get('待协调事项') or ''
    # 提取医院名称（项目名称格式为"医院 | 项目名"，取第一段）
    project_name = p.get('项目名称', '') or ''
    hospital = project_name.split(' | ')[0] if ' | ' in project_name else project_name
    num = p.get('编号', '') or ''
    print(f"  项目{num} {hospital} | {update_date_str[:10]} | {risk} | 风险内容:{risk_content} | 待协调:{coord}")