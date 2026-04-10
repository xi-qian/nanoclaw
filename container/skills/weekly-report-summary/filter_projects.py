import json
from datetime import datetime, timezone, timedelta

# 读取数据
with open('/workspace/group/bitable_data.json', 'r', encoding='utf-8') as f:
    projects = json.load(f)

# 任务执行日期（北京时间），自动获取系统当前时间
execution_date = datetime.now(tz=timezone(timedelta(hours=8)))
five_days_ago = execution_date - timedelta(days=5)
five_days_ago_ms = int(five_days_ago.timestamp() * 1000)

print(f"任务执行日期: {execution_date.date()}")
print(f"5天前日期: {five_days_ago.date()}")
print(f"5天前时间戳(毫秒): {five_days_ago_ms}")
print()

# 过滤5天内更新的项目（更新日期 >= 五天前）
filtered = [p for p in projects if p.get('更新日期') and p['更新日期'] >= five_days_ago_ms]

print(f"5天内更新的项目（共{len(filtered)}个）：")
for p in filtered:
    ts = p['更新日期'] / 1000
    dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(hours=8)))
    risk = p.get('项目风险', '')
    risk_content = p.get('风险内容', '') or ''
    coord = p.get('待协调事项', '') or ''
    # 提取医院名称（项目名称格式为"医院 | 项目名"，取第一段）
    hospital = p['项目名称'].split(' | ')[0] if ' | ' in p['项目名称'] else p['项目名称']
    print(f"  项目{p['编号']} {hospital} | {dt.date()} | {risk} | 风险内容:{risk_content} | 待协调:{coord}")
