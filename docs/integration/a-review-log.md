# A 工程审查记录

## 审查信息

- 审查日期：2026-09-19
- 审查范围：D 后端 v0.1 下载快照
- D 报告提交：`3bf83af`
- 审查角色：A（工程场景、数据、标准与 KPI）
- 说明：当前目录来自 GitHub ZIP，不含 `.git` 元数据，因此提交号与 Actions 状态依据 D 的报告记录；本次审查针对快照中的文件内容。

## 已核对内容

- `docs/api-contract.md`
- `docs/integration-guide.md`
- `docs/maintenance-decision.md`
- `docs/maintenance-rule-review.md`
- `backend/app/schemas.py`
- `backend/app/maintenance.py`
- `backend/app/database.py`
- `backend/app/main.py`
- `tests/test_api.py`
- `examples/ai-result.simulated.json`

## 审查结论

当前后端已经具备第一次模拟联调所需的基础链路：AI 结果入库、状态与风险查询、维护方案、重新规划入口、执行记录和复测记录。中性 ID、来源分类和模拟样例符合当前工程边界。

后端目前适合作为 `v0.1 backend MVP`，但不应描述为已经完成真实 CARE 模型验证或真实风场工程验证。

## 已通过的工程检查

- [x] 使用 `WT02 / WT02_COMPONENT_01` 统一测试 ID。
- [x] 部件映射未确认时使用中性名称。
- [x] AI 结果保存模型版本和数据来源。
- [x] 风险、健康指数和异常分数具有范围校验。
- [x] 提供三种候选维护动作及理由。
- [x] 重新规划会创建新方案，不覆盖旧数据库记录。
- [x] 维护执行和复测记录可以关联。
- [x] 示例 JSON 明确标记为 `SIMULATED`。

## 待 D 处理的工程差异

| 编号 | 差异 | 优先级 | A 的建议 |
| --- | --- | --- | --- |
| A-D-01 | 人员输入只有布尔值 | P0 | 改为可用人员单位，检查需 1、维护需 2 |
| A-D-02 | 中风险检查没有判断窗口 | P0 | 现场检查与维护均要求窗口可用 |
| A-D-03 | 执行接口没有显式人工确认字段 | P0 | 保存确认人/操作者和确认时间 |
| A-D-04 | 方案没有保存输入条件和规则版本 | P0 | 保存风险、人员、窗口和 `rule_version` |
| A-D-05 | 重规划方案没有关联原方案 | P1 | 增加父方案 ID 和触发原因 |
| A-D-06 | 风险分数和等级可能冲突 | P0 | 校验一致性或进入人工复核 |
| A-D-07 | 场景未明确为陆上 | P1 | 增加 `ONSHORE` 元数据，保持对象映射未验证 |
| A-D-08 | 缺少阈值边界测试 | P0 | 增加 0.45、0.75 和资源不足测试 |

详细规则以 `docs/maintenance-rule-review.md` 为准。

## 待 B 提供

- 一条符合 `docs/api-contract.md` 的真实模型结果 JSON。
- `failure_risk` 的计算方法和是否完成概率校准。
- `warning_level` 与风险评分的对应规则。
- 数据版本、事件来源、训练/验证/测试划分和模型版本。
- Precision、Recall、F1、AUC 或其他指标的适用条件与结果。

## 待 C 验证

- 页面所有状态、风险和维护方案均来自 D 接口。
- 无结果和 HTTP 错误时不伪造风险数据。
- 未核验映射使用中性部件名称。
- 显示时间戳、模型版本和数据来源标签。
- 修改人员或窗口后展示新旧方案和变化原因。

## A 尚待完成

- 已获取 CARE Version 6 解压目录并核验官方 MD5：`2547b58c21ac8c242d13232860cf500c`。
- 已建立 `docs/data/event-register.csv` 和 `docs/data/field-dictionary.csv`。
- 已交叉核验 Event 51：Wind Farm A、asset 21、齿轮箱轴承损伤、事件数据文件存在。
- 审查 B 的真实模型证据和阈值实验。
- 在第一次全员联调后填写 KPI 实测结果和最终问题清单。

## 当前 A 结论

- v0.1 主案例建议正式采用 `Wind Farm A / Event 51`，场景为 `ONSHORE`。
- B 第一版可优先评估 A 风场 `sensor_11_avg` 和 `sensor_12_avg`；字段含义来自官方 `feature_description.csv`，但缺失值、异常值和时间切分仍由 B 负责确认。
- `sensor_14_avg` 已发现 1 条缺失，不能直接进入模型；其余字段也必须先通过 B 的质量检查。
- `failure_risk` 在概率校准完成前只能称风险评分；0.45 和 0.75 仍是 `ASSUMED` 可配置阈值。
- CARE 真实数据、B 的派生特征/模型输出、D/C 的演示条件必须继续分别标记为 `REAL`、`DERIVED`、`SIMULATED`。

## 证据边界

事实、项目建议和临时假设已集中记录在 `docs/engineering/decision-register.md`。其中 0.45/0.75 阈值、人员单位、维护窗口、维护效果和 CARE 到系统对象的映射均不是比赛文件或 CARE 原始数据直接给出的事实；在获得证据或全队批准前，只能作为 `ASSUMED`、`SIMULATED` 或 `UNVERIFIED` 使用。
