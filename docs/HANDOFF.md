# WindCare Frontend Handoff

## 目标版本

本版本用于答辩演示和团队接力开发，核心闭环固定为：

`选择风机 -> 调整传感器参数 -> AI 故障检测 -> 维护方案 -> 执行 -> 复测 -> 状态回授`

暂不扩展真实天气接入、生产级模型推理和复杂工单系统。

## 运行

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

默认地址：`http://127.0.0.1:5173/`。如果端口被占用，以终端实际输出为准。

演示模式不依赖后端；接口模式需要先启动 D 的 FastAPI 服务。

## 主要代码

- `frontend/src/App.tsx`: 页面状态、诊断规则、维护决策、复测和引导。
- `frontend/src/WindScene.tsx`: Three.js 场景、风机选择、稳定渲染循环。
- `frontend/src/style.css`: 页面样式、引导遮罩、方案卡和复测状态。
- `frontend/src/api.ts`: 后端接口调用，不在前端伪造接口响应。
- `frontend/src/data.ts`: 演示风机、故障案例和维护方案。

## 当前交互约定

1. 引导遮罩使用 `pointer-events: none`，只由真实页面操作推进。
2. 继续监测不会要求人员可用；现场检查和预防性维护受工程约束锁定。
3. 复测通过条件：置信度为 `0`、风险 `< 0.1`、健康指数 `> 85`。
4. 复测失败不能确认修复；“修复未达标”会回到维护决策。
5. 风机状态保存在 `turbineStates`，切换风机时读取对应状态。
6. 维护日志保存在每台风机的 `maintenanceLog` 中。

## 交接验收

- [ ] 选择 WT02，拖动至少一个诊断滑块，确认 AI 风险数值变化。
- [ ] 进入维护决策，关闭人员或天气，确认对应方案变灰。
- [ ] 选择继续监测并执行，确认复测数据恶化且不能确认修复。
- [ ] 选择现场检查或预防性维护，执行后确认复测结果和状态变化。
- [ ] 切换 WT03 再切回 WT02，确认风机状态和日志没有串台。
- [ ] 重新查看引导，确认滑块步骤不会自动推进，方案步骤需要确认按钮。
- [ ] 检查 3D 场景在天气刷新后没有重建或闪烁。

## 构建说明

先运行：

```powershell
npx tsc -b --pretty false
```

当前代码的 TypeScript 检查应通过。部分 Windows 环境运行 `npm run build` 时，Vite 可能在启动阶段报 `spawn EPERM`；这属于 Node/Vite 进程权限问题，不是 TypeScript 编译错误。可尝试在项目目录重新安装依赖、使用管理员终端，或将项目移动到无特殊权限的短路径后再构建。

## Git 接力

解压目录没有 `.git`，不能提交。接力时应使用 GitHub 克隆目录：

```powershell
git clone https://github.com/Rrrrainbow5/wind-turbine-smart-om.git
cd wind-turbine-smart-om
```

修改前先执行 `git pull origin main`，完成一个可验证的小改动后提交：

```powershell
git add frontend/src docs
git commit -m "feat: describe the change"
git push origin main
```

不要把 `node_modules`、构建产物或本地 `.env` 提交到仓库。

## 后续原则

优先修复会阻断闭环的 bug，再做视觉增强。新增需求必须说明影响的状态、接口和验收步骤；不要同时重写引导、维护决策和 3D 场景。
