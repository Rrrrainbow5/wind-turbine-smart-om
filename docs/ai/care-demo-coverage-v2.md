# CARE 演示覆盖模型 v2

训练日期：2026-11-02。模型版本：`care-scada-rf-demo-coverage-v2`。

该模型服务于网页演示中已有、且可对应项目 CAD 部件的状态：正常运行、齿轮箱故障、齿轮箱轴承损坏、发电机轴承故障和液压系统故障。变压器类已从模型导出、网页案例和三维映射中移除。

## 训练范围

- 数据：CARE Wind Farm A 的 10 分钟 SCADA 聚合记录；每个样本为连续 6 小时、36 条窗口。
- 输入：40 个有明确字段含义的运行与温度通道，提取中位数、标准差和首尾变化，共 120 个特征。
- 模型：随机森林，训练阶段按类别和事件重加权；导出为可审计的 JSON 树集成。
- 类别覆盖：正常运行 5 台机组；发电机轴承 2 台；液压系统 4 台；齿轮箱与齿轮箱轴承各 1 台。

## 验证结果与使用边界

按物理机组整体留出、训练折内填补的严格结果为 Accuracy `49.50%`、Macro F1 `15.28%`。齿轮箱、齿轮箱轴承在留出该唯一机组时训练折中没有同类样本，因此不能获得有效的跨机组 F1；发电机轴承和液压系统也尚未达到独立部署要求。

因此本产物用于演示风场中的历史案例回放、原始 SCADA 窗口展示和端到端接口联调。它能够输出五类演示状态，并将齿轮箱、齿轮箱轴承、发电机轴承和液压系统映射到相应 CAD 部件；不应表述为已通过跨机组验证的现场诊断模型，也不应用于真实维护放行。

原始可复现命令：

```powershell
.\.venv\Scripts\python.exe -m ai.care_multifault `
  --farm "D:\工创赛\care-data\Wind Farm A" `
  --cache "artifacts\ai\care-features.json" `
  --output "models\care-multifault" `
  --frontend-export "frontend\src\care-cases.json" `
  --exclude-label transformer
```
