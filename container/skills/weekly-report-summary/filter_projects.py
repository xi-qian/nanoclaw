import json
from datetime import datetime, timezone, timedelta

# 读取数据
with open('/workspace/group/bitable_data.json', 'r', encoding='utf-8') as f:
    projects = json.load(f)

# 任务执行日期（北京时间），自动获取系统当前时间
execution_date = datetime.now(tz=timezone(timedelta(hours=8)))
five_days_ago = execution_date - timedelta(days=5)

print(f"任务执行日期: {execution_date.date()}")
print(f"5天前日期: {five_days_ago.date()}")
print()

# 过滤5天内更新的项目（更新日期 >= 五天前）
# 更新日期格式是字符串 "YYYY-MM-DD HH:MM:SS"
filtered = []
for p in projects:
    update_date_str = p.get('更新日期')
    if not update_date_str:
        continue
    try:
        # 解析日期字符串 "2026-04-30 00:00:00"
        update_date = datetime.strptime(update_date_str, "%Y-%m-%d %H:%M:%S")
        if update_date >= five_days_ago.replace(hour=0, minute=0, second=0):
            filtered.append(p)
    except:
        continue

print(f"5天内更新的项目（共{len(filtered)}个）：")
for p in filtered:
    update_date_str = p.get('更新日期', '')
    # 项目风险是数组，取第一项
    risk_arr = p.get('项目风险', [])
    risk = risk_arr[0] if isinstance(risk_arr, list) and len(risk_arr) > 0 else ''
    risk_content = p.get('风险内容', '') or ''
    coord = p.get('待协调事项', '') or ''
    # 提取医院名称（项目名称格式为"医院 | 项目名"，取第一段）
    project_name = p.get('项目名称', '')
    hospital = project_name.split(' | ')[0] if ' | ' in project_name else project_name
    print(f"  项目{p.get('编号', '')} {hospital} | {update_date_str[:10]} | {risk} | 风险内容:{risk_content} | 待协调:{coord}")