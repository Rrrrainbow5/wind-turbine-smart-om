# D 后端状态与交接 v0.2

## 成员

D：后端接口、数据契约、持久化和联调约束。

## 完成内容

1. 同步并核验队友 `main` 最新基线 `9fbcafc`，保留其三维模型、剖切和可复现演示数据修改。
2. 新增四类风机故障特征库接口，覆盖齿轮、轴承、振动和电机电气 8 个失效模式。
3. 建立 `sample_id -> processing_run_id -> diagnosis_id -> maintenance plan` 追踪链。
4. 新增信号通道、预处理、时域特征、频谱峰、时频产物和二维嵌入的 v0.2 数据契约。
5. 服务端透明计算均值、总体方差、RMS 和超额峭度；校验采样率、通道长度、有限数、Nyquist 和类别概率。
6. 大波形使用预览或带哈希的 artifact 引用；诊断历史只返回摘要。
7. 新增故障类型专用的规则演示接口，输出明确标记为 `SIMULATED` 的振动和电流预览。
8. 诊断入库和 AI 摘要采用同一 SQLite 事务，并支持旧 v0.1 数据库增量迁移。
9. 维护方案自动记录来源 `sample_id` 和 `diagnosis_id`，拒绝把手工风险覆盖伪装成模型来源。

## 使用的数据或接口

- `GET /api/fault-library`
- `GET /api/models/{model_version}`
- `POST /api/diagnosis/analyze`
- `POST /api/demo/simulate`
- `GET /api/diagnosis/{diagnosis_id}`
- `GET /api/diagnosis/sample/{sample_id}`
- `GET /api/diagnosis/history`
- 旧 `/api/ai-results`、状态、维护和复测接口保持兼容。

故障机理和公式来自 `data/fault-library/fault-features.json` 的标准/公开方法整理。
CARE Version 6 继续只作为已登记的聚合状态数据来源，不能表述为高采样原始振动或电流波形。

## 代码或文档提交号

本轮提交完成后以 GitHub `main` 最新提交为准。

## 数据来源标签

- 故障库和公式：`REFERENCE`
- CARE 聚合字段及其计算结果：`DERIVED`
- 规则演示波形、风险和置信度：`SIMULATED`
- 页面数字录入：`USER_INPUT`
- 有公开来源、许可和哈希的数据：`EXTERNAL_PUBLIC`

## 测试结果

- 后端自动测试：23 项通过。
- Python 编译与故障库 JSON 解析：通过。
- 前端生产构建：通过。
- 覆盖旧数据库迁移、四类故障库、非法采样率/通道/概率、未知故障/模型、伪造映射、样本追踪、维护来源和差异化模拟。

## 未解决问题

1. B 尚未交付导师要求的可复现混合 AI 模型、原始公开波形、FFT/STFT/小波包、t-SNE 产物和验证指标。
2. `hybrid-ai-v0.2.0` 因此登记为 `NOT_IMPLEMENTED`；当前可交互演示使用 `rule-demo-v0.2.0`，状态为 `DEMO_ONLY`。
3. C 当前仍在浏览器内运行本地 `diagnosticInference`，尚未调用本轮新诊断接口。
4. CARE 当前登记数据是聚合状态数据；没有来源、采样率和哈希时，D 会拒绝把波形标为 `REAL`。
5. CAD 部件正式工程映射未完成，诊断映射只允许 `UNMAPPED` 或 `CANDIDATE`，不能自行声明 `VERIFIED`。

## 下一步

1. B 按 `signal-analysis.v2` 提交真实模型结果与中间产物，登记模型版本、数据切分、指标和哈希。
2. C 在独立“演示模式”中调用 `/api/demo/simulate`；真实数字输入或 B 结果调用 `/api/diagnosis/analyze`。
3. C 使用同一个 `sample_id` 更新信号图、二维故障点、三维高亮和维护方案，不再使用浏览器固定规则作为正式推理。
4. A 审核故障库标准引用、公式适用条件、演示阈值和答辩表述。
