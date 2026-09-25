# 海上演示案例 v0.2

当前海上数字孪生场景使用 CARE Version 6 的 **Wind Farm B** 作为数据来源标签。Wind Farm B 在 CARE 登记为德国海上风场；本场景的海面、风机阵列、无人机视角和黄色防撞段属于 `SIMULATED`/`REFERENCE` 可视化，不代表原始数据文件包含三维空间坐标。

## 案例边界

- 系统测试 ID 仍为 `WT02 / WT02_COMPONENT_01`，保持中性名称。
- 当前演示引用 Wind Farm B 的已登记异常事件 `event_id = 53`（Rotor Bearing 相关异常登记）；具体 CARE 事件到 CAD 零件的映射仍为 `UNVERIFIED`。
- 不再把 Wind Farm A 的 Event 51 称为海上数据。A/ Event 51 的审计材料和陆上前端备份保留在原位置，不被覆盖。
- `failure_risk` 仍是风险评分，不是校准后的故障概率；维护阈值、窗口和人员条件仍为 `ASSUMED`。

海上场景用于展示“监测信号 -> 风险解释 -> 维护窗口决策 -> 执行/复测”的流程。没有后端复测记录时，界面显示“待复测”，不会推断维护已经改善健康状态。
