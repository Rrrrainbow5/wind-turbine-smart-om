# 真实风机波形样本交接说明 v0.2

样本 `wt-sweden-2018-dataset02-row-000000` 已完成来源、结构和时域统计核验，交接文件为 `wt-sweden-sample-input-handoff-v0.2.json`。

## B 的工作

从原始片段读取 16,384 点轴向振动，按 12,800 Hz 完成质量检查、去直流/去趋势、FFT、STFT 或小波包。若模型适用范围不覆盖无标签真实风机数据，应输出“仅异常分析/模型范围外”，不能强制给出轴承故障类别。

## D 的工作

将原始文件保存到后端 artifact store 后，替换 `artifact_uri` 并保留 SHA-256。`POST /api/diagnosis/analyze` 需要完整 diagnosis 对象，因此当前 JSON 是输入交接包，不是可发送的 API payload。

## C 的工作

可展示“真实风机开放数据、未标注”的原始波形和已核验时域统计。B 未交付时频结果前，不显示频谱峰、故障类别、风险分数或三维故障高亮。

## 不可更改的边界

- `data_origin=EXTERNAL_PUBLIC`。
- `component_id=EXTERNAL_UNMAPPED_COMPONENT_01`，没有 CAD 映射证据前不可改为项目机组的轴承或齿轮箱节点。
- `fault_id=null`，因为来源未提供该样本故障标签。
