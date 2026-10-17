# 风机传动链故障与特征库 v0.2

## 用途

`data/fault-library/fault-features.json` 是本项目的结构化故障库。它把故障大类、失效形式、机理、可观测信号、特征频率公式和数据边界放在同一份可审查资产中，供 B 的模型说明、C 的图例和 D 的接口设计引用。

这不是设备制造商的报警限值表，也不是已经验证的诊断模型。条目用于说明“应采集什么、可以怎样计算、证据还缺什么”，不能单独把一个观测现象判定为故障。

## 分类和标准依据

当前分为四类：

1. **齿轮故障**：断齿、裂齿、点蚀、胶合和磨损等齿面或齿根损伤。
2. **轴承故障**：内圈、外圈、滚动体损伤，以及润滑、污染和不对中相关异常。
3. **振动异常**：宽带冲击、非平稳振动、结构共振和塔架响应异常。它首先是观测类别，不能直接等同于某一个部件失效。
4. **电机电气故障**：定子绕组/三相不平衡、变流器或 IGBT 热异常、直流链路异常等。

标准引用只登记编号、用途和版本核验要求，不复制受版权保护的正文：

- `ISO 15243`：滚动轴承损伤与失效术语和特征。
- `ISO 13373-2`：振动状态监测数据的处理、分析和展示。
- `ISO 13374`：状态监测数据处理、通信和展示架构。
- `ISO 13379-1`：数据解释与诊断技术的一般指南。
- `ISO 20816-21`：带齿轮箱和发电机的水平轴风机振动测量与评价参考。
- `IEC 61400-25` 系列：风电监测与控制的信息模型和通信语境。

答辩时应说“依据相关标准建立术语和处理框架”，不要说这些标准直接给出了本项目的 AI 阈值或维修成本。具体版次由团队用学校/机构可访问的标准库再次核对，并在提交材料中补充版次和条款页码。

## 频率公式的使用规则

JSON 中的公式是工程参考关系，不是当前 CARE 数据直接算出的结果。

- 齿轮啮合频率：`f_mesh = z_p * f_p = z_g * f_g`。必须知道两齿轮齿数和对应轴频率。
- 轴承特征频率：`FTF`、`BPFO`、`BPFI`、`BSF` 均需要滚动体数量、滚动体直径、节圆直径、接触角和相对转频。
- 转频阶次：`f_order(k) = k * f_r`。必须有同步转速和原始振动波形，变速工况还需要阶次跟踪。
- 电气基波：`f_e = p * n_s / 120`。必须有极数和同步转速；变流器侧还要知道测量点和开关频率。

缺少几何参数、采样率、测点或原始波形时，系统只能显示公式和“参数不足”，不能显示一个看似精确的 Hz 数值。任何频率峰也必须说明采样率、Nyquist 频率、窗长、重叠率、滤波器和频率分辨率。

## CARE 数据边界

CARE Version 6 已登记的字段主要是风场事件标签和 SCADA 聚合统计量。字段字典中可以追溯到：

- Wind Farm A：齿轮箱高速轴承温度 `sensor_11_avg`、齿轮箱油温 `sensor_12_avg`、发电机轴承温度 `sensor_13_avg/sensor_14_avg`、发电机转速 `sensor_18_avg`、转子转速 `sensor_52_avg`、三相电流 `sensor_23_avg` 至 `sensor_25_avg`。
- Wind Farm B：齿轮箱轴承温度 `sensor_34_avg` 至 `sensor_37_avg`、油温 `sensor_38_avg/sensor_39_avg`、转子轴承温度 `sensor_51_avg/sensor_52_avg`、传动链振动 `sensor_54_avg`、三相 RMS 电流 `sensor_16_avg` 至 `sensor_18_avg`。
- Wind Farm C：传动链/机舱振动字段、行星轴承温度、齿轮箱油温、发电机 RMS 电流和电压等，具体字段以 `docs/data/field-dictionary.csv` 为准。

这些字段不是统一的高采样率瞬时电流或加速度波形。Wind Farm A Event 51 的登记时间分辨率为 10 分钟。因此：

- CARE 可以支持事件标签核验、温度/功率/转速/电流趋势和聚合统计分析；
- CARE 的聚合振动值不能被重新包装成原始波形；
- 不能把 10 分钟 SCADA 序列直接做 FFT、STFT 或小波包，然后声称得到轴承 BPFO/BPFI 或齿轮啮合频率；
- 原始波形演示必须另行登记采样率、测点、许可、校验值和故障标签，并标记为 `REAL`、`DERIVED` 或 `SIMULATED`。

