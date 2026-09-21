import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowRight, Check, ChevronDown, Clock3, CloudSun, Database, Gauge, Layers3, MapPin, RotateCcw, Server, Settings2, Wrench, X } from 'lucide-react'
import WindScene from './WindScene'
import { executeMaintenance, fetchRetests, fetchTurbines, optimizeMaintenance, replanMaintenance, type ApiMaintenancePlan, type ApiRetest } from './api'
import { demoTurbines, getDemoPlans, warningText, type MaintenancePlan, type Turbine } from './data'

type Mode = 'demo' | 'api'
type View = 'overview' | 'maintenance'

function Sparkline({ values, high }: { values: number[], high: boolean }) {
  if (values.length < 2) return <div className="no-trend">暂无趋势数据</div>
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 300},${84 - (value - 45) * 1.55}`).join(' ')
  return <div className="chart-wrap">
    <div className="chart-grid"><span>100</span><span>75</span><span>50</span></div>
    <svg className="sparkline" viewBox="0 0 300 92" preserveAspectRatio="none" aria-label="健康指数历史趋势">
      <line x1="0" y1="10" x2="300" y2="10" /><line x1="0" y1="48" x2="300" y2="48" /><line x1="0" y1="84" x2="300" y2="84" />
      <polyline points={points} className={high ? 'risk-line' : 'normal-line'} />
      <circle cx="300" cy={84 - (values.at(-1)! - 45) * 1.55} r="4" className={high ? 'risk-dot' : 'normal-dot'} />
    </svg>
    <div className="chart-axis"><span>早期</span><span>近期</span></div>
  </div>
}

function StatusBadge({ level }: { level: Turbine['warning_level'] }) {
  return <span className={`status-badge status-${level.toLowerCase()}`}><span className="status-dot" />{warningText[level]}</span>
}

const actionText = {
  CONTINUE_MONITORING: '继续监测',
  SCHEDULE_INSPECTION: '安排现场检查',
  SCHEDULE_MAINTENANCE: '安排维护',
}

const priorityText = { LOW: '低', MEDIUM: '中', HIGH: '高' }

function mapApiPlans(result: ApiMaintenancePlan): MaintenancePlan[] {
  return result.candidates.map(candidate => ({
    id: candidate.action,
    title: actionText[candidate.action],
    timing: result.priority === 'HIGH' ? '优先处理' : '按计划执行',
    action: candidate.explanation,
    risk: priorityText[result.priority],
    downtime: '待现场确认',
    cost: '待评估',
    recommended: candidate.action === result.recommended_action,
    available: candidate.available,
  }))
}

const emptyApiPlan: MaintenancePlan = {
  id: 'none', title: '暂无维护方案', timing: '--', action: '等待后端生成维护决策',
  risk: '--', downtime: '--', cost: '--', available: false,
}

export default function App() {
  const [mode, setMode] = useState<Mode>('demo')
  const [turbines, setTurbines] = useState<Turbine[]>(demoTurbines)
  const [selectedId, setSelectedId] = useState('WT02')
  const [view, setView] = useState<View>('overview')
  const [weatherRestricted, setWeatherRestricted] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState('inspect')
  const [serviced, setServiced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [engineeringView, setEngineeringView] = useState(true)
  const [apiPlan, setApiPlan] = useState<ApiMaintenancePlan | null>(null)
  const [maintenanceRecordId, setMaintenanceRecordId] = useState('')
  const [retests, setRetests] = useState<ApiRetest[]>([])
  const [retestLoading, setRetestLoading] = useState(false)

  const selected = turbines.find(t => t.turbine_id === selectedId) || turbines[0]
  const plans = useMemo(() => mode === 'api' ? (apiPlan ? mapApiPlans(apiPlan) : [emptyApiPlan]) : getDemoPlans(weatherRestricted), [apiPlan, mode, weatherRestricted])
  const plan = plans.find(p => p.id === selectedPlan) || plans[0]
  const highCount = turbines.filter(t => t.has_analysis !== false && t.warning_level === 'HIGH').length
  const retest = retests[0]

  useEffect(() => {
    if (mode === 'demo') {
      setTurbines(demoTurbines); setSelectedId('WT02'); setError(''); setLoading(false); setApiPlan(null)
      setView('overview'); setServiced(false); setMaintenanceRecordId(''); setRetests([])
      return
    }
    let active = true
    setLoading(true); setError('')
    fetchTurbines().then(data => {
      if (!active) return
      setTurbines(data); setSelectedId(data.find(item => item.turbine_id === 'WT02')?.turbine_id || data[0].turbine_id); setView('overview'); setServiced(false); setApiPlan(null); setMaintenanceRecordId(''); setRetests([])
    }).catch(reason => {
      if (active) { setTurbines([]); setError(reason instanceof Error ? reason.message : '接口连接失败') }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [mode])

  const selectTurbine = (id: string) => {
    setSelectedId(id); setView('overview'); setServiced(false); setSelectedPlan('inspect'); setApiPlan(null); setMaintenanceRecordId(''); setRetests([])
  }

  const loadApiPlan = async (restricted: boolean, replan: boolean) => {
    if (!selected) return
    if (selected.has_analysis === false) {
      setError('当前部件暂无 AI 结果，不能生成维护方案。')
      setApiPlan(null)
      return
    }
    try {
      setLoading(true); setError(''); setServiced(false)
      const result = replan && apiPlan
        ? await replanMaintenance(selected.turbine_id, selected.component_id, !restricted, apiPlan.plan_id)
        : await optimizeMaintenance(selected.turbine_id, selected.component_id, !restricted)
      setApiPlan(result)
      setSelectedPlan(result.recommended_action)
    } catch (reason) {
      setApiPlan(null)
      setError(reason instanceof Error ? reason.message : '维护方案接口失败')
    } finally { setLoading(false) }
  }

  const openMaintenance = () => {
    setView('maintenance')
    if (mode === 'api') void loadApiPlan(weatherRestricted, false)
  }

  const toggleWeather = () => {
    const restricted = !weatherRestricted
    setWeatherRestricted(restricted); setSelectedPlan('inspect'); setServiced(false)
    if (mode === 'api') void loadApiPlan(restricted, Boolean(apiPlan))
  }

  const executePlan = async () => {
    if (!selected) return
    if (mode === 'api') {
      if (!apiPlan) { setError('尚未生成可执行的维护方案。'); return }
      try {
        setLoading(true); setError('')
        const record = await executeMaintenance(apiPlan.plan_id)
        setMaintenanceRecordId(record.record_id)
        setRetests([])
        setServiced(true)
        setRetestLoading(true)
        try { setRetests(await fetchRetests(record.record_id)) } catch (reason) {
          const message = reason instanceof Error ? reason.message : '复测结果尚未生成'
          if (!message.includes('404')) setError(message)
        } finally { setRetestLoading(false) }
      } catch (reason) { setError(reason instanceof Error ? reason.message : '维护请求失败') }
      finally { setLoading(false) }
    } else { setServiced(true) }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.2} /></span><span><strong>WindCare</strong><small>风电装备智能运维</small></span></div>
      <nav className="top-nav" aria-label="主导航"><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>风场总览</button><button className={view === 'maintenance' ? 'active' : ''} onClick={openMaintenance} disabled={!selected}>维护决策</button></nav>
      <div className="top-actions"><div className="mode-switch" aria-label="数据模式"><button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>演示</button><button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')}>接口</button></div><button className={`icon-button ${engineeringView ? 'active-icon' : ''}`} title="工程剖切视图" aria-label="工程剖切视图" aria-pressed={engineeringView} onClick={() => setEngineeringView(v => !v)}><Layers3 size={18} /></button><button className="icon-button" title="数据来源说明" aria-label="数据来源说明" onClick={() => setShowSources(true)}><Database size={18} /></button></div>
    </header>

    <main className="workspace">
      <section className="scene-panel" aria-label="风电场三维场景">
        <div className="scene-heading"><div><div className="eyebrow"><MapPin size={13} /> 风电场数字场景 <span className="source-tag">{mode === 'demo' ? '演示数据' : '接口数据'}</span></div><h1>风场运行总览</h1><p>选择风机，查看状态与维护决策</p></div><div className="scene-weather"><CloudSun size={19} /><span>环境状态<small>{weatherRestricted ? '维护窗口受限' : '维护窗口正常'}</small></span></div></div>
        <WindScene turbines={turbines} selectedId={selectedId} onSelect={selectTurbine} serviced={serviced} engineeringView={engineeringView} />
        {engineeringView && selected?.event_id === 51 && <div className="engineering-caption"><span className="engineering-caption-dot" />CARE v6 Event 51 <strong>齿轮箱轴承高亮</strong><small>Digital BIM 外形 · 自建剖切</small></div>}
        <div className="scene-bottom"><div className="scene-legend"><span><i className="legend-normal" />正常</span><span><i className="legend-low" />关注</span><span><i className="legend-high" />高风险</span></div><span className="scene-hint">点击风机查看详情</span></div>
      </section>

      <aside className="inspector" aria-label="风机信息">
        <div className="fleet-summary"><div><span>机组总数</span><strong>{turbines.length.toString().padStart(2, '0')}</strong></div><div><span>高风险</span><strong className="danger-text">{highCount.toString().padStart(2, '0')}</strong></div><div><span>当前选择</span><strong>{selected?.turbine_id || '--'}</strong></div></div>
        {error && <div className="error-banner" role="status"><AlertTriangle size={16} /><span>{error}</span><button title="关闭提示" aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div>}
        {loading && <div className="loading-state" role="status">正在连接接口...</div>}
        {!loading && !selected && <div className="empty-state"><Server size={28} /><h2>等待后端数据</h2><p>请启动 D 的 FastAPI 服务并确认风机接口可用，或切换至演示模式。</p><button onClick={() => setMode('demo')}>返回演示模式</button></div>}
        {selected && <>
          <div className="selector-row"><div><span className="section-kicker">设备状态</span><h2>{selected.turbine_id} <span>{selected.name}</span></h2></div>{selected.has_analysis === false ? <span className="status-badge status-neutral">暂无分析结果</span> : <StatusBadge level={serviced ? 'NORMAL' : selected.warning_level} />}</div>
          <div className="turbine-tabs" role="tablist" aria-label="选择风机">{turbines.map(t => <button role="tab" aria-selected={selectedId === t.turbine_id} className={selectedId === t.turbine_id ? 'selected' : ''} key={t.turbine_id} onClick={() => selectTurbine(t.turbine_id)}>{t.turbine_id}<i className={`level-${t.warning_level.toLowerCase()}`} /></button>)}</div>
          {view === 'overview' ? <>
            <div className="reading-primary"><div className="reading-label"><Gauge size={18} /> 健康指数 <span title="B 的模型输出；演示模式中的数值为模拟数据">ⓘ</span></div><div className="reading-number">{selected.has_analysis === false ? '--' : serviced ? '待复测' : selected.health_index.toFixed(1)}{selected.has_analysis !== false && !serviced && <small>/ 100</small>}</div><div className="meter"><span style={{ width: selected.has_analysis === false || serviced ? '0%' : `${selected.health_index}%` }} className={selected.warning_level === 'HIGH' ? 'meter-risk' : ''} /></div><p>{selected.has_analysis === false ? '后端尚无该部件的 AI 分析结果。' : serviced ? '维护执行已记录，设备健康状态应由复测数据确认。' : selected.warning_level === 'HIGH' ? '状态持续偏离正常区间，建议进入维护评估。' : '当前状态以数据分析结果为准。'}</p></div>
            <div className="metric-grid"><div><span>异常分数</span><strong>{selected.has_analysis === false ? '--' : selected.anomaly_score.toFixed(2)}</strong><small>模型输出</small></div><div><span>风险评分</span><strong>{selected.has_analysis === false ? '--' : selected.failure_risk.toFixed(2)}</strong><small>0-1 指标，非校准概率</small></div><div><span>当前功率</span><strong>{selected.power_kw ? selected.power_kw.toLocaleString() : '--'}<em> kW</em></strong><small>{selected.power_kw ? '运行示例' : '未提供'}</small></div><div><span>风速</span><strong>{selected.wind_ms || '--'}<em> m/s</em></strong><small>{selected.wind_ms ? '运行示例' : '未提供'}</small></div></div>
            <div className="info-section"><div className="section-title"><h3>状态趋势</h3><span>健康指数</span></div><Sparkline values={selected.trend} high={selected.warning_level === 'HIGH'} /></div>
            <div className="component-line"><div className="component-symbol"><Settings2 size={18} /></div><div><strong>{selected.component_label}</strong><span>{selected.component_id}{selected.event_id ? ` · CARE Event ${selected.event_id}` : ''}{selected.mapping_status === 'UNVERIFIED' ? ' · 映射待核验' : ''}</span></div><ChevronDown size={17} /></div>
            <button className="primary-action" onClick={openMaintenance}><Wrench size={17} /> 查看维护方案 <ArrowRight size={17} /></button>
          </> : <>
            <div className="decision-intro"><div className="decision-icon"><Wrench size={20} /></div><div><h3>维护决策</h3><p>{selected.turbine_id} · {selected.component_label}</p></div></div>
            <div className="constraint-row"><div><CloudSun size={17} /><span>天气窗口限制<small>调整条件，比较方案变化</small></span></div><button className={`toggle ${weatherRestricted ? 'on' : ''}`} role="switch" aria-checked={weatherRestricted} aria-label="天气窗口限制" onClick={toggleWeather}><span /></button></div>
            <div className="section-title plan-title"><h3>可选方案</h3><span>{mode === 'demo' ? '规则演示 / 假设参数' : apiPlan ? `后端决策 · ${apiPlan.priority}` : '等待后端决策'}</span></div>
            <div className="plans">{plans.map((p: MaintenancePlan) => <button key={p.id} disabled={p.available === false || (mode === 'api' && !p.recommended)} className={`plan-option ${plan.id === p.id ? 'selected' : ''}`} onClick={() => { setSelectedPlan(p.id); setServiced(false) }}><span className="plan-radio">{plan.id === p.id && <span />}</span><span className="plan-copy"><strong>{p.title}{p.recommended && <em>建议</em>}</strong><small><Clock3 size={13} /> {p.timing} · 风险 {p.risk}</small><span>{p.action}</span></span></button>)}</div>
            <div className="plan-facts"><div><span>预计停机</span><strong>{plan.downtime}</strong></div><div><span>资源成本</span><strong>{plan.cost}</strong></div><div><span>风险水平</span><strong>{plan.risk}</strong></div></div>
            {serviced ? <div className="success-message"><Check size={17} /><div><strong>{mode === 'api' ? '维护执行记录已保存' : '演示维护已记录'}</strong><span>状态改善不自动推断，需以后端复测结果确认。</span></div></div> : <button className="primary-action" disabled={loading || (mode === 'api' && !apiPlan)} onClick={executePlan}><Check size={17} /> {mode === 'api' ? '记录维护执行' : '模拟执行方案'} <ArrowRight size={17} /></button>}
            {mode === 'api' && (maintenanceRecordId || retestLoading) && <div className="retest-card"><div className="retest-head"><span>维护后复测</span><em>{retest?.data_origin || (retestLoading ? '查询中' : '待复测')}</em></div>{retest ? <><div className="retest-values"><div><span>健康指数</span><strong>{retest.health_index.toFixed(1)}</strong></div><div><span>相对风险</span><strong>{retest.failure_risk.toFixed(3)}</strong></div></div><p>{retest.conclusion}</p><small>复测来源：{retest.data_origin} · 不代表真实维护效果</small></> : <p>{retestLoading ? '正在查询复测记录...' : '待复测。当前没有后端复测结果。'}</p>}</div>}
            <button className="secondary-action" onClick={() => { setView('overview'); setServiced(false) }}><RotateCcw size={16} /> 返回设备状态</button>
          </>}
          <div className="data-footnote"><span>{mode === 'demo' ? 'SIMULATED · 演示样例' : `${selected.source} · API`}</span><span>{selected.model_version} · {selected.updated_at}</span></div>
        </>}
      </aside>
    </main>
    {showSources && <div className="modal-backdrop" onClick={() => setShowSources(false)}><section className="source-modal" role="dialog" aria-modal="true" aria-label="数据来源说明" onClick={e => e.stopPropagation()}><div className="modal-head"><div><Database size={19} /><h2>数据来源说明</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setShowSources(false)}><X size={18} /></button></div><p>当前演示模式中的风机数据、健康指数、风险评分、趋势和维护参数均为模拟样例，仅用于验证 C 模块的交互流程，不代表 CARE 数据集实测或 AI 模型结果。</p><p>当前工程剖切以 Wind Farm A 的 CARE v6 Event 51（Gearbox bearings damaged）为主案例。三维外形已经接入 Digital BIM Solutions 的 Wind Turbine（CC BY 4.0）；内部工程对象由项目组建立并命名为可绑定节点。</p><p>接口模式读取 D 的风机与组件状态，并通过 <code>/api/maintenance/optimize</code>、<code>/api/maintenance/replan</code> 和 <code>/api/maintenance/execute</code> 完成维护决策闭环。映射状态为 <code>UNVERIFIED</code> 时保持中性部件名称。</p><p>风险评分默认作为 0-1 指标显示；若未完成概率校准，不称为“故障概率”。执行维护后需要后端提供复测结果，前端才会更新真实健康状态。</p><button className="modal-done" onClick={() => setShowSources(false)}>了解</button></section></div>}
  </div>
}
