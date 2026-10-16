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
| 波形采样率 | 64 kHz（各同步通道约 256000 点、约 4 s；具体点数随测量文件变化，由各文件时间轴复核） |
| MAT 单位字段 | 三个高频通道的 `Unit` 均为空；系统保存为 `source_unit_unspecified`，不擅自补写单位 |
| 当前物理轴承 | `K001` 健康、`KA01` 外圈损伤、`KI01` 内圈损伤 |
| 每个轴承的测量次数 | 20；当前共 60 个可追溯样本 |

### 标签证据与边界

- 官方论文的健康轴承表将 `K001` 登记为 healthy。
- 官方论文的人工损伤表将 `KA01` 登记为 outer ring damage、`KI01` 登记为 inner ring damage。
- 同一 `.mat` 文件中的振动和两相电流共用一个 `sample_id`，不得拆成互不相关的样本。
- `sample_id` 包含工况、轴承、运行序号和源文件 SHA-256 前 12 位；完整 SHA-256 见样本清单。
- 当前每类只有一个物理轴承。20 次运行不是 20 个独立轴承，训练/验证/测试必须以 `bearing_code` 为分组边界。当前数据可用于适配器与闭环演示，但不足以声称完成跨轴承泛化评估。
- CARE Version 6 仍只作为 SCADA 聚合趋势来源，不参与此处 64 kHz FFT、STFT、小波包或包络谱计算。

### 下载包完整性

| 压缩包 | SHA-256 |
| --- | --- |
| `K001.rar` | `0f119ebdb28fb2f4d9fac1beb1319429f63f7ae1256c23c872f280f3560918e5` |
| `KA01.rar` | `6a6be1e11132730cc6f560d51eacedcbfd5fd74b829e9d8d3728c6c8a7cd4c0e` |
| `KI01.rar` | `b1dd6d99bb64d556f889fefaedb7e6e672900f5f015125615feaae776f055348` |

原始 `.rar` 和解压后的 `.mat` 不进入 Git。仓库仅保存适配器、来源登记、逐文件哈希和可复现实验代码。

## CARE Version 6

CARE 的完整登记见 `docs/data/care-dataset-register.md`。其十分钟均值、最大值、最小值、标准差等聚合量可用于趋势和事件分析，但没有被登记为可直接执行高频时频分析的原始波形。任何 FFT、STFT、小波包或包络谱结果都不得标记为 CARE 实测高频结果。
