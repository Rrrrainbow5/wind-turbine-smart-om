# WindCare 前端接力说明（先读这里）

## 0. 当前最重要结论

请先确认运行的是这个仓库的 `main`，不是旧目录、旧分支或另一个项目。当前远端 `main` 使用 React 19 和 `lucide-react`，**不包含 `@iconify/react` 和 `Icon.js`**。如果控制台出现 Iconify 或 `react/index.js does not provide an export named createElement`，说明启动的目录、分支或依赖不是当前版本，不要先改业务代码。

正确基线 commit：

```
b6e46e0 fix: make guide plan confirmation respond to card clicks
```

## 1. 首次启动（Windows）

```powershell
cd C:\Users\你的用户名\Documents\Codex\wind-turbine-smart-om
git fetch origin
git checkout main
git pull origin main
git log -1 --oneline
```

最后一行应显示 `b6e46e0` 或更晚的 main 提交。再确认：

```powershell
Get-Location
Get-Content frontend\package.json
rg -n "@iconify|Icon.js" frontend\src frontend\package.json
```

`rg` 应无输出。若没有要保留的本地改动，清理旧依赖后重新安装：

```powershell
cd frontend
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
npm install
npm run dev -- --host 127.0.0.1
```

浏览器打开终端打印的新地址，不要继续使用旧标签页中的旧端口。不要混用 npm 和 pnpm。

## 2. 白屏问题排查

若仍白屏，请先发以下输出，不要降级 React 或修改 Vite：

```powershell
Get-Location
git branch --show-current
git log -1 --oneline
Get-Content frontend\package.json
rg -n "@iconify|Icon.js" frontend\src frontend\package.json
```

- 报 `@iconify/react` 或 `Icon.js)：运行的不是当前 main，或旧依赖/旧 Vite 缓存未清理。
- 报 `createElement`：React 与旧图标包版本不匹配，应恢复仓库依赖。
- 报 `spawn EPERM`：Windows Node/Vite 权限问题，不是业务代码错误。

## 3. 已完成的业务功能

- 8 台风机选择、滑块故障模拟、规则式 AI 检测和风险评估。
- 现场检查、预防性维护、继续监测三种维护方案。
- 人员、备件、天气窗口、允许停机、吊装约束联动。
- 维护执行进度、复测前后对比、恶化、部分改善和二次维护。
- 复测未通过禁止确认修复；通过条件为置信度 `0%)、风险 `< 0.1)、健康指数 `> 85`。
- 引导遮罩不拦截真实操作；第 4 步点击方案卡后确认按钮才启用。
- 风机状态与维护日志按风机编号保存并持久化到 localStorage。
- Three.js 场景只初始化一次，天气刷新不会销毁重建。

## 4. 设计规则

1. 继续监测永远可执行，不要求人员、备件或天气；它表示故障未处理。
2. 现场检查需要人员、天气和停机许可；预防性维护还需要备件和吊装。
3. 复测失败不能清除故障，必须记录失败并允许二次维护。
4. 引导只由真实操作推进，禁止任意点击或自动定时器推进。
5. 3D renderer、scene、camera 和模型不能随天气或 UI 状态重建。

## 5. 主要文件

- `frontend/src/App.tsx`: 页面状态、引导、诊断、维护、复测和日志。
- `frontend/src/WindScene.tsx`: Three.js 场景、风机选择和动画循环。
- `frontend/src/style.css`: 页面布局、引导、方案卡和复测样式。
- `frontend/src/data.ts`: 演示数据和维护方案。
- `frontend/src/api.ts`: 后端接口调用。

## 6. 接手验收

- [ ] `git log -1` 为 `b6e46e0` 或更晚提交。
- [ ] 页面打开且控制台无 Iconify/React 导出错误。
- [ ] WT02 调整滑块后 AI 风险值变化。
- [ ] 约束关闭后对应方案锁定，继续监测仍可执行。
- [ ] 继续监测复测数据恶化，确认修复按钮置灰。
- [ ] 实际维护通过后故障清除，切换风机状态不串台。
- [ ] 引导第 4 步点击方案卡后确认按钮可用。

## 7. 后续待办

- 维护历史按操作类型着色并补充复测前后详情。
- 为 WT01-WT08 配置差异化 CARE 初始案例。
- 回归继续监测、二次维护、连续失败和 API 模式。
- 补齐窄屏方案卡、SVG 海浪和小船视觉。
- 解决 Windows Vite `spawn EPERM) 并通过完整 `npm run build`。

## 8. Git 接力

```powershell
git pull origin main
git add frontend/src docs/HANDOFF.md
git commit -m "feat: describe the change"
git push origin main
```

不要提交 `node_modules`、`.pnpm-store`、`.env) 或构建产物。每次只做一个明确任务，并说明修改文件、验证方式和已知限制。