## 与后续模块的接口约定

一个故障样本从数据到页面必须保持同一个 `sample_id`：

```text
sample_id
  -> raw signal metadata
  -> preprocessing run (processing_run_id)
  -> time-domain statistics
  -> STFT / wavelet packet / spectrum features
  -> model result (model_version)
  -> fault category and component mapping
  -> three-dimensional highlight and maintenance decision
```

至少记录 `source`、`data_origin`、`channel`、`unit`、`sampling_rate_hz`、`window_length`、`overlap`、`sensor_location` 和处理参数。没有真实值时返回 `null` 或明确的“未提供”，不补造采样率、故障频率或阈值。

### D 端加载器建议

后端可在独立模块中提供只读、带缓存的加载函数，不必把 JSON 解析逻辑写进每个路由：

```python
from functools import lru_cache
import json
from pathlib import Path

@lru_cache(maxsize=1)
def load_fault_feature_library(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != "fault-feature-library-v0.2":
        raise ValueError("Unsupported fault feature library schema")
    if not isinstance(payload.get("categories"), list):
        raise ValueError("Fault feature library categories are missing")
    return payload
```

正式实现还应校验类别和故障 ID 唯一、引用的 `ref_id` 存在，并在测试中验证文件缺失、JSON 损坏和不支持的 schema 版本。API 建议返回整个库的版本与来源标签，并支持按 `category_id` / `failure_mode_id` 查询；不要在路由响应阶段修改库内容。

## 当前实现边界和验收条件

本文件和 JSON 只完成故障知识资产，不代表前端已经实现完整信号处理链。B、C、D 后续实现时应满足：

1. 原始时域、预处理、STFT/小波包和频域图来自同一 `sample_id`，页面展示中间结果而不是直接跳到诊断结论。
2. 均值、方差、峭度等统计量可以由独立脚本按同一窗口复算。
3. 图谱必须显示轴标签、单位、采样率和处理参数。
4. 诊断模型结果带 `model_version`、特征清单、数据来源和时间切分。
5. `t-SNE` 只作为特征空间可视化，记录随机种子和参数，不把二维分离图当作准确率证明。
6. CARE 聚合字段和原始波形样本在 UI 上明确区分，不能混用。

## 证据标签

页面和 API 继续使用项目统一的来源标签：

| 标签 | 含义 |
| --- | --- |
| `REFERENCE` | 标准、论文或字段说明提供的知识和公式 |
| `REAL` | 可追溯的真实原始测量 |
| `DERIVED` | 从登记数据计算出的特征或模型结果 |
| `SIMULATED` | 为演示生成的信号、参数或维护效果 |
| `ASSUMED` | 尚未被数据或标准支持的试行规则 |
| `USER_INPUT` | 用户在数字录入界面提供的数据 |
| `EXTERNAL_PUBLIC` | 有公开来源、许可说明和完整性校验的外部数据 |

特别是，当前 CARE 到 `WT02_COMPONENT_01` 的系统映射仍按项目决策登记为待核验；故障库中的部件名称是参考分类，不能自动证明某个 CAD 节点就是现场故障部件。

## v0.2 信号计算契约

新增的信号处理实现遵循以下可复算顺序：

1. 校验 `sample_id`、来源标签、有限的一维数值和正采样率。
2. 去除线性趋势；变换前应用 Hann 窗，并记录供模型输入使用的 z-score 缩放参数。
3. 输出原通道单位下的均值、方差、标准差、RMS、偏度、峭度、峰峰值、峰值和峰值因子，同时保留去趋势后的统计量。
4. 输出 Hann 窗单边 FFT、STFT 功率谱密度、解析信号包络谱和三级正交 Haar 小波包能量；STFT 必须同时返回时间轴和频率轴。

实现只在参数完整时计算具体特征频率。`1X = shaft_speed_rpm / 60`、`2X = 2 * f_r`、`GMF = gear_teeth * f_r`；轴承频率仍必须提供滚动体数量、滚动体直径、节圆直径和接触角，缺失时只返回公式。

v0.2 模型接口包含工程统计特征 + XGBoost、原始波形 + 1D-CNN，以及 STFT 时频图 + 轻量 CNN 三个分支。模型验证未通过时不得将输出升级为正式诊断；Robust-Z 仍是异常检测基线，耦合信号模拟器仅用于演示，不是经验证的物理模型。
