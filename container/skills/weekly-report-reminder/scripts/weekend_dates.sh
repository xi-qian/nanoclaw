#!/bin/bash
# 获取本周五、周六、周日的日期

dow=$(date +%u)  # 1=周一 ... 7=周日

last_sun=$(date -d "$((-dow)) days" +%Y-%m-%d)
fri=$(date -d "$((5 - dow)) days" +%Y-%m-%d)
sat=$(date -d "$((6 - dow)) days" +%Y-%m-%d)
sun=$(date -d "$((7 - dow)) days" +%Y-%m-%d)

echo "上周日: $last_sun"
echo "周五:   $fri"
echo "周六:   $sat"
echo "周日:   $sun"
