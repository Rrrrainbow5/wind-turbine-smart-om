# API 接口协议

## ID 约定

- 风机 ID 示例：`WT02`
- 部件 ID 示例：`WT02_COMPONENT_01`
- CARE 字段与真实工程部件完成核验前，禁止把中性部件 ID 改成齿轮箱、主轴承或发电机缩写。
- B、C、D 使用相同 ID；修改公共 ID 必须由团队共同确认。

## 数据来源

所有关键记录必须携带下列来源类型之一：

- `REAL`：可追溯的真实数据
- `DERIVED`：由真实或已声明来源的数据计算得到
- `SIMULATED`：仿真产生的数据或事件
- `ASSUMED`：工程假设参数
- `REFERENCE`：来自论文、标准或数据集说明的参考信息

## AI 结果

`POST /api/ai-results`

```json
{
  "turbine_id": "WT02",
  "component_id": "WT02_COMPONENT_01",
  "timestamp": "2026-09-17T10:00:00+08:00",
  "health_index": 63.2,
  "anomaly_score": 0.87,
  "failure_risk": 0.76,
  "warning_level": "HIGH",
  "model_version": "baseline-v0.1.0",
  "data_origin": "DERIVED"
}
```

数值范围：

- `health_index`：0 到 100
- `anomaly_score`：0 到 1
- `failure_risk`：0 到 1
- `warning_level`：`NORMAL`、`LOW`、`MEDIUM`、`HIGH`

## 核心接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 服务健康检查 |
| GET | `/api/turbines` | 获取风机列表 |
| GET | `/api/turbines/{turbine_id}/state` | 获取部件及最新 AI 状态 |
| GET | `/api/components/{component_id}/risk` | 获取部件的最新风险结果 |
| POST | `/api/ai-results` | 保存 B 输出的 AI 结果 |
| POST | `/api/maintenance/optimize` | 生成基础维护方案 |
| POST | `/api/maintenance/replan` | 条件变化后重新规划 |
| POST | `/api/maintenance/execute` | 记录维护执行结果 |
| GET | `/api/maintenance/history` | 查询维护方案和执行记录 |
| POST | `/api/retests` | 保存维护后复测结果 |

接口实现和实时请求示例以 FastAPI 自动生成的 `/docs` 页面为准。

### 维护决策追溯字段

`POST /api/maintenance/optimize` 和 `POST /api/maintenance/replan` 会在维护方案中保存本次决策的输入和依据：

- `rule_version`：使用的维护规则版本，默认 `trial-v0.1`
- `input_failure_risk`、`input_warning_level`：实际用于决策的风险输入
- `maintenance_window_available`、`personnel_available`：本次决策的资源条件
- `decision_origin`、`conditions_origin`：决策和资源条件的数据来源
- `confirmed_by`、`confirmed_at`：可选的人工确认信息

重规划请求可以提供：

```json
{
  "source_plan_id": "原维护方案 ID",
  "replan_trigger": "weather_window_closed"
}
```

响应中的 `parent_plan_id` 指向原方案，原方案保留在历史记录中并标记为 `REPLANNED`。不提供 `source_plan_id` 时仍会生成独立的新方案，但 `replan_trigger` 会记录为默认的 `maintenance_conditions_changed`。

本地前端默认允许从 `localhost:5173` 和 `127.0.0.1:5173` 跨域访问。其他部署地址通过 `WINDCARE_ALLOWED_ORIGINS` 配置，多个地址使用英文逗号分隔。
