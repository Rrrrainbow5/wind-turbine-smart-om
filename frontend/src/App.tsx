import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Activity, AlertTriangle, Anchor, ArrowRight, Check, ChevronDown, ClipboardList, Clock3, CloudSun, Database, Eye, Gauge, History, Layers3, MapPin, PackageCheck, Radio, RotateCcw, Search, Server, Settings2, ShieldCheck, UserRound, Wrench, X } from 'lucide-react'
import WindScene from './WindScene'
import { executeMaintenance, fetchRetests, fetchTurbines, optimizeMaintenance, replanMaintenance, type ApiMaintenancePlan, type ApiRetest } from './api'
import { demoTurbines, getDemoPlans, warningText, wt02FaultEvents, type MaintenancePlan, type Turbine } from './data'

type Mode = 'demo' | 'api'
type View = 'overview' | 'maintenance'

function Sparkline({ values, high }: { values: number[], high: boolean }) {
  if (values.length < 2) return <div className="no-trend">暂无趋势数据</div>
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = Math.max(maximum - minimum, 1)
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 300},${78 - ((value - minimum) / span) * 62}`).join(' ')
  return <div className="chart-wrap">
    <div className="chart-grid"><span>{maximum.toFixed(1)}</span><span>{((maximum + minimum) / 2).toFixed(1)}</span><span>{minimum.toFixed(1)}</span></div>
    <svg className="sparkline" viewBox="0 0 300 92" preserveAspectRatio="none" aria-label="健康指数历史趋势">
      <line x1="0" y1="10" x2="300" y2="10" /><line x1="0" y1="48" x2="300" y2="48" /><line x1="0" y1="84" x2="300" y2="84" />
      <polyline points={points} className={high ? 'risk-line' : 'normal-line'} />
      <circle cx="300" cy={78 - ((values.at(-1)! - minimum) / span) * 62} r="4" className={high ? 'risk-dot' : 'normal-dot'} />
    </svg>
    <div className="chart-axis"><span>早期</span><span>近期</span></div>
  </div>
}

function StatusBadge({ level }: { level: Turbine['warning_level'] }) {
  return <span className={`status-badge status-${level.toLowerCase()}`}><span className="status-dot" />{warningText[level]}</span>
}

type DiagnosticParams = { rpm: number; oil: number; wind: number; noise: number; power: number }
const defaultDiagnosticParams: DiagnosticParams = { rpm: 12, oil: 54, wind: 8.3, noise: 68, power: 1580 }
const eventDiagnosticPresets: Record<string, DiagnosticParams> = {
  'B-53': { rpm: 10.8, oil: 58, wind: 8.3, noise: 74, power: 1580 },
  'A-51': { rpm: 10.2, oil: 72, wind: 8.3, noise: 86, power: 1480 },
  'A-0': { rpm: 11.4, oil: 64, wind: 8.3, noise: 81, power: 1380 },
  'C-67': { rpm: 12.1, oil: 55, wind: 8.3, noise: 70, power: 2250 },
  'C-81': { rpm: 8.1, oil: 52, wind: 8.3, noise: 82, power: 920 },
}
const diagnosticFields: Array<{ key: keyof DiagnosticParams; label: string; min: number; max: number; step: number; unit: string; normal: [number, number] }> = [
  { key: 'rpm', label: '叶片转速', min: 0, max: 20, step: .1, unit: 'rpm', normal: [8, 15] },
  { key: 'oil', label: '齿轮箱油温', min: 20, max: 100, step: 1, unit: '°C', normal: [35, 65] },
  { key: 'wind', label: '风速', min: 0, max: 25, step: .1, unit: 'm/s', normal: [5, 13] },
  { key: 'noise', label: '噪声分贝', min: 40, max: 110, step: 1, unit: 'dB', normal: [55, 78] },
  { key: 'power', label: '输出功率', min: 0, max: 2500, step: 10, unit: 'kW', normal: [1100, 2100] },
]

function diagnosticInference(params: DiagnosticParams) {
  const scores = {
    '齿轮箱': Math.max(0, (params.oil - 65) / 35) * .72 + Math.max(0, (params.noise - 78) / 32) * .28,
    '主轴/轴承': Math.max(0, (12 - params.rpm) / 12) * .35 + Math.max(0, (params.noise - 78) / 32) * .35 + Math.max(0, (45 - params.wind) / 45) * .3,
    '发电机': Math.max(0, (params.power - 2100) / 400) * .55 + Math.max(0, (params.oil - 65) / 35) * .45,
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const risk = Math.min(.99, .08 + ranked[0][1] * .9)
  const level: Turbine['warning_level'] = risk >= .72 ? 'HIGH' : risk >= .42 ? 'MEDIUM' : risk >= .2 ? 'LOW' : 'NORMAL'
  return { location: ranked[0][0], risk, level, scores }
}

function DiagnosticDiagram({ location, risk }: { location: string; risk: number }) {
  const spots = [{ name: '叶轮', x: 70, y: 92 }, { name: '主轴/轴承', x: 185, y: 92 }, { name: '齿轮箱', x: 285, y: 92 }, { name: '发电机', x: 400, y: 92 }]
  return <div className="diagnostic-diagram" title={`${location} · 置信度 ${(risk * 100).toFixed(0)}%`}><svg viewBox="0 0 470 150" role="img" aria-label={`二维风机示意图，当前故障位置 ${location}`}><path className="diagram-tower" d="M225 105 L245 105 L255 145 L215 145 Z" /><path className="diagram-nacelle" d="M145 72 H390 Q410 72 410 91 H145 Z" /><path className="diagram-blade" d="M155 82 L72 43 L78 37 L170 72 Z" /><path className="diagram-blade" d="M155 82 L68 119 L72 126 L170 91 Z" /><line className="diagram-shaft" x1="155" y1="82" x2="400" y2="82" />{spots.map(spot => <g key={spot.name} className={spot.name === location || (location === '主轴/轴承' && spot.name === '主轴/轴承') ? 'fault-spot active' : 'fault-spot'}><circle cx={spot.x} cy={spot.y} r="7" /><text x={spot.x} y={spot.y - 13}>{spot.name}</text></g>)}</svg><div className="diagram-tooltip">{location} · 置信度 {(risk * 100).toFixed(0)}%</div></div>
}

function ConfidenceBars({ scores }: { scores: Record<string, number> }) {
  return <div className="confidence-bars">{Object.entries(scores).map(([label, value]) => <div key={label} className="confidence-row"><span>{label}</span><div><i style={{ width: `${Math.max(4, value * 100)}%` }} /></div><strong>{(value * 100).toFixed(0)}%</strong></div>)}</div>
}

function diagnosticCategory(location: string): Turbine['fault_category'] {
  return location === '齿轮箱' ? 'GEARBOX' : location === '发电机' ? 'GENERATOR' : location === '主轴/轴承' ? 'BEARING' : 'DRIVETRAIN'
}

function sliderTint(field: typeof diagnosticFields[number], value: number) {
  const [low, high] = field.normal
  if (value >= low && value <= high) return '#31b987'
  const distance = value < low ? (low - value) / Math.max(low - field.min, 1) : (value - high) / Math.max(field.max - high, 1)
  return distance > .55 ? '#d4473d' : '#e2ad3e'
}

function playTone(frequency: number, duration: number, delay = 0, type: OscillatorType = 'sine') {
  window.setTimeout(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = type; oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(.12, context.currentTime + .02)
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + duration + .03)
      window.setTimeout(() => void context.close(), (duration + .1) * 1000)
    } catch { /* Audio is optional in browsers and may be blocked. */ }
  }, delay)
}

function playAlertSound() { playTone(660, .16, 0, 'square'); playTone(520, .18, 220, 'square') }
function playConfirmSound() { playTone(523, .14); playTone(659, .2, 150); playTone(784, .25, 300) }

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
  const [guideModal, setGuideModal] = useState<number | null>(null)
  const [guideSliderChanged, setGuideSliderChanged] = useState(false)
  const [engineeringView, setEngineeringView] = useState(false)
  const [apiPlan, setApiPlan] = useState<ApiMaintenancePlan | null>(null)
  const [maintenanceRecordId, setMaintenanceRecordId] = useState('')
  const [retests, setRetests] = useState<ApiRetest[]>([])
  const [retestLoading, setRetestLoading] = useState(false)
  const [faultEventId, setFaultEventId] = useState('B-53')
  const [personnelAvailable, setPersonnelAvailable] = useState(true)
  const [spareAvailable, setSpareAvailable] = useState(true)
  const [shutdownAllowed, setShutdownAllowed] = useState(true)
  const [liftingAvailable, setLiftingAvailable] = useState(false)
  const [evidencePanel, setEvidencePanel] = useState<'evidence' | 'trend' | 'history' | 'context' | 'review' | null>(null)
  const [decisionAction, setDecisionAction] = useState('SCHEDULE_INSPECTION')
  const [activityLog, setActivityLog] = useState<string[]>([])
  const [diagnosticParams, setDiagnosticParams] = useState<DiagnosticParams>(defaultDiagnosticParams)
  const [diagnosticHistory, setDiagnosticHistory] = useState<Array<{ at: string; location: string; risk: number }>>([])
  const diagnostic = useMemo(() => diagnosticInference(diagnosticParams), [diagnosticParams])

  const selectedBase = turbines.find(t => t.turbine_id === selectedId) || turbines[0]
  const selectedFault = wt02FaultEvents.find(event => event.id === faultEventId) || wt02FaultEvents[0]
  const eventRisk: Record<string, [number, number, Turbine['warning_level']]> = { 'B-53': [.76, 63.2, 'HIGH'], 'A-51': [.82, 58.4, 'HIGH'], 'A-0': [.61, 69.8, 'MEDIUM'], 'C-67': [.48, 76.2, 'MEDIUM'], 'C-81': [.71, 66.5, 'HIGH'] }
  const [eventFailureRisk, eventHealth, eventWarning] = eventRisk[faultEventId] || eventRisk['B-53']
  const selected = selectedBase?.turbine_id === 'WT02' ? { ...selectedBase, failure_risk: eventFailureRisk, health_index: eventHealth, warning_level: eventWarning, anomaly_score: eventFailureRisk, event_id: Number(selectedFault.id.split('-')[1]), event_name: selectedFault.name, event_description: selectedFault.description, component_label: selectedFault.component, fault_category: selectedFault.category } : selectedBase
  const plans = useMemo(() => mode === 'api' ? (apiPlan ? mapApiPlans(apiPlan) : [emptyApiPlan]) : getDemoPlans(weatherRestricted), [apiPlan, mode, weatherRestricted])
  const plan = plans.find(p => p.id === selectedPlan) || plans[0]
  const highCount = turbines.filter(t => t.has_analysis !== false && t.warning_level === 'HIGH').length
  const retest = retests[0]

  const updateDiagnosticParam = (key: keyof DiagnosticParams, value: number) => {
    const next = { ...diagnosticParams, [key]: value }
    setDiagnosticParams(next)
    if (guideModal === null && guideSliderChanged === false) setGuideSliderChanged(true)
    if (diagnosticInference(next).risk >= .72 && diagnostic.risk < .72) playAlertSound()
    setDiagnosticHistory(history => [{ at: new Date().toLocaleTimeString(), location: diagnostic.location, risk: diagnostic.risk }, ...history].slice(0, 6))
  }

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
    if (guideModal === 1) setGuideModal(2)
  }

  const logAction = (message: string) => setActivityLog(log => [`${new Date().toLocaleTimeString()} · ${message}`, ...log].slice(0, 8))

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
        ? await replanMaintenance(selected.turbine_id, selected.component_id, !restricted, apiPlan.plan_id, personnelAvailable)
        : await optimizeMaintenance(selected.turbine_id, selected.component_id, !restricted, personnelAvailable)
      setApiPlan(result)
      setSelectedPlan(result.recommended_action)
      logAction(replan ? '已根据工程条件重新规划维护方案' : '已生成维护方案')
    } catch (reason) {
      setApiPlan(null)
      setError(reason instanceof Error ? reason.message : '维护方案接口失败')
    } finally { setLoading(false) }
  }

  const openMaintenance = () => {
    setView('maintenance')
    logAction('进入维护决策工作台')
    if (mode === 'api') void loadApiPlan(weatherRestricted, false)
  }

  const toggleWeather = () => {
    const restricted = !weatherRestricted
    setWeatherRestricted(restricted); setSelectedPlan('inspect'); setServiced(false)
    logAction(restricted ? '天气窗口关闭：现场维护暂缓' : '天气窗口恢复：允许重新评估')
    if (mode === 'api') void loadApiPlan(restricted, Boolean(apiPlan))
  }

  const chooseAction = (action: string) => {
    setDecisionAction(action)
    setSelectedPlan(action === 'CONTINUE_MONITORING' ? 'monitor' : action === 'SCHEDULE_MAINTENANCE' ? 'service' : 'inspect')
    logAction(`选择策略：${action === 'CONTINUE_MONITORING' ? '继续监测' : action === 'SCHEDULE_MAINTENANCE' ? '预防性维护' : '现场检查'}`)
  }

  const openEvidence = (panel: typeof evidencePanel, label: string) => {
    setEvidencePanel(panel)
    logAction(`查看${label}`)
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
        playConfirmSound()
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
      <button className="guide-launcher" onClick={() => { setGuideSliderChanged(false); setGuideModal(1) }}><Activity size={15} />开始引导</button>
      {guideModal === 2 && <div className="guide-spotlight-ai" aria-hidden="true" />}
      {guideModal === 2 && <div className="guide-step2-card" role="dialog"><strong>第 2 步：调节风险参数</strong><p>请拖动左侧任意一条数据滑块，观察右侧风险评分和故障位置变化。</p><button onClick={() => setGuideModal(null)}>知道了，开始操作</button></div>}
      {guideModal !== null && <div className="guide-coach" role="dialog" aria-live="polite"><strong>{guideModal === 1 ? '第 1 步：选择风机' : guideModal === 2 ? '第 2 步：调节风险参数' : '第 3 步：生成维护方案'}</strong><p>{guideModal === 1 ? '请点击下方任意一个风机编号，查看它的状态。' : guideModal === 2 ? '请先关闭提示，再拖动传感器滑块，让风险评分发生变化。' : '请点击“查看维护方案”，进入维护决策页面。'}</p><button onClick={() => setGuideModal(null)}>知道了，开始操作</button></div>}
      {guideSliderChanged && guideModal === null && <button className="guide-complete" onClick={() => { setGuideSliderChanged(false); setGuideModal(3) }}>设置完成，下一步</button>}
      <section className="scene-panel" aria-label="风电场三维场景">
        <div className="scene-heading"><div><div className="eyebrow"><MapPin size={13} /> 风电场数字场景 <span className="source-tag">{mode === 'demo' ? '演示数据' : '接口数据'}</span></div><h1>风场运行总览</h1><p>选择风机，查看状态与维护决策</p></div><div className="scene-weather"><CloudSun size={19} /><span>环境状态<small>{weatherRestricted ? '维护窗口受限' : '维护窗口正常'}</small></span></div></div>
        <WindScene turbines={turbines.map(t => t.turbine_id === selected?.turbine_id ? selected : t)} selectedId={selectedId} onSelect={selectTurbine} serviced={serviced} engineeringView={engineeringView} diagnosticFaultCategory={diagnosticCategory(diagnostic.location)} onOpenEngineering={() => setEngineeringView(true)} />
        {engineeringView && selected?.event_id && <div className="engineering-caption"><span className="engineering-caption-dot" />CARE v6 · {selected.event_name} <strong>{selected.component_label}</strong><small>项目CAD整机 · 映射状态 {selected.mapping_status || 'UNVERIFIED'}</small></div>}
        <div className="scene-bottom"><div className="scene-legend"><span><i className="legend-normal" />正常</span><span><i className="legend-low" />关注</span><span><i className="legend-high" />高风险</span></div><span className="scene-hint">海上风场 · 点击风机定位 · 再点机舱查看内部部件</span></div>
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
            <div className="metric-grid"><div><span>异常分数</span><strong>{selected.has_analysis === false ? '--' : selected.anomaly_score.toFixed(2)}</strong><small>模型输出</small></div><div><span>风险评分</span><strong>{selected.has_analysis === false ? '--' : selected.failure_risk.toFixed(2)}</strong><small>0-1 指标，非校准概率</small></div><div><span>当前功率</span><strong>{selected.power_kw !== 0 ? selected.power_kw.toLocaleString() : '--'}<em> kW</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.power_kw !== 0 ? '运行示例' : '未提供'}</small></div><div><span>风速</span><strong>{selected.wind_ms !== 0 ? selected.wind_ms : '--'}<em> m/s</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.wind_ms !== 0 ? '运行示例' : '未提供'}</small></div></div>
            <div className="info-section"><div className="section-title"><h3>{selected.trend_label || '传感器趋势'}</h3><span>{selected.trend_unit || 'CARE telemetry'}</span></div><Sparkline values={selected.trend} high={selected.warning_level === 'HIGH'} /></div>
          <section className="ai-workbench" aria-label="实时AI故障检测"><div className="workbench-title"><h3><Activity size={15} /> 实时 AI 故障检测</h3><span className="simulated-tag">SIMULATED · 拖动即推理</span></div><div className="diagnostic-layout"><div className="diagnostic-controls">{diagnosticFields.map(field => <label className="diagnostic-slider" key={field.key}><span><b>{field.label}</b><em>{diagnosticParams[field.key].toFixed(field.step < 1 ? 1 : 0)} {field.unit}</em></span><input style={{ '--slider-color': sliderTint(field, diagnosticParams[field.key]) } as CSSProperties} type="range" min={field.min} max={field.max} step={field.step} value={diagnosticParams[field.key]} onChange={event => updateDiagnosticParam(field.key, Number(event.target.value))} /><small>安全范围 {field.normal[0]}–{field.normal[1]} {field.unit}</small></label>)}<button className="reset-diagnostic" onClick={() => setDiagnosticParams(defaultDiagnosticParams)}><RotateCcw size={14} /> 一键重置参数</button></div><div className="diagnostic-result"><div className="ai-status-line"><span className={`ai-pulse ${diagnostic.level.toLowerCase()}`} />AI 推理完成 <StatusBadge level={diagnostic.level} /></div><DiagnosticDiagram location={diagnostic.location} risk={diagnostic.risk} /><div className="diagnostic-summary"><strong>{diagnostic.location}</strong><span>置信度 {(diagnostic.risk * 100).toFixed(0)}% · 风险评分 {diagnostic.risk.toFixed(2)}</span></div><ConfidenceBars scores={diagnostic.scores} /></div></div><div className="diagnostic-history"><div><strong><History size={14} /> 最近检测</strong><span>{diagnosticHistory.length ? `${diagnosticHistory.length} 条` : '暂无记录'}</span></div>{diagnosticHistory.slice(0, 3).map(item => <span key={`${item.at}-${item.risk}`}>{item.at} · {item.location} · {(item.risk * 100).toFixed(0)}%</span>)}</div></section>
          <div className="event-selector"><label htmlFor="wt02-event">WT02 故障案例基线</label><select id="wt02-event" value={faultEventId} onChange={event => { const id = event.target.value; setFaultEventId(id); setDiagnosticParams(eventDiagnosticPresets[id] || defaultDiagnosticParams); logAction(`载入故障案例基线：${id}`) }}>{wt02FaultEvents.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select><small>预设案例仅用于载入初始传感器状态；拖动下方滑块后由实时演示推理重新计算。</small></div>
          <div className="component-line"><div className="component-symbol"><Settings2 size={18} /></div><div><strong>{selected.component_label}</strong><span>{selected.component_id} · {selectedFault.name} · 映射待核验</span></div><ChevronDown size={17} /></div>
            <button className="primary-action" onClick={openMaintenance}><Wrench size={17} /> 查看维护方案 <ArrowRight size={17} /></button>
          </> : <>
            <div className="decision-intro"><div className="decision-icon"><Wrench size={20} /></div><div><h3>维护决策</h3><p>{selected.turbine_id} · {selected.component_label}</p><small>先读风险信号，再核对窗口与人员，最后记录执行和复测</small></div></div>
            <div className="workbench-block"><div className="workbench-title"><h3>异常研判</h3><span>点击获取证据</span></div><div className="evidence-grid">
              <button onClick={() => openEvidence('evidence', '异常证据')}><Search size={15} />异常证据</button>
              <button onClick={() => openEvidence('trend', '传感器趋势')}><Activity size={15} />传感器趋势</button>
              <button onClick={() => openEvidence('history', '历史记录')}><History size={15} />历史记录</button>
              <button onClick={() => openEvidence('context', 'Event 51 说明')}><ClipboardList size={15} />Event 51 说明</button>
              <button onClick={() => openEvidence('review', '人工复核')}><ShieldCheck size={15} />请求人工复核</button>
            </div></div>
            <div className="evidence-panel">{evidencePanel === 'evidence' && <><strong>异常证据 · SIMULATED/DERIVED</strong><p>当前部件风险评分 {selected.failure_risk.toFixed(3)}，健康指数 {selected.health_index.toFixed(1)}。该评分用于相对排序，不是校准故障概率。</p></>}{evidencePanel === 'trend' && <><strong>{selected.trend_label || '传感器趋势'}</strong><Sparkline values={selected.trend} high={selected.warning_level === 'HIGH'} /><p>趋势来自 CARE telemetry；接口模式以 D 返回结果为准。</p></>}{evidencePanel === 'history' && <><strong>维护历史</strong><p>暂无可核验的历史维护记录。执行后将保留 plan_id、record_id 和复测状态。</p></>}{evidencePanel === 'context' && <><strong>CARE Version 6 · Event {selected.event_id || 51}</strong><p>当前场景为海上风场演示。部件映射状态为 {selected.mapping_status || 'UNVERIFIED'}，保持中性名称。</p></>}{evidencePanel === 'review' && <><strong>人工复核请求已记录 · SIMULATED</strong><p>请工程人员确认数据来源、部件映射和维护窗口；系统不会自动把复核视为故障确认。</p></>}</div>
            <div className="workbench-block"><div className="workbench-title"><h3>工程资源与约束</h3><span>改变条件后重新生成方案</span></div><div className="resource-grid">
              <button className={personnelAvailable ? 'resource-on' : ''} onClick={() => { setPersonnelAvailable(v => !v); logAction(`维护人员${personnelAvailable ? '不可用' : '可用'}`) }}><UserRound size={15} />人员 {personnelAvailable ? '可用' : '不可用'}</button>
              <button className={spareAvailable ? 'resource-on' : ''} onClick={() => { setSpareAvailable(v => !v); logAction(`备件${spareAvailable ? '不可用' : '可用'}`) }}><PackageCheck size={15} />备件 {spareAvailable ? '可用' : '不可用'}</button>
              <button className={!weatherRestricted ? 'resource-on' : ''} onClick={toggleWeather}><CloudSun size={15} />天气窗口 {!weatherRestricted ? '可用' : '关闭'}</button>
              <button className={shutdownAllowed ? 'resource-on' : ''} onClick={() => { setShutdownAllowed(v => !v); logAction(`停机许可${shutdownAllowed ? '关闭' : '开启'}`) }}><Radio size={15} />允许停机 {shutdownAllowed ? '是' : '否'}</button>
              <button className={liftingAvailable ? 'resource-on' : ''} onClick={() => { setLiftingAvailable(v => !v); logAction(`吊装资源${liftingAvailable ? '不可用' : '可用'}`) }}><Anchor size={15} />吊装 {liftingAvailable ? '可用' : '不可用'}</button>
            </div></div>
            <div className="workbench-block"><div className="workbench-title"><h3>维护策略</h3><span>选择后生成决策</span></div><div className="strategy-grid">
              <button className={decisionAction === 'CONTINUE_MONITORING' ? 'selected' : ''} onClick={() => chooseAction('CONTINUE_MONITORING')}><Eye size={15} />继续监测</button>
              <button className={decisionAction === 'SCHEDULE_INSPECTION' ? 'selected' : ''} onClick={() => chooseAction('SCHEDULE_INSPECTION')}><Search size={15} />现场检查</button>
              <button className={decisionAction === 'SCHEDULE_MAINTENANCE' ? 'selected' : ''} disabled={!spareAvailable || !shutdownAllowed || weatherRestricted} onClick={() => chooseAction('SCHEDULE_MAINTENANCE')}><Wrench size={15} />预防性维护</button>
            </div></div>
            <div className="constraint-row"><div><CloudSun size={17} /><span>天气窗口状态<small>{weatherRestricted ? '下一可用窗口再安排维护' : '当前窗口可用于评估'}</small></span></div><button className={`toggle ${weatherRestricted ? 'on' : ''}`} role="switch" aria-checked={weatherRestricted} aria-label="天气窗口限制" onClick={toggleWeather}><span /></button></div>
            <div className="section-title plan-title"><h3>可选方案</h3><span>{mode === 'demo' ? '规则演示 / 假设参数' : apiPlan ? `后端决策 · ${apiPlan.priority}` : '等待后端决策'}</span></div>
            <div className="plans">{plans.map((p: MaintenancePlan, index) => <details key={p.id} className={`plan-option ${plan.id === p.id ? 'selected' : ''}`} open={plan.id === p.id}><summary onClick={() => { setSelectedPlan(p.id); setServiced(false) }}><span className="plan-radio">{plan.id === p.id && <span />}</span><span className="plan-copy"><strong>步骤 {index + 1} · {p.title}{p.recommended && <em>建议</em>}</strong><small><Clock3 size={13} /> {p.timing} · 风险 {p.risk}</small></span><ChevronDown size={15} /></summary><div className="plan-details"><p>{p.action}</p><small><ShieldCheck size={13} /> 安全提示：执行前确认人员、备件、天气窗口与停机许可。</small></div></details>)}</div>
            <div className="plan-facts"><div><span>预计停机</span><strong>{plan.downtime}</strong></div><div><span>资源成本</span><strong>{plan.cost}</strong></div><div><span>风险水平</span><strong>{plan.risk}</strong></div></div>
            {serviced ? <div className="success-message"><Check size={17} /><div><strong>{mode === 'api' ? '维护执行记录已保存' : '演示维护已记录'}</strong><span>状态改善不自动推断，需以后端复测结果确认。</span></div></div> : <button className="primary-action" disabled={loading || !personnelAvailable || (decisionAction === 'SCHEDULE_MAINTENANCE' && (!spareAvailable || !shutdownAllowed || weatherRestricted)) || (mode === 'api' && !apiPlan)} onClick={executePlan}><Check size={17} /> {mode === 'api' ? '记录维护执行' : '模拟执行方案'} <ArrowRight size={17} /></button>}
            <div className="log-panel"><div className="workbench-title"><h3>操作日志</h3><span>{activityLog.length} 条</span></div>{activityLog.length ? activityLog.map((item, i) => <div key={`${item}-${i}`}><Clock3 size={12} />{item}</div>) : <p>尚未进行工程操作</p>}</div>
            {mode === 'api' && (maintenanceRecordId || retestLoading) && <div className="retest-card"><div className="retest-head"><span>维护后复测</span><em>{retest?.data_origin || (retestLoading ? '查询中' : '待复测')}</em></div>{retest ? <><div className="retest-values"><div><span>健康指数</span><strong>{retest.health_index.toFixed(1)}</strong></div><div><span>相对风险</span><strong>{retest.failure_risk.toFixed(3)}</strong></div></div><p>{retest.conclusion}</p><small>复测来源：{retest.data_origin} · 不代表真实维护效果</small></> : <p>{retestLoading ? '正在查询复测记录...' : '待复测。当前没有后端复测结果。'}</p>}</div>}
            <button className="secondary-action" onClick={() => { setView('overview'); setServiced(false) }}><RotateCcw size={16} /> 返回设备状态</button>
          </>}
          <div className="data-footnote"><span>{mode === 'demo' ? 'SIMULATED · 演示样例' : `${selected.source} · API`}</span><span>{selected.model_version} · {selected.updated_at}</span></div>
        </>}
      </aside>
    </main>
    {showSources && <div className="modal-backdrop" onClick={() => setShowSources(false)}><section className="source-modal" role="dialog" aria-modal="true" aria-label="数据来源说明" onClick={e => e.stopPropagation()}><div className="modal-head"><div><Database size={19} /><h2>数据来源说明</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setShowSources(false)}><X size={18} /></button></div><p>当前演示模式中的风机数据、健康指数、风险评分、趋势和维护参数均为模拟样例，仅用于验证 C 模块的交互流程，不代表 CARE 数据集实测或 AI 模型结果。</p><p>八台演示风机均使用项目提供的 SolidWorks/STEP 工程模型转换版本。叶片、轮毂、塔筒、机舱、主轴、齿轮、轴承和发电机均绑定到模型中的CAD零件节点，不再使用旧外形模型或程序化内部零件作为正式显示对象。</p><p>接口模式读取 D 的风机与组件状态，并通过 <code>/api/maintenance/optimize</code>、<code>/api/maintenance/replan</code> 和 <code>/api/maintenance/execute</code> 完成维护决策闭环。映射状态为 <code>UNVERIFIED</code> 时保持中性部件名称。</p><p>风险评分默认作为 0-1 指标显示；若未完成概率校准，不称为“故障概率”。执行维护后需要后端提供复测结果，前端才会更新真实健康状态。</p><button className="modal-done" onClick={() => setShowSources(false)}>了解</button></section></div>}
  </div>
}

