# 信号来源登记（v0.2）

## Paderborn Bearing Data Center

| 字段 | 已核验值 |
| --- | --- |
| 数据来源 | Paderborn University, Bearing Data Center |
| 官方页面 | https://mb.uni-paderborn.de/kat/forschung/bearing-datacenter |
| 下载目录 | https://groups.uni-paderborn.de/kat/BearingDataCenter/ |
| 许可 | CC BY-NC 4.0；仅按许可用于非商业学术用途，并保留署名 |
| 数据来源标签 | `EXTERNAL_PUBLIC` |
| 本轮工况 | `N15_M07_F10`：1500 rpm、0.7 Nm、1000 N |
| 同步高频通道 | `vibration_1`、`phase_current_1`、`phase_current_2` |
| 波形采样率 | 官方标称 64 kHz；适配器逐文件校验源时间轴，并在时间间隔不均匀或点数偏离时显式重采样到均匀 64 kHz 栅格 |
| MAT 单位字段 | 三个高频通道的 `Unit` 均为空；系统保存为 `source_unit_unspecified`，不擅自补写单位 |
| 当前物理轴承 | `K001`、`K002` 健康；`KA01`、`KA03` 外圈损伤；`KI01`、`KI03` 内圈损伤 |
| 每个轴承的测量次数 | 20；当前共 120 个可追溯样本 |

### 标签证据与边界

- 官方论文的健康轴承表将 `K001`、`K002` 登记为 healthy。
- 官方论文的人工损伤表将 `KA01`、`KA03` 登记为 outer ring damage，将 `KI01`、`KI03` 登记为 inner ring damage。
- 同一 `.mat` 文件中的振动和两相电流共用一个 `sample_id`，不得拆成互不相关的样本。
- `sample_id` 包含工况、轴承、运行序号和源文件 SHA-256 前 12 位；完整 SHA-256 见样本清单。
- 部分官方文件在约 4 s 内包含多于 256001 个源点，且时间间隔不均匀。适配器不会直接把这些点冒充均匀 64 kHz 波形，而是校验时间轴后重采样；清单保存 `source_sample_count`、`timebase_processing`、`source_gap_count` 和 `max_source_gap_seconds`。
- 存在超过四个标称采样间隔的源时间轴缺口时，样本仍可保留用于追溯，但清单标记为 `SOURCE_TIMEBASE_GAP_RESAMPLED`。这类样本在频谱训练前应排除或单独做敏感性分析，不能与无缺口样本等同使用。
- 本轮 120 个文件的审计结果为：24 个保持原 64 kHz 均匀栅格，91 个无明显缺口但需重采样，5 个含源时间轴缺口并单独标记。
- 当前每类有两个物理轴承。20 次运行不是 20 个独立轴承，训练/验证/测试必须以 `bearing_code` 为分组边界。两个轴承/类仍不足以支持稳定的三路跨轴承 train/validation/test 划分；当前数据可用于适配器、闭环演示和按轴承留出实验，但不得夸大泛化能力。
- CARE Version 6 仍只作为 SCADA 聚合趋势来源，不参与此处 64 kHz FFT、STFT、小波包或包络谱计算。

### 下载包完整性

| 压缩包 | SHA-256 |
| --- | --- |
| `K001.rar` | `0f119ebdb28fb2f4d9fac1beb1319429f63f7ae1256c23c872f280f3560918e5` |
| `K002.rar` | `1040da8b74d169c4e8c8545afa335d7a3a320bcaf36a471250c3e434bc4caffd` |
| `KA01.rar` | `6a6be1e11132730cc6f560d51eacedcbfd5fd74b829e9d8d3728c6c8a7cd4c0e` |
| `KA03.rar` | `21f188899e46183a29752e5dbc830e3132e0fee4d7eb5507450d1730a5b264b5` |
| `KI01.rar` | `b1dd6d99bb64d556f889fefaedb7e6e672900f5f015125615feaae776f055348` |
| `KI03.rar` | `725010ee4158256eef9ef7f58da835fc2150579d6e97b5d48bcd2ee70795d77e` |

原始 `.rar` 和解压后的 `.mat` 不进入 Git。仓库仅保存适配器、来源登记、逐文件哈希和可复现实验代码。

## CARE Version 6

CARE 的完整登记见 `docs/data/care-dataset-register.md`。其十分钟均值、最大值、最小值、标准差等聚合量可用于趋势和事件分析，但没有被登记为可直接执行高频时频分析的原始波形。任何 FFT、STFT、小波包或包络谱结果都不得标记为 CARE 实测高频结果。

## 已审核的补充公开波形来源

| source_id | 数据来源 | data_origin | 已核验信号范围 | 允许用途 | 关键限制 |
| --- | --- | --- | --- | --- | --- |
| `SRC-WT-SWEDEN-2018` | 瑞典北部六台风机原始振动，DOI `10.5878/cbn6-c922` | `EXTERNAL_PUBLIC` | 输出轴轴承壳体轴向振动；12.8 kHz；一个已核验切片为 1.28 s / 16,384 点，含转速 | 真实风机原始波形、预处理、FFT/STFT、无监督异常研究 | 未提供逐段故障标签；不得用于多类监督故障分类或准确率报告；原始切片不随仓库分发 |
| `SRC-MCSA-ROTORBAR-2026` | 转子条渐进钻孔 MCSA 基准，DOI `10.5281/zenodo.23438066` | `EXTERNAL_PUBLIC` | 单相电机电流 ADC count；390 个 650 点窗口 | 电流信号处理链和来源追溯演示 | 同一故障转子仅有连续钻孔阶段，不得证明跨电机或跨风机泛化 |
| `SRC-SNU-GEAR-2026` | SNU 行星齿轮箱数据，DOI `10.6084/m9.figshare.32025606.v5` | `EXTERNAL_PUBLIC` | 原始振动和编码器；25.6 kHz；约 100 min / 工况 | 后续齿轮信号处理展示或独立子模型 | 2 kW 试验台数据，不得描述为风机现场数据；完整 16.5 GB 数据包未纳入本仓库 |

瑞典风机样本的切片哈希、来源文件哈希、统计量、使用边界与 B/C/D 交接契约见：

- `docs/data/public-waveform-source-verification-v0.2.md`
- `docs/integration/wt-sweden-sample-handoff-v0.2.md`
- `docs/integration/wt-sweden-sample-input-handoff-v0.2.json`
