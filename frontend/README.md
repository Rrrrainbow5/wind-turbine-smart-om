# WindCare C 模块

风电装备智能运维项目的三维数字孪生与前端交互原型。当前版本包含风场、设备选择、健康状态与趋势、维护方案、天气窗口变化、维护执行演示，以及接口模式。无需真实数据即可展示交互，但演示数据全部标记为 `SIMULATED`。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```bash
pnpm install
pnpm run dev
```

浏览器打开终端输出的本地地址。`pnpm run build` 可检查 TypeScript 并生成 `dist/`。

## 与 D 的后端联调

复制 `.env.example` 为 `.env.local`。同一台电脑联调时使用默认 `VITE_API_PROXY_TARGET`；跨电脑联调时设置 `VITE_API_BASE_URL` 为 FastAPI 完整地址。重启前端后点击页面右上角“接口”。

当前最小接口约定：

- `GET /api/turbines`：返回风机数组；前端读取 `turbine_id`、`display_name`、`wind_farm`、`operational_status` 和 `data_origin`。
- `GET /api/turbines/{id}/state`：返回部件状态数组。每项包含 `component_id`、`component_name`、`mapping_status`，以及可为空的 `latest_ai_result`。
- `POST /api/maintenance/optimize`：提交风机、部件、维护窗口和人员条件，取得后端生成的维护方案及 `plan_id`。
- `POST /api/maintenance/replan`：条件变化后携带 `source_plan_id` 和 `replan_trigger` 重新规划，并保留原方案追溯关系。
- `POST /api/maintenance/execute`：提交 `{ plan_id, executed_at, outcome, data_origin }` 记录维护执行。实际健康状态更新必须来自后端复测数据。

前端可选字段缺失时显示中性占位值。接口模式使用 D 的维护优化、重规划和执行接口；没有 AI 结果时不生成方案。接口模式不会伪造维护后的健康改善。

## 数据与工程边界

`src/data.ts` 中的数值、趋势、风机位置、维修成本等级和天气条件均为交互演示样例，不是 CARE 数据集记录或已训练模型结果。`failure_risk` 在未校准前仅称为风险评分。部件使用中性 ID，A、B 核实工程映射后再命名。C 的页面不对数据字段自行赋予部件含义。

## CARE Event 51 工程剖切模型

当前 C 模块以 Wind Farm A 的 CARE Version 6 Event 51（官方描述：`Gearbox bearings damaged`）作为主案例。选中 WT02 后，顶部“工程剖切视图”按钮会将镜头聚焦到机舱，并显示项目组建立的工程对象层级：

- `*_ROTOR_SHAFT`：转子轴
- `*_MBR`：主轴承
- `*_GBX`：齿轮箱
- `WF_A_EVENT_51_GEARBOX_BEARING`：Event 51 齿轮箱轴承状态对象
- `WF_A_EVENT_51_GEARBOX_BEARING_OUTER_RING`：轴承外圈
- `WF_A_EVENT_51_GEARBOX_BEARING_INNER_RING`：轴承内圈
- `WF_A_EVENT_51_GEARBOX_BEARING_CAGE`：保持架
- `WF_A_EVENT_51_GEARBOX_BEARING_ROLLER_01...10`：滚动体
- `*_GBX_STAGE_1_GEAR` / `*_GBX_STAGE_1_PINION`：齿轮级示意对象
- `*_HSS_COUPLING`：高速轴联轴器
- `*_GEN`：发电机
- `*_NACELLE_BED`：机舱承载基座

场景中的红色齿轮箱轴承是 Event 51 的工程定位高亮，不代表当前页面已经完成真实传感器诊断。其余机组仍用于展示风场级选择与状态交互。关闭剖切视图会返回全风场镜头。

外形已经接入 Sketchfab 上 Digital BIM Solutions 的 [Wind Turbine](https://sketchfab.com/3d-models/wind-turbine-a7a12edcc72b4ac88c9276df1f80856d)，来源页面标注为 CC BY 4.0。下载文件经检查为 glTF 2.0，包含 80 个节点、30 个网格、29,743 个顶点和 57,591 个三角面。项目将其缩放后复用于风场机组；项目组自建的内部工程层继续保留独立对象 ID 和数据绑定边界。完整署名及文件哈希见 `public/assets/ATTRIBUTION.md`。外形加载失败时页面会使用程序化备用外形，不影响数据面板和工程对象演示。

## 后续对接清单

1. A、B 确认风机、部件 ID 与字段字典，B 提供真实模型输出和指标定义。
2. D 增加复测结果查询接口后，C 将复测状态自动回写场景。
3. 团队完成 B 输出、D 决策和 C 展示的全链路演示验收。
