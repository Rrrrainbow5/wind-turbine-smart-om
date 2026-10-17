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
- `USER_INPUT`：用户在数字录入界面提交的数据
- `EXTERNAL_PUBLIC`：有公开来源和许可说明的外部数据

CARE Version 6 当前接入内容是聚合状态/SCADA 数据。除非另有可追溯的高采样原始文件，
不得将 CARE 聚合字段描述为原始振动或电流波形，也不得据此伪造 FFT、STFT、
小波包或轴承特征频率。演示生成的波形必须标记为 `SIMULATED`。

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
  "data_origin": "DERIVED",
  "sample_id": null,
  "diagnosis_id": null,
  "event_id": "51",
  "fault_id": "BEARING_RACEWAY_DAMAGE"
}
```

旧 `/api/ai-results` 只保存未追溯的兼容结果，客户端不能在该接口自报 `sample_id` 或
`diagnosis_id`。需要贯通样本、处理中间产物和维护方案时，必须使用
`POST /api/diagnosis/analyze`，由服务端生成并核验 `diagnosis_id`。

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
| GET | `/api/maintenance/records/{record_id}/retests` | 查询一次维护执行的复测结果 |
| GET | `/api/turbines/{turbine_id}/telemetry` | 查询 CARE 传感器摘要；无原始文件时返回 null，不补造数值 |
| GET | `/api/fault-library` | 查询标准/公开方法整理的故障机理与特征公式 |
| POST | `/api/diagnosis/analyze` | 接收一份带 `sample_id` 的信号处理和诊断结果 |
| POST | `/api/demo/simulate` | 生成明确标记为 `SIMULATED` 的演示样本 |
| GET | `/api/diagnosis/{diagnosis_id}` | 查询单次诊断结果 |
| GET | `/api/diagnosis/sample/{sample_id}` | 按输入样本查询全部诊断运行 |
| GET | `/api/diagnosis/history` | 按风机或样本查询诊断历史 |
| GET | `/api/models/{model_version}` | 查询模型方法、输入来源和限制 |

接口实现和实时请求示例以 FastAPI 自动生成的 `/docs` 页面为准。

## 信号分析与诊断 v0.2

`POST /api/diagnosis/analyze` 使用 `signal-analysis.v2` 载荷。原始输入、预处理、
时域特征、频谱峰、时频产物、二维嵌入、二维示意图和三维高亮必须使用同一个
`sample_id`。服务端保留 B 提供的 `processing_run_id`（缺失时生成一个）并生成唯一
`diagnosis_id`，然后将诊断摘要同步写入现有 AI 结果表，
因此后续维护方案可以沿用 `/api/maintenance/optimize`。

该接口的准确语义是“校验并接收 B 端诊断结果”，不是由 D 自己运行训练模型。当前
`hybrid-ai-v0.2.0` 在模型登记中为 `NOT_IMPLEMENTED`，在 B 提交可复现模型、输入契约和
验证结果前会被拒绝。独立的 `/api/demo/simulate` 使用 `rule-demo-v0.2.0`，其状态为
`DEMO_ONLY`，不得在答辩中表述为自研混合 AI。

最小请求示例：

```json
{
  "schema_version": "signal-analysis.v2",
  "sample_id": "USER-20261015-0001",
  "processing_run_id": "B-RUN-20261015-0001",
  "turbine_id": "WT02",
  "component_id": "WT02_COMPONENT_01",
  "event_id": "51",
  "event_name": "Gearbox bearings damaged",
  "fault_id": "BEARING_RACEWAY_DAMAGE",
  "data_origin": "USER_INPUT",
  "sampling_rate_hz": 1000,
  "channels": [
    {
      "name": "drive_train_vibration",
      "unit": "g",
      "samples": [0.1, 0.2, 0.3, 0.2],
      "data_origin": "USER_INPUT",
      "sensor_location": "nacelle_drivetrain",
      "window_length": 4,
      "overlap": 0
    },
    {
      "name": "generator_current",
      "unit": "A",
      "samples": [1.0, 1.1, 1.0, 0.9],
      "data_origin": "USER_INPUT",
      "sensor_location": "generator_output",
      "window_length": 4,
      "overlap": 0
    }
  ],
  "preprocessing": [
    {"name": "demean", "method": "remove_mean", "parameters": {}, "output_reference": "preprocessed"}
  ],
  "spectral_peaks": [],
  "time_frequency_artifacts": [],
  "embedding_2d": [],
  "diagnosis": {
    "model_version": "rule-demo-v0.2.0",
    "class_probabilities": {"BEARING_RACEWAY_DAMAGE": 0.8, "NORMAL": 0.2},
    "predicted_class": "BEARING_RACEWAY_DAMAGE",
    "uncertainty": 0.2,
    "component_key": "gearbox_bearing",
    "mapping_status": "UNMAPPED",
    "health_index": 65,
    "anomaly_score": 0.7,
    "failure_risk": 0.7,
    "warning_level": "MEDIUM",
    "rationale": "用户录入样本的诊断结果；概率尚未校准。"
  }
}
```

校验规则：

- 传入通道时必须提供正数 `sampling_rate_hz`，全部通道长度必须一致；
- 内联样本只保存不超过 4096 点的预览；更大的原始文件使用 `artifact_uri`、`sample_count`
  和 `sha256` 引用，避免把大波形塞进 SQLite；
- 所有样本、特征、概率和嵌入坐标必须是有限数，拒绝 NaN/Inf；
- 类别概率必须在 0 到 1 之间且总和误差不超过 `0.001`；
- 频谱峰不能超过 Nyquist 频率；
- `REAL` 必须携带至少一个信号通道；
- 未完成 CAD 工程映射时返回 `mapping_status = UNMAPPED`，不能把候选节点表述为官方确认部件；
- 未提供齿数、轴承几何、实际转速等必需参数时只展示公式和“条件不足”，不生成具体特征频率。
- `GET /api/diagnosis/history` 只返回摘要，不返回整段信号；完整预览通过单条诊断接口读取。
- 同一 `sample_id` 可用于多个处理运行，但其风机、部件、事件、故障和来源元数据必须一致。

存在波形通道时，D 会透明复算每个通道的均值、总体方差、RMS 和超额峭度，标准字段以
服务端复算结果为准。D 不伪造 FFT/STFT/小波包或 t-SNE 结果；这些中间产物由 B 提供后原样
保留来源标签。`POST /api/demo/simulate` 只用于答辩演示，响应始终为 `SIMULATED`，其中的
风险和类别置信度不是经过校准的真实故障概率。

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

### 维护后复测查询

`POST /api/maintenance/execute` 返回 `record_id`。保存复测结果后，C 可以使用该 ID 查询：

```text
GET /api/maintenance/records/{record_id}/retests
```

接口按 `observed_at` 从新到旧返回复测记录数组。合法维护记录尚无复测结果时返回空数组；维护记录不存在时返回 HTTP `404`。复测产生的健康指数、风险评分和结论必须保留其实际 `data_origin`，模拟维护效果应标记为 `SIMULATED`。

本地前端默认允许从 `localhost:5173` 和 `127.0.0.1:5173` 跨域访问。其他部署地址通过 `WINDCARE_ALLOWED_ORIGINS` 配置，多个地址使用英文逗号分隔。
