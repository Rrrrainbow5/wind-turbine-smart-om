import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Activity, AlertTriangle, Anchor, ArrowRight, Check, ChevronDown, ClipboardList, Clock3, CloudSun, Database, Gauge, History, Layers3, MapPin, PackageCheck, Radio, RotateCcw, Search, Server, Settings2, ShieldCheck, UserRound, Wrench, X } from 'lucide-react'
import WindScene from './WindScene'
import { executeMaintenance, fetchRetests, fetchTurbines, optimizeMaintenance, replanMaintenance, type ApiMaintenancePlan, type ApiRetest } from './api'
import { demoTurbines, getDemoPlans, warningText, wt02FaultEvents, type MaintenancePlan, type Turbine } from './data'

type Mode = 'demo' | 'api'
type View = 'overview' | 'maintenance'
type RetestPhase = 'idle' | 'executing' | 'retesting' | 'result'
type RetestSnapshot = { location: string; confidence: number; risk: number; health: number; conclusion: string }
type WeatherState = { wind: number; wave: number; visibility: number }
type GuideState = { active: boolean; step: number }
type TurbinePersistedState = {
  params: DiagnosticParams
  fault: { component: string; confidence: number; risk: number; healthIndex: number } | null
  status: 'normal' | 'fault' | 'monitoring' | 'maintained'
  maintenanceLog: Array<{ time: string; action: string; detail: string; result: string }>
  loaded: boolean
}

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
  const [turbineStates, setTurbineStates] = useState<Record<string, TurbinePersistedState>>({})
  const [turbineStatesHydrated, setTurbineStatesHydrated] = useState(false)
  const [view, setView] = useState<View>('overview')
  const [weatherRestricted, setWeatherRestricted] = useState(false)
  const [weather, setWeather] = useState<WeatherState>({ wind: 9.4, wave: 1.1, visibility: 8.6 })
  const [selectedPlan, setSelectedPlan] = useState('inspect')
  const [serviced, setServiced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSources, setShowSources] = useState(false)
  const [guide, setGuide] = useState<GuideState>({ active: false, step: 0 })
  const [guideInitialTurbine, setGuideInitialTurbine] = useState('')
  const [guideInitialParams, setGuideInitialParams] = useState<DiagnosticParams>(defaultDiagnosticParams)
  const [guideInitialDecision, setGuideInitialDecision] = useState('')
  const [guidePlanClicked, setGuidePlanClicked] = useState(false)
  const [guideBubbleStyle, setGuideBubbleStyle] = useState<CSSProperties>({})
  const [guideMinimized, setGuideMinimized] = useState(false)
  const [engineeringView, setEngineeringView] = useState(false)
  const [apiPlan, setApiPlan] = useState<ApiMaintenancePlan | null>(null)
  const [maintenanceRecordId, setMaintenanceRecordId] = useState('')
  const [retests, setRetests] = useState<ApiRetest[]>([])
  const [retestLoading, setRetestLoading] = useState(false)
  const [retestPhase, setRetestPhase] = useState<RetestPhase>('idle')
  const [retestProgress, setRetestProgress] = useState(0)
  const [beforeRetest, setBeforeRetest] = useState<RetestSnapshot | null>(null)
  const [afterRetest, setAfterRetest] = useState<RetestSnapshot | null>(null)
  const [maintenanceAttempts, setMaintenanceAttempts] = useState(0)
  const [decisionConfirm, setDecisionConfirm] = useState<string | null>(null)
  const [decisionFeedback, setDecisionFeedback] = useState('')
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem('windcare.turbineStates')
      if (saved) setTurbineStates(JSON.parse(saved) as Record<string, TurbinePersistedState>)
    } catch {
      localStorage.removeItem('windcare.turbineStates')
    } finally {
      setTurbineStatesHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (turbineStatesHydrated && Object.keys(turbineStates).length) localStorage.setItem('windcare.turbineStates', JSON.stringify(turbineStates))
  }, [turbineStates, turbineStatesHydrated])

  const planLockReason = (action: string) => {
    if (action === 'CONTINUE_MONITORING') return ''
    if (!personnelAvailable) return action === 'SCHEDULE_INSPECTION' ? '人员不足，无法执行现场检查' : '人员不足，无法执行预防性维护'
    if (weatherRestricted) return action === 'SCHEDULE_INSPECTION' ? '天气窗口关闭，无法执行现场检查' : '天气窗口关闭，无法执行预防性维护'
    if (!shutdownAllowed) return action === 'SCHEDULE_INSPECTION' ? '未获停机许可，无法执行现场检查' : '未获停机许可，无法执行预防性维护'
    if (action === 'SCHEDULE_MAINTENANCE' && !spareAvailable) return '备件不足，无法执行预防性维护'
    if (action === 'SCHEDULE_MAINTENANCE' && !liftingAvailable) return '吊装资源不可用，无法执行预防性维护'
    return ''
  }

  const selectedBase = turbines.find(t => t.turbine_id === selectedId) || turbines[0]
  const selectedFault = wt02FaultEvents.find(event => event.id === faultEventId) || wt02FaultEvents[0]
  const eventRisk: Record<string, [number, number, Turbine['warning_level']]> = { 'B-53': [.76, 63.2, 'HIGH'], 'A-51': [.82, 58.4, 'HIGH'], 'A-0': [.61, 69.8, 'MEDIUM'], 'C-67': [.48, 76.2, 'MEDIUM'], 'C-81': [.71, 66.5, 'HIGH'] }
  const [eventFailureRisk, eventHealth, eventWarning] = eventRisk[faultEventId] || eventRisk['B-53']
  const selectedInitial = selectedBase?.turbine_id === 'WT02' ? { ...selectedBase, failure_risk: eventFailureRisk, health_index: eventHealth, warning_level: eventWarning, anomaly_score: eventFailureRisk, event_id: Number(selectedFault.id.split('-')[1]), event_name: selectedFault.name, event_description: selectedFault.description, component_label: selectedFault.component, fault_category: selectedFault.category } : selectedBase
  const persistedSelected = selectedBase ? turbineStates[selectedBase.turbine_id] : undefined
  const selected = selectedInitial && persistedSelected?.status === 'maintained'
    ? { ...selectedInitial, failure_risk: 0, health_index: 92, warning_level: 'NORMAL' as Turbine['warning_level'], anomaly_score: 0 }
    : selectedInitial && persistedSelected?.fault
      ? { ...selectedInitial, failure_risk: persistedSelected.fault.risk, health_index: persistedSelected.fault.healthIndex, warning_level: persistedSelected.fault.risk >= .72 ? 'HIGH' as Turbine['warning_level'] : persistedSelected.fault.risk >= .42 ? 'MEDIUM' as Turbine['warning_level'] : 'LOW' as Turbine['warning_level'], anomaly_score: persistedSelected.fault.risk, component_label: persistedSelected.fault.component }
      : selectedInitial
  const plans = useMemo(() => {
    const sourcePlans = mode === 'api' ? (apiPlan ? mapApiPlans(apiPlan) : [emptyApiPlan]) : getDemoPlans(weatherRestricted)
    const constrained = sourcePlans.map(item => {
      const action = item.id === 'monitor' ? 'CONTINUE_MONITORING' : item.id === 'inspect' ? 'SCHEDULE_INSPECTION' : item.id === 'service' ? 'SCHEDULE_MAINTENANCE' : item.id
      const locked = Boolean(planLockReason(action))
      const downtime = item.id === 'inspect' && personnelAvailable ? '3 h（单组人员）' : item.downtime
      const cost = item.id === 'service' && spareAvailable ? '¥10.4 万（通用备件）' : item.cost
      return { ...item, available: item.available !== false && !locked, downtime, cost, action: locked ? `${item.action}（${planLockReason(action)}）` : item.action, recommended: !locked && item.recommended }
    })
    const fallback = constrained.find(item => item.available)
    return constrained.map(item => ({ ...item, recommended: item.available && (item.recommended || (!constrained.some(candidate => candidate.recommended) && item.id === fallback?.id)) }))
  }, [apiPlan, mode, weatherRestricted, personnelAvailable, spareAvailable, shutdownAllowed, liftingAvailable])
  const plan = plans.find(p => p.id === selectedPlan) || plans[0]
  const highCount = turbines.filter(t => t.has_analysis !== false && t.warning_level === 'HIGH').length
  const retest = retests[0]
  const activeFault = Boolean(selected && !serviced && selected.has_analysis !== false && (selected.warning_level !== 'NORMAL' || diagnostic.risk >= .2))
  const conditionSummary = `人员${personnelAvailable ? '✓' : '✗'} 备件${spareAvailable ? '✓' : '✗'} 天气${weatherRestricted ? '✗' : '✓'} 停机${shutdownAllowed ? '✓' : '✗'}`
  const weatherClosed = weather.wind > 12 || weather.wave > 2
  const weatherStatus = weatherClosed ? '🔴 关闭' : weather.wind > 10.5 || weather.wave > 1.6 ? '🟡 即将关闭' : '🟢 开放'
  const weatherReason = weather.wave > 2 ? `浪高 ${weather.wave.toFixed(1)}m，超出船舶作业安全范围` : `风速 ${weather.wind.toFixed(1)}m/s，超出船舶作业安全范围`

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWeather(current => ({
        wind: Math.max(7, Math.min(14, current.wind + (Math.random() - .5) * .8)),
        wave: Math.max(.7, Math.min(2.5, current.wave + (Math.random() - .5) * .22)),
        visibility: Math.max(5, Math.min(11, current.visibility + (Math.random() - .5) * .5)),
      }))
    }, 8000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setWeatherRestricted(weatherClosed)
  }, [weatherClosed])
  const createRetestSnapshot = (improved: boolean): RetestSnapshot => {
    const monitoring = selectedPlan === 'monitor' || decisionAction === 'CONTINUE_MONITORING'
    const baseHealth = selected.health_index
    const baseRisk = selected.failure_risk
    const risk = monitoring ? Math.min(.99, Math.max(baseRisk + .25, baseRisk * 1.8)) : improved ? .06 : Math.max(.12, baseRisk - .12)
    const health = monitoring ? Math.max(28, baseHealth - 14.8) : improved ? Math.max(86, Math.min(96, baseHealth + 27)) : Math.min(82, baseHealth + 8)
    return {
      location: monitoring ? selected.component_label : improved ? '无异常' : selected.component_label,
      confidence: monitoring ? Math.min(.99, risk + .08) : improved ? 0 : Math.max(.18, baseRisk - .13),
      risk,
      health,
      conclusion: monitoring ? '故障持续恶化，建议立即安排维护' : improved ? '复测通过，故障特征已消除' : '故障有所缓解但未完全消除',
    }
  }

  const retestPassed = (snapshot: RetestSnapshot) => snapshot.confidence === 0 && snapshot.risk < .1 && snapshot.health > 85

  const updateDiagnosticParam = (key: keyof DiagnosticParams, value: number) => {
    const next = { ...diagnosticParams, [key]: value }
    setDiagnosticParams(next)
    const nextDiagnostic = diagnosticInference(next)
    setTurbineStates(current => {
      const existing = current[selectedId]
      if (!existing) return current
      return { ...current, [selectedId]: { ...existing, params: next, fault: nextDiagnostic.risk >= .2 ? { component: nextDiagnostic.location, confidence: nextDiagnostic.risk, risk: nextDiagnostic.risk, healthIndex: Math.max(35, 100 - nextDiagnostic.risk * 45) } : null, status: nextDiagnostic.risk >= .2 ? 'fault' : 'normal' } }
    })
    if (diagnosticInference(next).risk >= .72 && diagnostic.risk < .72) playAlertSound()
    setDiagnosticHistory(history => [{ at: new Date().toLocaleTimeString(), location: diagnostic.location, risk: diagnostic.risk }, ...history].slice(0, 6))
  }

  useEffect(() => {
    if (mode === 'demo') {
      setTurbines(demoTurbines); setSelectedId('WT02'); setError(''); setLoading(false); setApiPlan(null)
      setTurbineStates(current => {
        const next = { ...current }
        demoTurbines.forEach(turbine => {
          if (!next[turbine.turbine_id]) next[turbine.turbine_id] = { params: defaultDiagnosticParams, fault: turbine.warning_level === 'NORMAL' ? null : { component: turbine.component_label, confidence: turbine.failure_risk, risk: turbine.failure_risk, healthIndex: turbine.health_index }, status: turbine.warning_level === 'NORMAL' ? 'normal' : 'fault', maintenanceLog: [{ time: new Date().toLocaleTimeString(), action: '初始加载', detail: `CARE 数据集案例 ${turbine.turbine_id}`, result: '信息' }], loaded: true }
        })
        return next
      })
      setView('overview'); setServiced(false); setMaintenanceRecordId(''); setRetests([]); setMaintenanceAttempts(0)
      return
    }
    let active = true
    setLoading(true); setError('')
    fetchTurbines().then(data => {
      if (!active) return
      setTurbines(data); setSelectedId(data.find(item => item.turbine_id === 'WT02')?.turbine_id || data[0].turbine_id); setView('overview'); setServiced(false); setApiPlan(null); setMaintenanceRecordId(''); setRetests([]); setMaintenanceAttempts(0)
    }).catch(reason => {
      if (active) { setTurbines([]); setError(reason instanceof Error ? reason.message : '接口连接失败') }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [mode])

  const selectTurbine = (id: string) => {
    const saved = turbineStates[id]
    setSelectedId(id); setView('overview'); setServiced(saved?.status === 'maintained'); setDiagnosticParams(saved?.params || defaultDiagnosticParams); setSelectedPlan('inspect'); setApiPlan(null); setMaintenanceRecordId(''); setRetests([]); setMaintenanceAttempts(0)
  }

  const logAction = (message: string) => {
    const time = new Date().toLocaleTimeString()
    setActivityLog(log => [`${time} · ${message}`, ...log].slice(0, 8))
    setTurbineStates(current => {
      const existing = current[selectedId]
      if (!existing) return current
      const action = message.includes('继续监测') ? '继续监测' : message.includes('现场检查') ? '现场检查' : message.includes('预防性维护') ? '预防性维护' : message.includes('复测') ? '复测' : message.includes('修复') ? '修复确认' : message.includes('参数') ? '手动调参' : '信息'
      const result = message.includes('未通过') || message.includes('失败') ? '失败' : message.includes('通过') || message.includes('恢复') ? '成功' : '信息'
      return { ...current, [selectedId]: { ...existing, maintenanceLog: [{ time, action, detail: message, result }, ...existing.maintenanceLog].slice(0, 30) } }
    })
  }

  useEffect(() => {
    const history = turbineStates[selectedId]?.maintenanceLog || []
    setActivityLog(history.map(item => `${item.time} · ${item.detail}`).slice(0, 8))
  }, [selectedId, turbineStates])

  useEffect(() => {
    if (guide.active && guide.step === 1 && selectedId !== guideInitialTurbine) setGuide(state => ({ ...state, step: 2 }))
  }, [guide.active, guide.step, guideInitialTurbine, selectedId])

  // Slider changes only reveal the completion button. They never advance the guide.

  useEffect(() => {
    const targetName = guide.step === 1 ? 'turbine-select'
      : guide.step === 2 ? 'slider-panel'
        : guide.step === 3 ? 'enter-maintenance'
          : guide.step === 4 ? 'plan-cards'
            : guide.step === 5 ? 'execute-plan' : ''
    document.querySelectorAll('.guide-target-highlight').forEach(element => element.classList.remove('guide-target-highlight'))
    if (!guide.active || !targetName) {
      setGuideBubbleStyle({})
      return
    }
    const target = document.querySelector(`[data-guide-target="${targetName}"]`) as HTMLElement | null
    if (!target) return
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const timer = window.setTimeout(() => {
        target.classList.add('guide-target-highlight')
      }, 150)
      return () => {
        window.clearTimeout(timer)
      }
  }, [guide.active, guide.step])

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
    if (!activeFault) return
    setView('maintenance')
    if (guide.active && guide.step === 3) {
      setGuideInitialDecision(decisionAction)
      setGuidePlanClicked(false)
      setGuide(state => ({ ...state, step: 4 }))
    }
    logAction('进入维护决策工作台')
    if (mode === 'api') void loadApiPlan(weatherRestricted, false)
  }

  const chooseAction = (action: string) => {
    setDecisionAction(action)
    if (guide.active && guide.step === 4) setGuidePlanClicked(true)
    setSelectedPlan(action === 'CONTINUE_MONITORING' ? 'monitor' : action === 'SCHEDULE_MAINTENANCE' ? 'service' : 'inspect')
    logAction(`选择策略：${action === 'CONTINUE_MONITORING' ? '继续监测' : action === 'SCHEDULE_MAINTENANCE' ? '预防性维护' : '现场检查'}`)
  }

  const selectPlanCard = (item: MaintenancePlan) => {
    if (item.available === false) return
    const action = item.id === 'monitor' ? 'CONTINUE_MONITORING' : item.id === 'inspect' ? 'SCHEDULE_INSPECTION' : 'SCHEDULE_MAINTENANCE'
    if (action === 'CONTINUE_MONITORING' && activeFault) {
      setDecisionConfirm(action)
      return
    }
    chooseAction(action)
  }

  const planMetrics = (item: MaintenancePlan) => {
    if (item.id === 'monitor' || item.id === 'CONTINUE_MONITORING') return { timing: '持续观察', downtime: '0 h', cost: '¥0', risk: '5 h 内恶化', loss: '约 ¥7 万' }
    if (item.id === 'service' || item.id === 'SCHEDULE_MAINTENANCE') return { timing: '下一维护窗口', downtime: '6 h', cost: spareAvailable ? '¥10.4 万' : '¥13.5 万', risk: '低', loss: '约 ¥2.1 万' }
    return { timing: '今日执行', downtime: personnelAvailable ? '3 h' : '4.5 h', cost: '¥0.8 万', risk: '中', loss: '约 ¥1.2 万' }
  }

  const openEvidence = (panel: typeof evidencePanel, label: string) => {
    setEvidencePanel(panel)
    logAction(`查看${label}`)
  }

  const runRetestProgress = async () => {
    setRetestPhase('executing'); setRetestProgress(0); setServiced(false)
    const started = Date.now()
    await new Promise<void>(resolve => {
      const timer = window.setInterval(() => {
        const progress = Math.min(100, ((Date.now() - started) / 3500) * 100)
        setRetestProgress(progress)
        if (progress >= 100) { window.clearInterval(timer); resolve() }
      }, 80)
    })
    setRetestPhase('retesting'); setRetestProgress(100)
  }

  const executePlan = async () => {
    if (!selected) return
    setBeforeRetest(createRetestSnapshot(false)); setAfterRetest(null); setError('')
    if (mode === 'api') {
      if (!apiPlan) { setError('尚未生成可执行的维护方案。'); return }
      try {
        setLoading(true)
        const record = await executeMaintenance(apiPlan.plan_id)
        setMaintenanceRecordId(record.record_id)
        setRetests([])
        await runRetestProgress()
        setRetestLoading(true)
        let fetchedRetests: ApiRetest[] = []
        try { fetchedRetests = await fetchRetests(record.record_id); setRetests(fetchedRetests) } catch (reason) {
          const message = reason instanceof Error ? reason.message : '复测结果尚未生成'
          if (!message.includes('404')) setError(message)
        } finally { setRetestLoading(false) }
        if (!fetchedRetests.length) fetchedRetests = retests
        const apiResult = fetchedRetests[0]
        setAfterRetest(apiResult ? { location: apiResult.conclusion.includes('消除') ? '无异常' : selected.component_label, confidence: apiResult.conclusion.includes('消除') ? 0 : apiResult.failure_risk, risk: apiResult.failure_risk, health: apiResult.health_index, conclusion: apiResult.conclusion } : createRetestSnapshot(selectedPlan !== 'monitor'))
        if (selectedPlan === 'monitor' || decisionAction === 'CONTINUE_MONITORING') {
          setTurbineStates(current => current[selectedId] ? { ...current, [selectedId]: { ...current[selectedId], status: 'monitoring' } } : current)
        }
        setDecisionFeedback(decisionAction === 'CONTINUE_MONITORING' ? '你选择了继续监测，当前未停机，故障风险将继续跟踪。' : `你选择了${decisionAction === 'SCHEDULE_MAINTENANCE' ? '预防性维护' : '现场检查'}，已进入复测流程。`)
        setRetestPhase('result'); if (guide.active && guide.step === 5) { setGuide({ active: false, step: 0 }); setGuideMinimized(false); localStorage.setItem('guideCompleted', 'true') }; playConfirmSound(); logAction('维护完成，已生成复测结果')
      } catch (reason) { setError(reason instanceof Error ? reason.message : '维护请求失败'); setRetestPhase('idle') }
      finally { setLoading(false) }
    } else {
      await runRetestProgress()
      setAfterRetest(createRetestSnapshot(selectedPlan !== 'monitor' && maintenanceAttempts >= 1))
      if (selectedPlan === 'monitor' || decisionAction === 'CONTINUE_MONITORING') {
        setTurbineStates(current => current[selectedId] ? { ...current, [selectedId]: { ...current[selectedId], status: 'monitoring' } } : current)
      }
      setDecisionFeedback(decisionAction === 'CONTINUE_MONITORING' ? '你选择了继续监测，实际停机 0 h，当前不产生维修成本。' : `你选择了${decisionAction === 'SCHEDULE_MAINTENANCE' ? '预防性维护' : '现场检查'}，已进入复测流程。`)
      setRetestPhase('result'); if (guide.active && guide.step === 5) { setGuide({ active: false, step: 0 }); setGuideMinimized(false); localStorage.setItem('guideCompleted', 'true') }; playConfirmSound(); logAction('演示维护完成，已生成复测结果')
    }
  }

  const confirmRetest = (passed: boolean) => {
    if (!afterRetest) return
    if (passed && !retestPassed(afterRetest)) {
      setError(`当前故障仍未消除（置信度 ${(afterRetest.confidence * 100).toFixed(0)}%），无法确认修复完成，请选择二次维护`)
      logAction(`复测未通过：故障仍存在（置信度 ${(afterRetest.confidence * 100).toFixed(0)}%），已发起二次维护`)
      return
    }
    if (passed) {
      setServiced(true); setRetestPhase('idle')
      setDiagnosticParams(defaultDiagnosticParams)
      setTurbineStates(current => current[selectedId] ? { ...current, [selectedId]: { ...current[selectedId], params: defaultDiagnosticParams, fault: null, status: 'maintained' } } : current)
      logAction('复测确认通过：设备状态恢复正常')
      return
    }
    const nextAttempt = maintenanceAttempts + 1
    setMaintenanceAttempts(nextAttempt); setBeforeRetest(null); setAfterRetest(null); setRetestPhase('idle'); setServiced(false)
    if (nextAttempt >= 2) {
      setError('多次维修未成功，建议更换部件')
      logAction('复测未通过：多次维修未成功，建议更换部件')
    } else {
      setError('复测未通过：故障仍存在，已返回维护方案选择')
      logAction('复测未通过：故障仍存在，已发起二次维护')
    }
  }

  const guideCopy = [
    ['第 1 步：选择风机', '点击风机编号，查看设备状态。'],
    ['第 2 步：调节实时参数', "拖动滑块模拟故障工况，可同时调整转速、油温、风速等多个参数，超过安全范围会变红触发 AI 检测。调整完成后点击“设置完成，下一步”。"],
    ['第 3 步：进入维护决策', 'AI 已检测到故障，点击“查看维护方案”进入决策。'],
    ['第 4 步：比较维护方案', "对比三个方案的停机时长、成本和风险，选择一个维护方案。💡建议选择“现场检查”或“预防性维护”以体验完整修复流程；选择“继续监测”可体验故障未处理时的复测结果。💡你也可以先调整上方的工程约束条件（人员、备件、天气等），观察哪些方案会被锁定、推荐如何变化，然后再选方案。"],
    ['第 5 步：执行并复测', '点击“模拟执行方案”，执行后查看复测结果。'],
  ] as const
  const startGuide = () => {
    setGuideInitialTurbine(selectedId)
    setGuideInitialParams(diagnosticParams)
    setGuidePlanClicked(false)
    setGuideMinimized(false)
    setGuide({ active: true, step: 1 })
  }
  const closeGuide = () => {
    document.querySelectorAll('.guide-target-highlight').forEach(element => element.classList.remove('guide-target-highlight'))
    setGuide({ active: false, step: 0 })
    setGuidePlanClicked(false)
    setGuideMinimized(false)
    localStorage.setItem('guideCompleted', 'true')
  }
  const guideParamsChanged = (Object.keys(diagnosticParams) as Array<keyof DiagnosticParams>).some(key => diagnosticParams[key] !== guideInitialParams[key])
  // A card click is the meaningful user action. The selected plan may equal the
  // initially recommended value, so comparing values alone can leave the button inert.
  const guideDecisionChanged = guide.active && guide.step === 4 && guidePlanClicked && Boolean(decisionAction)
  const advanceGuide = () => {
    if (guide.active && guide.step === 2 && guideParamsChanged) setGuide(state => ({ ...state, step: 3 }))
  }
  const confirmGuidePlan = () => {
    if (guide.active && guide.step === 4 && guideDecisionChanged) setGuide(state => ({ ...state, step: 5 }))
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.2} /></span><span><strong>WindCare</strong><small>风电装备智能运维</small></span></div>
      <nav className="top-nav" aria-label="主导航"><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>风场总览</button><button className={view === 'maintenance' ? 'active' : ''} onClick={openMaintenance} disabled={!selected}>维护决策</button></nav>
      <div className="top-actions"><div className="mode-switch" aria-label="数据模式"><button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>演示</button><button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')}>接口</button></div><button className={`icon-button ${engineeringView ? 'active-icon' : ''}`} title="工程剖切视图" aria-label="工程剖切视图" aria-pressed={engineeringView} onClick={() => setEngineeringView(v => !v)}><Layers3 size={18} /></button><button className="icon-button" title="数据来源说明" aria-label="数据来源说明" onClick={() => setShowSources(true)}><Database size={18} /></button></div>
    </header>

    <main className="workspace">
      <button className="guide-launcher" onClick={startGuide}><Activity size={15} />重新查看引导</button>
      {guide.active && <div className="guide-overlay" aria-hidden="true" />}
      {guide.active && !guideMinimized && <div className={`guide-coach guide-coach-v2 ${guide.step === 4 ? 'guide-plan-step' : ''}`} style={guideBubbleStyle} role="dialog" aria-live="polite"><button className="guide-minimize" aria-label="最小化引导" title="最小化" onClick={() => setGuideMinimized(true)}>—</button><strong>{guideCopy[guide.step - 1][0]}</strong>{guide.step === 4 ? <div className="guide-plan-copy"><p>对比三个方案的停机时长、成本和风险，选择一个维护方案。</p><small>💡建议选择“现场检查”或“预防性维护”以体验完整修复流程；选择“继续监测”可体验故障未处理时的复测结果。</small><small>💡你也可以先调整上方的工程约束条件（人员、备件、天气等），观察哪些方案会被锁定、推荐如何变化，然后再选方案。</small></div> : <p>{guideCopy[guide.step - 1][1]}</p>}<div className="guide-actions"><button onClick={closeGuide}>跳过引导</button><button onClick={closeGuide}>关闭</button></div></div>}
      {guide.active && guideMinimized && <button className="guide-pill" onClick={() => setGuideMinimized(false)}>💡 引导进行中</button>}
      <section className="scene-panel" aria-label="风电场三维场景">
        <div className="scene-heading"><div><div className="eyebrow"><MapPin size={13} /> 风电场数字场景 <span className="source-tag">{mode === 'demo' ? '演示数据' : '接口数据'}</span></div><h1>风场运行总览</h1><p>选择风机，查看状态与维护决策</p></div><div className="scene-weather"><CloudSun size={19} /><span>实时天气 <small>{weatherStatus}</small></span><b>{weather.wind.toFixed(1)} m/s · 浪 {weather.wave.toFixed(1)} m · 能见度 {weather.visibility.toFixed(1)} km</b></div></div>
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
          <div className="selector-row"><div><span className="section-kicker">设备状态</span><h2>{selected.turbine_id} <span>{selected.name}</span></h2></div>{persistedSelected?.status === 'monitoring' ? <span className="status-badge status-low">⚠ 故障未处理 · 继续监测中</span> : selected.has_analysis === false ? <span className="status-badge status-neutral">暂无分析结果</span> : <StatusBadge level={serviced ? 'NORMAL' : selected.warning_level} />}</div>
          <div className="turbine-tabs" data-guide-target="turbine-select" role="tablist" aria-label="选择风机">{turbines.map(t => <button role="tab" aria-selected={selectedId === t.turbine_id} className={selectedId === t.turbine_id ? 'selected' : ''} key={t.turbine_id} onClick={() => selectTurbine(t.turbine_id)}>{t.turbine_id}<i className={`level-${t.warning_level.toLowerCase()}`} /></button>)}</div>
          {view === 'overview' ? <>
            {persistedSelected?.status === 'monitoring' && activeFault && <div className="monitoring-status-tag" role="status">⚠ 故障未处理 · 继续监测中</div>}
            <div className="reading-primary"><div className="reading-label"><Gauge size={18} /> 健康指数 <span title="B 的模型输出；演示模式中的数值为模拟数据">ⓘ</span></div><div className="reading-number">{selected.has_analysis === false ? '--' : serviced ? '待复测' : selected.health_index.toFixed(1)}{selected.has_analysis !== false && !serviced && <small>/ 100</small>}</div><div className="meter"><span style={{ width: selected.has_analysis === false || serviced ? '0%' : `${selected.health_index}%` }} className={selected.warning_level === 'HIGH' ? 'meter-risk' : ''} /></div><p>{selected.has_analysis === false ? '后端尚无该部件的 AI 分析结果。' : serviced ? '维护执行已记录，设备健康状态应由复测数据确认。' : selected.warning_level === 'HIGH' ? '状态持续偏离正常区间，建议进入维护评估。' : '当前状态以数据分析结果为准。'}</p></div>
            <div className="metric-grid"><div><span>异常分数</span><strong>{selected.has_analysis === false ? '--' : selected.anomaly_score.toFixed(2)}</strong><small>模型输出</small></div><div><span>风险评分</span><strong>{selected.has_analysis === false ? '--' : selected.failure_risk.toFixed(2)}</strong><small>0-1 指标，非校准概率</small></div><div><span>当前功率</span><strong>{selected.power_kw !== 0 ? selected.power_kw.toLocaleString() : '--'}<em> kW</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.power_kw !== 0 ? '运行示例' : '未提供'}</small></div><div><span>风速</span><strong>{selected.wind_ms !== 0 ? selected.wind_ms : '--'}<em> m/s</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.wind_ms !== 0 ? '运行示例' : '未提供'}</small></div></div>
            <div className="info-section"><div className="section-title"><h3>{selected.trend_label || '传感器趋势'}</h3><span>{selected.trend_unit || 'CARE telemetry'}</span></div><Sparkline values={selected.trend} high={selected.warning_level === 'HIGH'} /></div>
          <section className="ai-workbench" data-guide-target="slider-panel" aria-label="实时AI故障检测"><div className="workbench-title"><h3><Activity size={15} /> 实时 AI 故障检测</h3><span className="simulated-tag">SIMULATED · 拖动即推理</span></div><div className="diagnostic-layout"><div className="diagnostic-controls">{diagnosticFields.map(field => <label className="diagnostic-slider" key={field.key}><span><b>{field.label}</b><em>{diagnosticParams[field.key].toFixed(field.step < 1 ? 1 : 0)} {field.unit}</em></span><input style={{ '--slider-color': sliderTint(field, diagnosticParams[field.key]) } as CSSProperties} type="range" min={field.min} max={field.max} step={field.step} value={diagnosticParams[field.key]} onChange={event => updateDiagnosticParam(field.key, Number(event.target.value))} /><small>安全范围 {field.normal[0]}–{field.normal[1]} {field.unit}</small></label>)}<button className="reset-diagnostic" onClick={() => setDiagnosticParams(defaultDiagnosticParams)}><RotateCcw size={14} /> 一键重置参数</button></div><div className="diagnostic-result"><div className="ai-status-line"><span className={`ai-pulse ${diagnostic.level.toLowerCase()}`} />AI 推理完成 <StatusBadge level={diagnostic.level} /></div><DiagnosticDiagram location={diagnostic.location} risk={diagnostic.risk} /><div className="diagnostic-summary"><strong>{diagnostic.location}</strong><span>置信度 {(diagnostic.risk * 100).toFixed(0)}% · 风险评分 {diagnostic.risk.toFixed(2)}</span></div><ConfidenceBars scores={diagnostic.scores} /></div></div><div className="diagnostic-history"><div><strong><History size={14} /> 最近检测</strong><span>{diagnosticHistory.length ? `${diagnosticHistory.length} 条` : '暂无记录'}</span></div>{diagnosticHistory.slice(0, 3).map(item => <span key={`${item.at}-${item.risk}`}>{item.at} · {item.location} · ${(item.risk * 100).toFixed(0)}%</span>)}</div></section>
          {guide.active && guide.step === 2 && guideParamsChanged && <button className="guide-complete" data-guide-target="guide-next" onClick={advanceGuide}>设置完成，下一步</button>}
          <div className="event-selector"><label htmlFor="wt02-event">WT02 故障案例基线</label><select id="wt02-event" value={faultEventId} onChange={event => { const id = event.target.value; setFaultEventId(id); setDiagnosticParams(eventDiagnosticPresets[id] || defaultDiagnosticParams); logAction(`载入故障案例基线：${id}`) }}>{wt02FaultEvents.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select><small>预设案例仅用于载入初始传感器状态；拖动下方滑块后由实时演示推理重新计算。</small></div>
          <div className="component-line"><div className="component-symbol"><Settings2 size={18} /></div><div><strong>{selected.component_label}</strong><span>{selected.component_id} · {selectedFault.name} · 映射待核验</span></div><ChevronDown size={17} /></div>
            <button className="primary-action" data-guide-target="enter-maintenance" disabled={!activeFault} title={!activeFault ? '当前设备无激活故障，无需维护' : '查看维护方案'} onClick={openMaintenance}><Wrench size={17} /> {activeFault ? '查看维护方案' : '设备正常，无需维护'} {activeFault && <ArrowRight size={17} />}</button>
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
              <button className={!weatherRestricted ? 'resource-on' : ''} title={weatherClosed ? weatherReason : '点击切换演示天气窗口'} onClick={() => { const nextClosed = !weatherClosed; setWeather(nextClosed ? { wind: 13.2, wave: 2.2, visibility: 5.4 } : { wind: 9.2, wave: 1.1, visibility: 8.6 }); logAction(`天气窗口${nextClosed ? '关闭' : '开放'}`) }}><CloudSun size={15} />天气窗口 {weatherStatus}</button>
              <button className={shutdownAllowed ? 'resource-on' : ''} onClick={() => { setShutdownAllowed(v => !v); logAction(`停机许可${shutdownAllowed ? '关闭' : '开启'}`) }}><Radio size={15} />允许停机 {shutdownAllowed ? '是' : '否'}</button>
              <button className={liftingAvailable ? 'resource-on' : ''} onClick={() => { setLiftingAvailable(v => !v); logAction(`吊装资源${liftingAvailable ? '不可用' : '可用'}`) }}><Anchor size={15} />吊装 {liftingAvailable ? '可用' : '不可用'}</button>
            </div></div>
            <div className="constraint-summary">约束：人员<span className={personnelAvailable ? 'available' : 'unavailable'}>{personnelAvailable ? '✓' : '✗'}</span> 备件<span className={spareAvailable ? 'available' : 'unavailable'}>{spareAvailable ? '✓' : '✗'}</span> 天气<span className={!weatherRestricted ? 'available' : 'unavailable'}>{!weatherRestricted ? '✓' : '✗'}</span> 停机<span className={shutdownAllowed ? 'available' : 'unavailable'}>{shutdownAllowed ? '✓' : '✗'}</span> 吊装<span className={liftingAvailable ? 'available' : 'unavailable'}>{liftingAvailable ? '✓' : '✗'}</span></div>
            <div className="constraint-row"><div><CloudSun size={17} /><span>天气窗口 {weatherStatus}<small>{weatherClosed ? weatherReason : '当前窗口可用于评估，状态每 6 秒刷新'}</small></span></div><strong className={`weather-state ${weatherClosed ? 'closed' : weatherStatus.includes('即将') ? 'warning' : 'open'}`}>{weather.wind.toFixed(1)} m/s · 浪高 {weather.wave.toFixed(1)} m · 能见度 {weather.visibility.toFixed(1)} km</strong></div>
            <div className="section-title plan-title"><h3>可选方案</h3><span>{mode === 'demo' ? '规则演示 / 假设参数' : apiPlan ? `后端决策 · ${apiPlan.priority}` : '等待后端决策'}</span></div>
            <div className="plans" data-guide-target="plan-cards">{plans.map((p: MaintenancePlan, index) => { const metrics = planMetrics(p); return <details key={p.id} className={`plan-option ${plan.id === p.id ? 'selected' : ''} ${p.available === false ? 'locked' : ''}`} open={plan.id === p.id && p.available !== false} title={p.available === false ? p.action : undefined}><summary onClick={event => { event.preventDefault(); selectPlanCard(p) }}><span className="plan-radio">{plan.id === p.id && <span />}</span><span className="plan-copy"><strong>{String.fromCharCode(65 + index)} · {p.title}{p.recommended && <em>⭐ 推荐</em>}</strong><small><Clock3 size={13} /> {metrics.timing} · 恶化风险 {metrics.risk}</small><span>停机 {metrics.downtime} · 成本 {metrics.cost} · 发电损失 {metrics.loss}</span></span><ChevronDown size={15} /></summary><div className="plan-details"><p>{p.action}</p><small><ShieldCheck size={13} /> 安全提示：执行前确认人员、备件、天气窗口与停机许可。</small></div></details> })}</div>
            {guide.active && guide.step === 4 && <button className="guide-complete guide-plan-confirm" disabled={!guideDecisionChanged} onClick={confirmGuidePlan}>确认选择，下一步</button>}
            <div className="decision-explanation"><strong>推荐方案说明</strong><span>{plan?.recommended ? `推荐 ${plan.title}：当前风险 ${(selected.failure_risk * 100).toFixed(0)}%，结合${conditionSummary}，选择该方案可在控制停机的同时降低故障恶化风险。` : '当前推荐方案受工程约束影响，系统已根据可用人员、备件和窗口动态调整。'}</span></div>
            {decisionFeedback && <div className="decision-feedback"><strong>决策反馈</strong><span>{decisionFeedback}</span></div>}
            <div className="plan-facts"><div><span>预计停机</span><strong>{plan.downtime}</strong></div><div><span>资源成本</span><strong>{plan.cost}</strong></div><div><span>风险水平</span><strong>{plan.risk}</strong></div></div>
            {retestPhase === 'executing' && <div className="retest-progress-card"><strong>维护执行中，预计停机 {selectedPlan === 'service' ? '6' : '2'} 小时</strong><div className="retest-progress-track"><span style={{ width: `${retestProgress}%` }} /></div><small>{Math.round(retestProgress)}% · 请保持页面打开</small></div>}
            {retestPhase === 'retesting' && <div className="retest-progress-card"><strong>正在重新检测设备状态</strong><div className="retest-spinner" /><small>AI 正在重新推理传感器数据</small></div>}
            {retestPhase === 'result' && beforeRetest && afterRetest && <div className="retest-result-card"><div className="retest-head"><span>修复前后复测对比</span><em>{afterRetest.conclusion}</em></div><div className="retest-compare"><div><small>修复前</small><strong>{beforeRetest.location}</strong><span>置信度 {(beforeRetest.confidence * 100).toFixed(0)}% · 风险 {beforeRetest.risk.toFixed(2)} · 健康 {beforeRetest.health.toFixed(1)}</span></div><ArrowRight size={18} /><div className={afterRetest.risk < beforeRetest.risk ? 'improved' : 'worsened'}><small>复测后</small><strong>{afterRetest.location}</strong><span>置信度 {(afterRetest.confidence * 100).toFixed(0)}% · 风险 {afterRetest.risk.toFixed(2)} · 健康 {afterRetest.health.toFixed(1)}</span></div></div><p className={afterRetest.risk > beforeRetest.risk ? 'retest-warning' : ''}>{afterRetest.conclusion}</p><div className="retest-actions"><button className="primary-action" disabled={!retestPassed(afterRetest)} title={retestPassed(afterRetest) ? '复测通过，可确认修复' : `当前故障仍未消除（置信度 ${(afterRetest.confidence * 100).toFixed(0)}%），请进行二次维护`} onClick={() => confirmRetest(true)}><Check size={16} /> 确认修复完成</button><button className="secondary-action" onClick={() => confirmRetest(false)}><AlertTriangle size={16} /> 修复未达标，需二次维护</button></div></div>}
            {retestPhase === 'idle' && !serviced && <button className="primary-action" data-guide-target="execute-plan" disabled={loading || Boolean(planLockReason(decisionAction)) || (mode === 'api' && !apiPlan)} title={planLockReason(decisionAction)} onClick={executePlan}><Check size={17} /> {mode === 'api' ? '记录维护执行' : '模拟执行方案'} <ArrowRight size={17} /></button>}
            {serviced && <div className="success-message"><Check size={17} /><div><strong>维护复测已确认</strong><span>设备状态已恢复正常，故障标记已清除。</span></div></div>}
            <div className="log-panel"><div className="workbench-title"><h3>操作日志</h3><span>{activityLog.length} 条</span></div>{activityLog.length ? activityLog.map((item, i) => <div key={`${item}-${i}`}><Clock3 size={12} />{item}</div>) : <p>尚未进行工程操作</p>}</div>
            {mode === 'api' && (maintenanceRecordId || retestLoading) && <div className="retest-card"><div className="retest-head"><span>维护后复测</span><em>{retest?.data_origin || (retestLoading ? '查询中' : '待复测')}</em></div>{retest ? <><div className="retest-values"><div><span>健康指数</span><strong>{retest.health_index.toFixed(1)}</strong></div><div><span>相对风险</span><strong>{retest.failure_risk.toFixed(3)}</strong></div></div><p>{retest.conclusion}</p><small>复测来源：{retest.data_origin} · 不代表真实维护效果</small></> : <p>{retestLoading ? '正在查询复测记录...' : '待复测。当前没有后端复测结果。'}</p>}</div>}
            <button className="secondary-action" onClick={() => { setView('overview'); setServiced(false) }}><RotateCcw size={16} /> 返回设备状态</button>
          </>}
          <div className="data-footnote"><span>{mode === 'demo' ? 'SIMULATED · 演示样例' : `${selected.source} · API`}</span><span>{selected.model_version} · {selected.updated_at}</span></div>
        </>}
      </aside>
    </main>
    {decisionConfirm && <div className="modal-backdrop" onClick={() => setDecisionConfirm(null)}><section className="decision-confirm-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><h2>确认继续监测？</h2><p>当前故障预计 5 h 内恶化，维修成本可能从 0.8 万升至 8 万，并可能发生突发停机。</p><div><button className="secondary-action" onClick={() => setDecisionConfirm(null)}>返回选择</button><button className="primary-action" onClick={() => { setDecisionConfirm(null); chooseAction('CONTINUE_MONITORING') }}>确认继续监测</button></div></section></div>}
    {showSources && <div className="modal-backdrop" onClick={() => setShowSources(false)}><section className="source-modal" role="dialog" aria-modal="true" aria-label="数据来源说明" onClick={e => e.stopPropagation()}><div className="modal-head"><div><Database size={19} /><h2>数据来源说明</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setShowSources(false)}><X size={18} /></button></div><p>当前演示模式中的风机数据、健康指数、风险评分、趋势和维护参数均为模拟样例，仅用于验证 C 模块的交互流程，不代表 CARE 数据集实测或 AI 模型结果。</p><p>八台演示风机均使用项目提供的 SolidWorks/STEP 工程模型转换版本。叶片、轮毂、塔筒、机舱、主轴、齿轮、轴承和发电机均绑定到模型中的CAD零件节点，不再使用旧外形模型或程序化内部零件作为正式显示对象。</p><p>接口模式读取 D 的风机与组件状态，并通过 <code>/api/maintenance/optimize</code>、<code>/api/maintenance/replan</code> 和 <code>/api/maintenance/execute</code> 完成维护决策闭环。映射状态为 <code>UNVERIFIED</code> 时保持中性部件名称。</p><p>风险评分默认作为 0-1 指标显示；若未完成概率校准，不称为“故障概率”。执行维护后需要后端提供复测结果，前端才会更新真实健康状态。</p><button className="modal-done" onClick={() => setShowSources(false)}>了解</button></section></div>}
  </div>
}

