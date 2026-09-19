# B C D 第一轮联调指南

## 联调目标

跑通以下 P0 链路：

```text
B 输出 AI 结果
  -> D 接口写入数据库
  -> C 查询风机和部件状态
  -> D 根据最新风险生成维护方案
  -> C 展示推荐动作和备选动作
```

本轮只使用 `WT02` 和 `WT02_COMPONENT_01`。在 CARE 字段映射确认前，禁止把中性部件 ID 改成齿轮箱、主轴承或发电机名称。

## D 启动后端

```powershell
cd D:\工创赛\wind-turbine-smart-om
& '.\.venv\Scripts\python.exe' -m uvicorn backend.app.main:app --reload
```

检查：

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/docs
```

## B 提交 AI 结果

仓库提供了不依赖第三方库的提交脚本：

```powershell
& '.\.venv\Scripts\python.exe' examples\b_submit_ai_result.py
```

输入样例位于 `examples/ai-result.simulated.json`。其中所有数值仅用于联调，因此标记为 `SIMULATED`。B 接入真实模型后，应使用实际推理时间和模型版本；由真实数据计算得到的模型结果标记为 `DERIVED`。

成功标准：接口返回 HTTP `201`，响应中包含自增的 `id` 和 `created_at`。

B 不应：

- 自行修改 `turbine_id` 或 `component_id` 格式。
- 在无法确认工程映射时把匿名传感器命名为具体部件。
- 把手工填写的示例数值标成 `REAL` 或 `DERIVED`。

## C 查询状态

C 可以把 `examples/c_api_client.ts` 放入前端的 `src/services/`，并在 `.env.local` 中配置：

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

查询状态：

```ts
const states = await getTurbineState("WT02");
const state = states.find(
  (item) => item.component_id === "WT02_COMPONENT_01",
);

console.log(state?.latest_ai_result?.failure_risk);
console.log(state?.latest_ai_result?.warning_level);
```

生成维护方案：

```ts
const plan = await optimizeMaintenance("WT02", "WT02_COMPONENT_01");

console.log(plan.recommended_action);
console.log(plan.priority);
console.log(plan.candidates);
```

条件变化后重新规划时，保留原方案 ID 和触发原因：

```json
{
  "turbine_id": "WT02",
  "component_id": "WT02_COMPONENT_01",
  "source_plan_id": "原维护方案 ID",
  "maintenance_window_available": false,
  "personnel_available": true,
  "decision_origin": "ASSUMED",
  "conditions_origin": "SIMULATED",
  "rule_version": "trial-v0.1",
  "replan_trigger": "weather_window_closed"
}
```

D 会在响应中返回 `parent_plan_id`、`replan_trigger`、实际风险输入和资源条件；原方案不会被覆盖，而是保留在维护历史中并标记为 `REPLANNED`。

C 必须处理以下状态：

- 接口尚无 AI 结果时显示“暂无分析结果”。
- HTTP 非 2xx 时显示可恢复错误，不伪造风险数据。
- `mapping_status = UNVERIFIED` 时使用中性部件名称。
- `requires_replan = true` 时提示当前维护条件不足。

## 第一轮验收

- B 的样例能够由 `POST /api/ai-results` 返回 HTTP `201`。
- 数据库保存 `model_version` 和 `data_origin`。
- C 能读取并显示 `health_index`、`failure_risk` 和 `warning_level`。
- C 能展示推荐维护动作、优先级、理由和三个候选动作。
- 页面没有写死风险值或维护方案。
- 所有演示数据明确标记为 `SIMULATED`。

## 跨电脑联调

`127.0.0.1` 只适用于前后端运行在同一台电脑的情况。跨电脑联调时，D 在可信局域网中启动：

```powershell
& '.\.venv\Scripts\python.exe' -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

C 将 `VITE_API_BASE_URL` 改为 D 电脑的局域网地址。只在可信网络中开放开发服务，不把该命令当作正式公网部署方案。
