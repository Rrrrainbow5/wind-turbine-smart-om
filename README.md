# 风电装备智能运维后端 MVP

本仓库当前包含 D 负责的第一版后端闭环：AI 结果入库、风机状态查询、基础维护决策、维护执行记录与复测记录。

## 当前范围

- FastAPI 接口与自动生成的 Swagger 文档
- SQLite 数据库及最小初始化数据
- 中性稳定部件 ID，字段映射确认前不预设具体部件含义
- AI 结果的统一接入和最新状态查询
- 可解释的规则型维护决策与重新规划
- 数据来源类型标记：`REAL`、`DERIVED`、`SIMULATED`、`ASSUMED`、`REFERENCE`

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

接口约定见 [docs/api-contract.md](docs/api-contract.md)，维护规则见 [docs/maintenance-decision.md](docs/maintenance-decision.md)。

完整项目背景见 [项目总说明与协作规范](docs/第十届中国大学生工程实践与创新能力大赛_更新版_CARE数据集.docx)。
