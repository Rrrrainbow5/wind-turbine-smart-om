# 风电装备智能运维 MVP


本仓库包含 D 负责的后端闭环，以及 C 负责的三维数字孪生与前端交互模块。


## 当前范围


- FastAPI 接口与自动生成的 Swagger 文档
- SQLite 数据库及最小初始化数据
- 中性稳定部件 ID，字段映射确认前不预设具体部件含义
- AI 结果的统一接入和最新状态查询
- 可解释的规则型维护决策与重新规划
- 数据来源类型标记：`REAL`、`DERIVED`、`SIMULATED`、`ASSUMED`、`REFERENCE`
- Digital BIM 风机外形、CARE Event 51 工程剖切与零部件状态高亮
- 风场总览、状态趋势、维护优化、条件变化重规划和执行记录前端流程


## 本地启动


```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
uvicorn backend.app.main:app --reload
```


启动后访问：


- Swagger：<http://127.0.0.1:8000/docs>
- 健康检查：<http://127.0.0.1:8000/health>


默认数据库为项目根目录下的 `windcare.db`。可通过环境变量 `WINDCARE_DB_PATH` 指定其他位置。


## 测试


```powershell
pytest
```

## C 三维数字孪生前端

前端位于 [`frontend/`](frontend/)，默认演示案例为 CARE Version 6、Wind Farm A、Event 51（`Gearbox bearings damaged`）。外形使用 Digital BIM Solutions 的 Wind Turbine，内部齿轮箱、轴承、齿轮级、联轴器和发电机对象由项目组构建。模型授权、来源和文件哈希见 [`frontend/public/assets/ATTRIBUTION.md`](frontend/public/assets/ATTRIBUTION.md)。

```powershell
cd frontend
pnpm install
pnpm run dev
```

前端默认通过 Vite 代理访问 `http://127.0.0.1:8000`。跨电脑联调时复制 `.env.example` 为 `.env.local`，并设置 `VITE_API_BASE_URL`。接口模式遵守以下边界：

- 没有 AI 结果时显示“暂无分析结果”，不补造数值。
- `mapping_status = UNVERIFIED` 时显示中性部件名称。
- 维护方案来自后端 optimize/replan 接口，执行记录使用后端生成的 `plan_id`。
- 维护后状态保持“待复测”，不自动声称设备健康改善。

前端生产构建：

```powershell
cd frontend
pnpm run build
```


接口约定见 [docs/api-contract.md](docs/api-contract.md)，第一轮联调步骤见 [docs/integration-guide.md](docs/integration-guide.md)，维护规则见 [docs/maintenance-decision.md](docs/maintenance-decision.md)，待 A 确认的事项见 [docs/maintenance-rule-review.md](docs/maintenance-rule-review.md)。

## A 工程与数据文档

- [CARE 数据资产登记](docs/data/care-dataset-register.md)
- [Event 51 证据报告](docs/data/care-event-51-evidence.md)
- [事件登记表](docs/data/event-register.csv)
- [字段字典](docs/data/field-dictionary.csv)
- [工程决策登记表](docs/engineering/decision-register.md)
- [A 工程审查记录](docs/integration/a-review-log.md)
- [A 状态与交接说明](docs/integration/a-status-and-handover-v0.1.md)
