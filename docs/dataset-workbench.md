# 数据集工作台

网页右栏“数据集接入”独立于风机接口。支持两条链路：

1. `GET /api/datasets/experiments` 查询仓库中 115 条 Paderborn 留出评估记录，包含真实标签、预测、分数、哈希和总体指标。这是评估查询，不是实时模型推理。
2. `POST /api/datasets/analyze` 接收 JSON 多通道窗口，计算原始统计量、线性去趋势、FFT、STFT、小波包及包络谱。前端显示原始与处理后波形、功率谱、STFT、统计量。新上传波形返回 NOT_INFERRED，不生成虚构故障结论。

JSON 必填字段：sample_id、sampling_rate_hz、data_origin（REAL/EXTERNAL_PUBLIC/SIMULATED）、source_reference、channels。每个通道包含 name、unit、samples。最多 8 通道，等长，每通道 16–4096 个有限数值，请求最大 2 MB。需要先从大型原始数据集导出同步信号窗口；本版不直接解析 MAT、ZIP 或任意 CSV。

本地启动：安装 requirements.txt 和 requirements-ai.txt，运行 `.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`，在 frontend 运行 npm run dev。Vite 代理 /api 到 8000。

公网：GitHub Pages 仅承载前端。需单独部署 FastAPI，并配置 WINDCARE_ALLOWED_ORIGINS 包含前端 origin；构建时设置 VITE_API_BASE_URL，或在数据集工作台输入后端 HTTPS 地址。后者只影响工作台，不改变原有风机接口地址。浏览器需允许该服务的 CORS。没有公网后端时无法声称已完成公网上传服务。
