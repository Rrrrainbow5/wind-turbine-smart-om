# v0.2 文献原文证据矩阵

## 使用边界

本表仅依据团队提供的 PDF 原文首页、摘要和文内明确表述整理。题名、方法名称、期刊、DOI、数据描述和实验指标均保留原文英文表述；原文未明确给出的信息标为“原文未提及该内容”。论文的实验数据、实验指标和结论不能转写为本项目的训练数据、模型性能或工程效果。

| 序号 | 文献标题 | 研究对象 | 使用的数据类型 | 核心故障诊断/异常检测方法 | 发表年份 | 期刊 | DOI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rolling Bearing Fault Severity Recognition via Data Mining Integrated With Convolutional Neural Network | rolling bearings | “lab experimental bearing signals” and “signals collected from a wind turbine simulator with faulty high-speed shaft roller bearing” | “impulse mining and fault recognition”; “matrix profile (MP)”; “convolutional neural network (CNN) combined with softmax regression” | 2022 | IEEE Sensors Journal | 10.1109/JSEN.2022.3146151 |
| 2 | Unsupervised Anomaly Detection Method for Bearing Based on VAE-GAN and Time-Series Data Correlation Enhancement (June 2023) | bearing | “laboratory datasets and actual wind turbine datasets” | “temporal convolutional variational autoencoder—generative adversarial networks (TCVAE-GAN)” | 2023 | IEEE Sensors Journal | 10.1109/JSEN.2023.3326335 |
| 3 | Multi-Scale and multi-level feature enhanced meta-learning for few-shot fault diagnosis | “Paderborn bearing dataset and the LUT-WFD wind turbine fault dataset” | “time-frequency representations and raw temporal vibration signals” | “a dual-branch meta-learning fault diagnosis framework with multi-scale and multi-level feature enhancement” | 2026 | Knowledge-Based Systems | 10.1016/j.knosys.2026.116379 |
| 4 | A CNN-SA-GRU Model with Focal Loss for Fault Diagnosis of Wind Turbine Gearboxes | wind turbine gearboxes | “SCADA data”; “real wind farm data” | “CNN-SA-GRU and Focal Loss” | 2025 | Energies | 10.3390/en18143696 |
| 5 | Fault diagnosis of wind turbine based on multi-signal CNN-GRU model | wind turbine | “vibration signals from both sensors”; “CWRU dataset and the field gearbox dataset” | “Multi-Synchrosqueezing S-Transform”; “Convolutional Neural Network”; “Attention Mechanism”; “Gated Recurrent Unit”; “SoftMax” | 2023 | Proc IMechE Part A: J Power and Energy | 10.1177/09576509231151482 |
| 6 | Machine Learning Techniques for Wind Turbine Predictive Maintenance Using SCADA Data | “gearbox bearings and generator drive-end bearings” | “real SCADA data of three 2.1 MW wind turbines located in northeastern Brazil” | “Multiple Linear Regression (MLR), eXtreme Gradient Boosting (XGBoost), and Long Short-Term Memory (LSTM) neural networks”; “statistical process control” | 2026 | IEEE Access | 10.1109/ACCESS.2026.3692394 |
| 7 | Fault diagnosis and prediction of wind turbine gearbox based on a new hybrid model | wind turbine gearbox | “wind speed, ambient temperature, power, and gearbox shaft temperature”; “SCADA” | “grey relation analysis”; “extreme learning machine with kernel improved by the whale optimization algorithm” | 2023 | Environmental Science and Pollution Research | 10.1007/s11356-022-23893-x |
| 8 | A deep generative model based on CNN-CVAE for wind turbine condition monitoring | wind turbines | “an anomaly-free supervisory control and data acquisition systems (SCADA) dataset”; “datasets collected by SCADA installed in a commercial wind farm in China” | “convolutional neural network (CNN)-conditional variational auto-encoder (CV AE)”; “A statistical process control chart” | 2023 | Measurement Science and Technology | 10.1088/1361-6501/aca496 |
| 9 | Fault diagnosis of wind turbine gears based on OCSSA-VMD and WOA-CNN-BiLSTM | wind turbine gears | “wind turbine gearbox vibration data” | “OCSSA-VMD and WOA-CNN-BiLSTM” | 2024 | Engineering Research Express | 10.1088/2631-8695/ad806b |
| 10 | Early prediction of wind turbine anomalies using 1D-CNN and temporal feature engineering on multi-source SCADA data | wind turbine anomalies | “SCADA data from three distinct wind farms” | “1D Convolutional Neural Networks (1D-CNN)”; “a hybrid CNN-LSTM architecture augmented with an attention mechanism” | 2026 | Scientific Reports | 10.1038/s41598-026-41571-7 |
| 11 | The Diagnosis of Wind Turbine Blade Imbalance Using Dual-Input Signals in Parallel CNN-Transformer | wind turbine blade imbalance | “vibration data of the wind turbine nacelle collected through the SCADA system” | “a dual-signal parallel CNN-transformer model based on Fast Fourier Transform (FFT) and Variational Mode Decomposition (VMD)” | 2025 | IET Renewable Power Generation | 10.1049/rpg2.70071 |
| 12 | ARC-Informer: Axial–Radial Coupling-Aware Informer for Wind Turbine Main Bearing Health Monitoring | Wind Turbine Main Bearing | “real wind turbine data”; “axial and radial vibration signals” | “Axial–Radial Coupling-aware Informer (ARC-Informer)” | 2026 | Appl. Sci. | 10.3390/app16115578 |
| 13 | A 2DCNN-RF Model for Offshore Wind Turbine High-Speed Bearing-Fault Diagnosis under Noisy Environment | Offshore Wind Turbine High-Speed Bearing | “raw 1D time-domain bearing-vibration signals”; “CWRU high-speed bearing dataset” | “two-dimensional convolutional neural network (2DCNN) with random forest (RF)” | 2022 | Energies | 10.3390/en15093340 |

## 原文中可复核的指标摘录

下列数字仅为各论文的原文实验结果，不能作为本项目性能宣称。

| 序号 | 原文指标摘录 |
| --- | --- |
| 1 | “The results demonstrate that the proposed method can better recognize the fault severities of rolling bearings than the comparison methods.” |
| 2 | “The validation results obtained from both the laboratory datasets and actual wind turbine datasets demonstrate the high sensitivity of our method in detecting early weak faults in bearings.” |
| 3 | “Extensive experiments conducted on the Paderborn bearing dataset and the LUT-WFD wind turbine fault dataset demonstrate that the proposed method achieves superior diagnostic accuracy under few-shot learning, strong noise interference, and cross-condition transfer scenarios.” |
| 4 | “using Focal Loss improves the accuracy and F1 score by an average of 0.24% and 1.03%, respectively.” |
| 5 | “The results show that the proposed method achieves an average accuracy of 99.69% and 100% on the two datasets” |
| 6 | “XGBoost provides the most consistent overall performance, achieving R2 values up to 0.92 and MAPE below 2.2% for generator bearing prediction, while LSTM achieved R2 up to 0.99 and MAPE below 0.5% in specific gearbox cases” |
| 7 | “the proposed model has the smallest false-negative rate (0.211%) and mean absolute percentage error (2.812%).” |
| 8 | “Abundant experiments with state-of-the-art deep learning-based CM methods are conducted, which indicate that our proposed method outperforms other methods in robustness, fault detection data sensitivity, fault warning time, and model parameters.” |
| 9 | “improved fault classification accuracy to 98.3333% and diagnosis accuracy to 98.3853%” |
| 10 | “the 1D-CNN consistently outperformed the recurrent models, achieving an accuracy and F1-score of 85%.” |
| 11 | “The proposed method achieves a diagnostic accuracy of 97.5% under full-sample conditions and 95% under low-sample conditions.” |
| 12 | “MSE of 0.180–0.257 across prediction horizons 1–16”; “zero false alarms” in “10 healthy segments from five wind turbines” |
| 13 | “the diagnostic accuracy of the 2DCNN-RF model could achieve 99.548% on the CWRU high-speed bearing dataset” |

## 采用限制

1. 上表仅可作为方法调研和证据索引，不可替代本项目的模型训练、独立验证、泛化证明或安全性声明。
2. 当前 CARE 数据是 10 分钟聚合量，不能据此复现表中使用原始振动/电流波形的论文流程，更不能把 CARE 聚合量绘制为实测高频频谱。
3. 当前 B 端的分组验证状态仍为 `BLOCKED_INSUFFICIENT_BEARINGS`；任何后续模型卡必须引用其自身的分组、数据集、处理版本和实际评估结果。
4. 引用本表前，应保留对应 PDF 原文，并由 A 在答辩材料中核对引用格式和许可证/访问条件。
