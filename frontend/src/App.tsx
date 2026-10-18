import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Activity, AlertTriangle, Anchor, ArrowRight, Check, ChevronDown, ClipboardList, Clock3, CloudSun, Database, Eye, Gauge, History, Layers3, MapPin, PackageCheck, Radio, RotateCcw, Search, Server, Settings2, ShieldCheck, UserRound, Wrench, X } from 'lucide-react'
import WindScene from './WindScene'
import { executeMaintenance, fetchRetests, fetchTurbines, optimizeMaintenance, replanMaintenance, type ApiMaintenancePlan, type ApiRetest } from './api'
import { demoTurbines, getDemoPlans, warningText, wt02FaultEvents, type MaintenancePlan, type SourceKind, type Turbine } from './data'
import { paderbornExperiment } from './experiment'
import './signal-blue.css'

type Mode = 'demo' | 'experiment' | 'api'
type View = 'overview' | 'signal' | 'demo' | 'maintenance'
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

type DiagnosticRecord = {
  sampleId: string
  diagnosisId: string
  source: SourceKind
  modelVersion: string
  turbineId: string
  component: string
  risk: number
  health: number
  anomaly: number
  warningLevel: Turbine['warning_level']
  stages: Array<{ key: string; label: string; status: 'available' | 'pending' | 'not-applicable'; detail: string }>
}

type CareTelemetrySummary = {
  timestamp: string
  active_power_kw: number
  wind_speed_ms: number
  bearing_temperature_c: number
  trend: Array<{ rotor_bearing_temperature_2_c: number }>
  data_origin: 'DERIVED'
  source_dataset: string
  source_file: string
}

function publicComponentLabel(label: string) {
  return label.replace(/\s*[（(]映射待核验[）)]/g, '').trim()
}

type TrendLevel = Turbine['warning_level']

function Sparkline({ values, level }: { values: number[], level: TrendLevel }) {
  if (values.length < 2) return <div className="no-trend">暂无趋势数据</div>
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = Math.max(maximum - minimum, 1)
  const points = values.map((value, i) => `${(i / (values.length - 1)) * 300},${78 - ((value - minimum) / span) * 62}`).join(' ')
  const trendClass = level === 'NORMAL' ? 'normal' : level === 'LOW' ? 'watch' : 'risk'
  return <div className="chart-wrap">
    <div className="chart-grid"><span>{maximum.toFixed(1)}</span><span>{((maximum + minimum) / 2).toFixed(1)}</span><span>{minimum.toFixed(1)}</span></div>
    <svg className="sparkline" viewBox="0 0 300 92" preserveAspectRatio="none" aria-label="健康指数历史趋势">
      <line x1="0" y1="10" x2="300" y2="10" /><line x1="0" y1="48" x2="300" y2="48" /><line x1="0" y1="84" x2="300" y2="84" />
      <polyline points={points} className={`${trendClass}-line`} />
      <circle cx="300" cy={78 - ((values.at(-1)! - minimum) / span) * 62} r="4" className={`${trendClass}-dot`} />
    </svg>
    <div className="chart-axis"><span>早期</span><span>近期</span></div>
  </div>
}

function StatusBadge({ level }: { level: Turbine['warning_level'] }) {
  return <span className={`status-badge status-${level.toLowerCase()}`}><span className="status-dot" />{warningText[level]}</span>
}

function SignalPanel({ turbine, record, onLocate, onMaintenance }: { turbine: Turbine; record: DiagnosticRecord; onLocate: () => void; onMaintenance: () => void }) {
  const severity = Math.max(.05, Math.min(.98, record.risk))
  const isExperiment = record.source === 'EXTERNAL_PUBLIC'
  const features = record.source === 'SIMULATED' ? [
    ['均值', (.008 + severity * .024).toFixed(3), 'g'], ['标准差', (.08 + severity * .09).toFixed(3), 'g'],
    ['RMS', (.09 + severity * .1).toFixed(3), 'g'], ['峭度', (3.1 + severity * 2.5).toFixed(2), ''],
    ['峰峰值', (.42 + severity * .48).toFixed(2), 'g'], ['峰值因子', (2.6 + severity * 1.2).toFixed(2), ''],
  ] : [['均值', '--', ''], ['标准差', '--', ''], ['RMS', '--', ''], ['峭度', '--', ''], ['峰峰值', '--', ''], ['峰值因子', '--', '']]
  return <div className="signal-panel-blue" data-guide-target="signal-panel">
    <div className="signal-panel-head"><div><span className="section-kicker">SIGNAL DIAGNOSTICS · v0.2</span><h2>信号诊断</h2><p>{record.source === 'EXTERNAL_PUBLIC' ? record.turbineId : turbine.turbine_id} · {record.component}</p></div><span className="signal-sample"><Database size={13} /> {record.sampleId}<small>{record.source} · {record.modelVersion}</small></span></div>
    <div className="signal-boundary"><Radio size={14} /> {isExperiment ? '本页引用 Paderborn 公开轴承数据的跨物理轴承留出评估记录，不是风场在线诊断。' : `本页所有结果均引用当前样本；来源为 ${record.source}。正式接口接入后，将由后端返回原始通道与每个处理阶段的结果。`}</div>
    <div className="signal-provenance"><div><span>样本来源</span><strong>{record.source === 'SIMULATED' ? '演示参数样本' : isExperiment ? 'Paderborn Bearing Data Center' : 'CARE v6 · SCADA 聚合量'}</strong></div><div><span>诊断编号</span><strong>{record.diagnosisId}</strong></div><div><span>模型版本</span><strong>{record.modelVersion}</strong></div><small>{isExperiment ? `EXTERNAL_PUBLIC · 64 kHz 三通道波形 · SHA-256 ${paderbornExperiment.sourceHash.slice(0, 16)}…` : 'CARE 聚合量不能直接代表高采样率实测波形；未接入原始波形时，频谱结果必须标记为待接入或仿真。'}</small></div>
    <div className="signal-steps">{record.stages.map((stage, index) => <span key={stage.key} className={stage.status === 'available' ? 'active' : stage.status === 'pending' ? 'pending' : ''}>{String(index + 1).padStart(2, '0')} {stage.label}</span>).reduce<ReactNode[]>((items, item, index, all) => index < all.length - 1 ? [...items, item, <i key={`line-${index}`} />] : [...items, item], [])}</div>
    <div className="signal-source-card"><div className="signal-card-title"><strong>当前样本输入</strong><span>sample_id 一一对应</span></div><div className="signal-source-grid"><div><span>数据对象 / 部件</span><strong>{record.turbineId} · {record.component}</strong></div><div><span>输入类型</span><strong>{record.source === 'SIMULATED' ? '仿真参数 / 演示信号' : isExperiment ? '振动 + 两相电流原始波形' : 'SCADA 聚合趋势'}</strong></div><div><span>状态</span><strong>{record.source === 'SIMULATED' ? '演示链路' : isExperiment ? '留出集推理已完成' : '等待后端原始通道'}</strong></div><div><span>结果性质</span><strong>{isExperiment ? '实验分类分数，未校准' : `风险 ${record.risk.toFixed(2)} · 健康 ${record.health.toFixed(1)}`}</strong></div></div>{record.source === 'SIMULATED' ? <div className="signal-wave-mini"><span />{Array.from({ length: 48 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 19 + Math.round(severity * 40)) % 65)}%` }} />)}</div> : isExperiment ? <div className="signal-wave-empty">原始 MAT 波形未随网页发布<br /><small>本页展示其已登记、可追溯的留出评估结果</small></div> : <div className="signal-wave-empty">暂无高采样率原始波形<br /><small>CARE v6 聚合数据不能直接生成 FFT / STFT 实测频谱</small></div>}<small className="signal-caption">{record.source === 'SIMULATED' ? 'SIMULATED · 演示波形占位，不是 CARE 实测原始波形' : isExperiment ? 'EXTERNAL_PUBLIC · Paderborn 原始文件哈希已登记' : 'CARE 聚合趋势 · 原始通道待后端接入'}</small></div>
    <div className="signal-process-grid">{record.stages.slice(1, 3).map(stage => <div className="signal-process-card" key={stage.key}><span>{stage.key}</span><strong>{stage.label}</strong><small>{stage.detail}</small><b>{stage.status === 'available' ? '已完成' : '待接入'}</b></div>)}</div>
    <div className="signal-method-card"><div className="signal-card-title"><strong>计算方法</strong><span>可追溯方法链</span></div>{isExperiment ? <><code>工程统计与频带特征 → XGBoost</code><code>三通道原始窗口 → 1D-CNN</code><code>Hann STFT → 2D-CNN → MLP 门控融合</code><small>当前门控使用实验训练结果，分类分数未校准；完整处理参数和消融结果保存在模型评估报告中。</small></> : <><code>RMS = √(1/N · Σxᵢ²)</code><code>峭度 = [1/N · Σ(xᵢ−μ)⁴] / σ⁴</code><code>robust-z = |x−median| / (1.4826 · MAD)</code><small>风险评分 = clip(robust-z / (2 · validation_p99), 0, 1)。该值用于相对排序，不是校准故障概率。</small></>}</div>
    <div className="signal-standards"><span>参考规范</span><b>ISO 13373 状态监测</b><b>ISO 13374 数据处理</b><b>ISO 13379 诊断解释</b><b>GB/T 19873.1 振动监测</b><b>GB/T 22394.2 数据判读</b></div>
    <div className="signal-feature-card"><div className="signal-card-title"><strong>计算特征</strong><span>{record.source === 'SIMULATED' ? '演示时域统计量' : isExperiment ? '评估报告登记，逐样本数值未随网页发布' : '等待后端特征结果'}</span></div><div className="signal-feature-grid">{features.map(([name, value, unit]) => <div key={name}><span>{name}</span><strong>{value}<em>{unit}</em></strong></div>)}</div></div>
    {record.source === 'EXTERNAL_PUBLIC' && <div className="experiment-evidence"><div className="signal-card-title"><strong>留出集实验结果</strong><span>INFERRED_EXPERIMENTAL</span></div><p>真实标签：{paderbornExperiment.trueLabel} · 模型输出：{paderbornExperiment.predictedLabel}</p><ConfidenceBars scores={paderbornExperiment.probabilities} /><div className="experiment-gates">{Object.entries(paderbornExperiment.gateWeights).map(([name, value]) => <span key={name}>{name}<b>{(value * 100).toFixed(2)}%</b></span>)}</div><small>总体 Macro-F1 {paderbornExperiment.metrics.macroF1.toFixed(4)} · Accuracy {paderbornExperiment.metrics.accuracy.toFixed(4)}。该分数未校准，且模型门控明显偏向 STFT 分支。</small></div>}
    <div className="signal-result-card"><div className="signal-card-title"><strong>诊断结果</strong><span>{record.modelVersion}</span></div><div className="signal-result-line"><div><span>{record.turbineId} · {record.source} 结果</span><strong>{record.warningLevel === 'NORMAL' ? '当前信号处于可接受区间' : `${record.component}异常特征`}</strong></div><b>{record.source === 'EXTERNAL_PUBLIC' ? `${(paderbornExperiment.confidence * 100).toFixed(1)}%` : `${Math.round((1 - record.risk) * 100)}%`}</b></div><p>{record.source === 'EXTERNAL_PUBLIC' ? `64 kHz 三通道、${paderbornExperiment.windowCount} 个 ${paderbornExperiment.windowSamples} 点窗口；这是跨物理轴承留出实验，不是风场在线诊断。` : `风险评分 ${record.risk.toFixed(2)}，健康指数 ${record.health.toFixed(1)}。置信度展示需以后端模型校准结果为准，当前值仅表示样本结果的相对可信程度。`}</p>{record.source !== 'EXTERNAL_PUBLIC' && <div className="signal-actions"><button onClick={onLocate}><Eye size={14} /> 三维定位部件</button><button onClick={onMaintenance}><Wrench size={14} /> 进入维护决策</button></div>}</div>
  </div>
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
  return <div className="diagnostic-diagram" title={`${location} · 置信度 ${(risk * 100).toFixed(0)}%`}><svg viewBox="0 0 470 150" role="img" aria-label={`二维风机示意图，当前故障位置 ${location}`}><path className="diagram-tower" d="M225 105 L245 105 L255 145 L215 145 Z" /><path className="diagram-nacelle" d="M145 72 H390 Q410 72 410 91 H145 Z" /><path className="diagram-blade" d="M155 82 L72 43 L78 37 L170 72 Z" /><path className="diagram-blade" d="M155 82 L68 119 L72 126 L170 91 Z" /><line className="diagram-shaft" x1="155" y1="82" x2="400" y2="82" />{spots.map(spot => <g key={spot.name} className={spot.name === location || (location === '主轴/轴承' && spot.name === '主轴/轴承') ? 'fault-spot active' : 'fault-spot'}><circle cx={spot.x} cy={spot.y} r="7" /></g>)}</svg><div className="diagram-labels">{spots.map(spot => <span key={spot.name} className={spot.name === location || (location === '主轴/轴承' && spot.name === '主轴/轴承') ? 'active' : ''}><i />{spot.name}</span>)}</div><div className="diagram-tooltip">{location} · 置信度 {(risk * 100).toFixed(0)}%</div></div>
}

function ConfidenceBars({ scores }: { scores: Record<string, number> }) {
  return <div className="confidence-bars">{Object.entries(scores).map(([label, value]) => <div key={label} className="confidence-row"><span>{label}</span><div><i style={{ width: `${Math.max(4, value * 100)}%` }} /></div><strong>{(value * 100).toFixed(0)}%</strong></div>)}</div>
}

function faultLocation(category: Turbine['fault_category']) {
  return category === 'GEARBOX' || category === 'GEARBOX_BEARING' ? '齿轮箱' : category === 'GENERATOR' ? '发电机' : category === 'ROTOR_BEARING' || category === 'BEARING' ? '主轴/轴承' : '主轴/联轴器'
}

function buildDiagnosticRecord(turbine: Turbine, mode: Mode, location: string, eventId?: string): DiagnosticRecord {
  if (mode === 'experiment') return {
    sampleId: paderbornExperiment.sampleId,
    diagnosisId: paderbornExperiment.diagnosisId,
    source: 'EXTERNAL_PUBLIC',
    modelVersion: paderbornExperiment.modelVersion,
    turbineId: 'PADERBORN-KA01',
    component: '轴承外圈试验件（未映射至风机 CAD）',
    risk: paderbornExperiment.confidence,
    health: 0,
    anomaly: paderbornExperiment.confidence,
    warningLevel: 'HIGH',
    stages: [
      { key: '01', label: '输入', status: 'available', detail: 'Paderborn 三通道原始波形' },
      { key: '02', label: '质检', status: 'available', detail: '哈希、时间轴和分组边界已核验' },
      { key: '03', label: '预处理', status: 'available', detail: '去趋势和训练集缩放' },
      { key: '04', label: '特征', status: 'available', detail: '工程特征、原始波形和 STFT' },
      { key: '05', label: '推理', status: 'available', detail: '跨物理轴承留出实验结果' },
    ],
  }
  const source = mode === 'api' ? turbine.source : 'SIMULATED'
  const suffix = eventId || turbine.event_id || 'baseline'
  return {
    sampleId: `${source}-${turbine.turbine_id}-${suffix}`,
    diagnosisId: `DX-${turbine.turbine_id}-${suffix}`,
    source,
    modelVersion: source === 'DERIVED' ? 'CARE-v6-telemetry-evidence' : mode === 'api' ? turbine.model_version : 'demo-rule-v0.2',
    turbineId: turbine.turbine_id,
    component: publicComponentLabel(turbine.component_label || location),
    risk: turbine.failure_risk,
    health: turbine.health_index,
    anomaly: turbine.anomaly_score,
    warningLevel: turbine.warning_level,
    stages: [
      { key: '01', label: '输入', status: 'available', detail: source === 'SIMULATED' ? '演示样本已生成' : source === 'DERIVED' ? 'CARE 聚合样本已登记' : '接口样本已登记' },
      { key: '02', label: '质检', status: source === 'SIMULATED' ? 'available' : 'pending', detail: source === 'SIMULATED' ? '长度和参数检查通过' : '等待后端返回质检结果' },
      { key: '03', label: '预处理', status: source === 'SIMULATED' ? 'available' : 'pending', detail: source === 'SIMULATED' ? '去趋势、滤波、归一化' : '等待后端返回处理结果' },
      { key: '04', label: '特征', status: source === 'SIMULATED' ? 'available' : 'pending', detail: source === 'SIMULATED' ? '时域特征演示' : '等待原始通道和特征结果' },
      { key: '05', label: '推理', status: source === 'SIMULATED' ? 'available' : (turbine.has_analysis ? 'available' : 'pending'), detail: source === 'SIMULATED' ? '规则演示结果' : (turbine.has_analysis ? turbine.model_version : '暂无诊断结果') },
    ],
  }
}

function sliderTint(field: typeof diagnosticFields[number], value: number) {
  const [low, high] = field.normal
  if (value >= low && value <= high) return '#31b987'
  const distance = value < low ? (low - value) / Math.max(low - field.min, 1) : (value - high) / Math.max(field.max - high, 1)
  return distance > .55 ? '#d4473d' : '#e2ad3e'
}

function DemoPanel({
  turbine, params, diagnostic, displayLocation, history, onParamChange, onReset, onLocate,
}: {
  turbine: Turbine
  params: DiagnosticParams
  diagnostic: ReturnType<typeof diagnosticInference>
  displayLocation: string
  history: Array<{ at: string; location: string; risk: number }>
  onParamChange: (key: keyof DiagnosticParams, value: number) => void
  onReset: () => void
  onLocate: () => void
}) {
  return <section className="demo-panel" data-guide-target="slider-panel" aria-label="参数演示"><div className="demo-panel-head"><div><span className="section-kicker">SIMULATED PLAYGROUND · 参数演示</span><h2>参数驱动的故障演示</h2><p>{turbine.turbine_id} · 仅用于交互体验，不是实时采集数据</p></div><span className="simulated-tag">SIMULATED · 拖动即推理</span></div><div className="demo-boundary"><Radio size={14} /> 下面的滑块是演示参数。真实传感器原始信号、处理过程和模型结果请进入“信号诊断”。</div><div className="diagnostic-layout"><div className="diagnostic-controls">{diagnosticFields.map(field => <label className="diagnostic-slider" key={field.key}><span><b>{field.label}</b><em>{params[field.key].toFixed(field.step < 1 ? 1 : 0)} {field.unit}</em></span><input style={{ '--slider-color': sliderTint(field, params[field.key]) } as CSSProperties} type="range" min={field.min} max={field.max} step={field.step} value={params[field.key]} onChange={event => onParamChange(field.key, Number(event.target.value))} /><small>安全范围 {field.normal[0]}–{field.normal[1]} {field.unit}</small></label>)}<button className="reset-diagnostic" onClick={onReset}><RotateCcw size={14} /> 一键重置参数</button></div><div className="diagnostic-result"><div className="ai-status-line"><span className={`ai-pulse ${diagnostic.level.toLowerCase()}`} />规则演示推理 <StatusBadge level={diagnostic.level} /></div><DiagnosticDiagram location={displayLocation} risk={diagnostic.risk} /><div className="diagnostic-summary"><strong>{displayLocation}</strong><span>演示置信度 {(diagnostic.risk * 100).toFixed(0)}% · 风险评分 {diagnostic.risk.toFixed(2)}</span><button className="locate-fault" onClick={onLocate}><Eye size={13} /> 在三维中定位</button></div><ConfidenceBars scores={diagnostic.scores} /></div></div><div className="diagnostic-history"><div><strong><History size={14} /> 最近演示</strong><span>{history.length ? `${history.length} 条` : '暂无记录'}</span></div>{history.slice(0, 3).map(item => <span key={`${item.at}-${item.risk}`}>{item.at} · {item.location} · {(item.risk * 100).toFixed(0)}%</span>)}</div></section>
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
  const [guidePlanClicked, setGuidePlanClicked] = useState(false)
  const [guideBubbleStyle, setGuideBubbleStyle] = useState<CSSProperties>({})
  const [guideMinimized, setGuideMinimized] = useState(false)
  const guideDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
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
      const saved = localStorage.getItem('windcare.turbineStates.v3')
      if (saved) setTurbineStates(JSON.parse(saved) as Record<string, TurbinePersistedState>)
    } catch {
      localStorage.removeItem('windcare.turbineStates')
    } finally {
      setTurbineStatesHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (turbineStatesHydrated && Object.keys(turbineStates).length) localStorage.setItem('windcare.turbineStates.v3', JSON.stringify(turbineStates))
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
  const activeCategory = selectedBase?.turbine_id === 'WT02' ? selectedFault.category : (selectedBase?.fault_category || selectedFault.category)
  const displayLocation = faultLocation(activeCategory)
  const eventRisk: Record<string, [number, number, Turbine['warning_level']]> = { 'B-53': [.76, 63.2, 'HIGH'], 'A-51': [.82, 58.4, 'HIGH'], 'A-0': [.61, 69.8, 'MEDIUM'], 'C-67': [.48, 76.2, 'MEDIUM'], 'C-81': [.71, 66.5, 'HIGH'] }
  const [eventFailureRisk, eventHealth] = eventRisk[faultEventId] || eventRisk['B-53']
  const caseAppliesToSelected = selectedBase?.turbine_id === 'WT02' && selectedBase.source === 'SIMULATED'
  const linkedRisk = caseAppliesToSelected ? Math.max(eventFailureRisk, diagnostic.risk) : Math.min(diagnostic.risk, selectedBase?.failure_risk ?? 0)
  const linkedWarning: Turbine['warning_level'] = linkedRisk >= .72 ? 'HIGH' : linkedRisk >= .42 ? 'MEDIUM' : linkedRisk >= .2 ? 'LOW' : 'NORMAL'
  const linkedHealth = caseAppliesToSelected ? Math.min(eventHealth, Math.max(0, 100 - linkedRisk * 42)) : Math.max(selectedBase?.health_index ?? 92, 100 - linkedRisk * 42)
  const healthCeiling = caseAppliesToSelected ? eventHealth : (selectedBase?.health_index ?? 92)
  const faultForSelected = selectedBase?.turbine_id === 'WT02' ? selectedFault : null
  // In demo mode the selected event is applied to whichever turbine is active,
  // so the guide can be demonstrated on WT01-WT08 instead of silently keeping
  // the WT02-only baseline.
  const selectedInitial = selectedBase ? { ...selectedBase, failure_risk: linkedRisk, health_index: linkedHealth, warning_level: caseAppliesToSelected ? linkedWarning : selectedBase.warning_level, anomaly_score: linkedRisk, ...(faultForSelected ? { event_id: Number(faultForSelected.id.split('-')[1]), event_name: faultForSelected.name, event_description: faultForSelected.description, component_label: faultForSelected.component, fault_category: faultForSelected.category } : {}) } : selectedBase
  const persistedSelected = selectedBase ? turbineStates[selectedBase.turbine_id] : undefined
  const selected = selectedInitial && persistedSelected?.status === 'maintained'
    ? { ...selectedInitial, failure_risk: 0, health_index: 92, warning_level: 'NORMAL' as Turbine['warning_level'], anomaly_score: 0 }
    : selectedInitial && persistedSelected?.fault
      ? { ...selectedInitial, failure_risk: persistedSelected.fault.risk, health_index: caseAppliesToSelected ? Math.min(healthCeiling, Math.max(0, 100 - persistedSelected.fault.risk * 42)) : healthCeiling, warning_level: persistedSelected.fault.risk >= .72 ? 'HIGH' as Turbine['warning_level'] : persistedSelected.fault.risk >= .42 ? 'MEDIUM' as Turbine['warning_level'] : 'LOW' as Turbine['warning_level'], anomaly_score: persistedSelected.fault.risk }
      : selectedInitial
  const diagnosticRecord = useMemo(() => selected ? buildDiagnosticRecord(selected, mode, displayLocation, selected.turbine_id === 'WT02' ? faultEventId : undefined) : null, [selected, mode, displayLocation, faultEventId])
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
    if (mode === 'demo' || mode === 'experiment') {
      setTurbines(demoTurbines); setSelectedId('WT02'); setError(''); setLoading(false); setApiPlan(null)
      setTurbineStates(current => {
        const next = { ...current }
        demoTurbines.forEach(turbine => {
          if (!next[turbine.turbine_id]) next[turbine.turbine_id] = { params: defaultDiagnosticParams, fault: turbine.warning_level === 'NORMAL' ? null : { component: turbine.component_label, confidence: turbine.failure_risk, risk: turbine.failure_risk, healthIndex: turbine.health_index }, status: turbine.warning_level === 'NORMAL' ? 'normal' : 'fault', maintenanceLog: [{ time: new Date().toLocaleTimeString(), action: '初始加载', detail: `CARE 数据集案例 ${turbine.turbine_id}`, result: '信息' }], loaded: true }
        })
        return next
      })
      setView(mode === 'experiment' ? 'signal' : 'overview'); setServiced(false); setMaintenanceRecordId(''); setRetests([]); setMaintenanceAttempts(0)
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
    if (guide.active && guide.step === 2 && view !== 'signal') setView('signal')
    if (guide.active && guide.step === 3 && view !== 'maintenance') setView('maintenance')
    if (guide.active && guide.step === 4 && view !== 'demo') setView('demo')
    if (guide.active && guide.step >= 5) setGuide(state => ({ ...state, step: 4 }))
  }, [guide.active, guide.step, guideInitialTurbine, selectedId, view])

  // Slider changes only reveal the completion button. They never advance the guide.

  useEffect(() => {
    const targetName = guide.step === 1 ? 'turbine-select'
      : guide.step === 2 ? 'signal-panel'
            : guide.step === 3 ? 'plan-cards'
              : guide.step === 4 ? 'slider-panel'
            : guide.step === 5 ? 'slider-panel' : ''
    document.querySelectorAll('.guide-target-highlight').forEach(element => element.classList.remove('guide-target-highlight'))
    if (!guide.active || !targetName) {
      setGuideBubbleStyle({})
      return
    }
    const targets = Array.from(document.querySelectorAll(`[data-guide-target="${targetName}"]`)) as HTMLElement[]
    if (!targets.length) return
      targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' })
      const timer = window.setTimeout(() => {
        targets.forEach(target => target.classList.add('guide-target-highlight'))
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
        setRetestPhase('result'); playConfirmSound(); logAction('维护完成，已生成复测结果')
      } catch (reason) { setError(reason instanceof Error ? reason.message : '维护请求失败'); setRetestPhase('idle') }
      finally { setLoading(false) }
    } else {
      await runRetestProgress()
      setAfterRetest(createRetestSnapshot(selectedPlan !== 'monitor' && maintenanceAttempts >= 1))
      if (selectedPlan === 'monitor' || decisionAction === 'CONTINUE_MONITORING') {
        setTurbineStates(current => current[selectedId] ? { ...current, [selectedId]: { ...current[selectedId], status: 'monitoring' } } : current)
      }
      setDecisionFeedback(decisionAction === 'CONTINUE_MONITORING' ? '你选择了继续监测，实际停机 0 h，当前不产生维修成本。' : `你选择了${decisionAction === 'SCHEDULE_MAINTENANCE' ? '预防性维护' : '现场检查'}，已进入复测流程。`)
      setRetestPhase('result'); playConfirmSound(); logAction('演示维护完成，已生成复测结果')
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
    ['第 1 步：选择风机', '点击风机编号，查看这台风机的运行状态、风险等级和当前故障部件。'],
    ['第 2 步：查看信号诊断', '先查看本次分析使用的信号和数据来源，再依次了解质量检查、预处理、特征计算和模型推理，最后查看诊断结论。'],
    ['第 3 步：维护决策', '现在已进入维护决策页面。请查看当前风险和人员、备件、天气、停机、吊装等条件，再比较可执行方案。'],
    ['第 4 步：参数演示', '拖动参数，查看仿真工况的变化。'],
  ] as const
  const startGuide = () => {
    setGuideInitialTurbine(selectedId)
    setGuidePlanClicked(false)
    setGuideMinimized(false)
    // Default placement follows the requested scene-center position: just
    // left of the inspector, clear of the scene title and right panel.
    setGuideBubbleStyle({ left: 'calc(50% - 280px)', top: 320, right: 'auto', transform: 'none' })
    setGuide({ active: true, step: 1 })
  }
  const closeGuide = () => {
    document.querySelectorAll('.guide-target-highlight').forEach(element => element.classList.remove('guide-target-highlight'))
    setGuide({ active: false, step: 0 })
    setGuidePlanClicked(false)
    setGuideMinimized(false)
    localStorage.setItem('guideCompleted', 'true')
  }
  // A card click is the meaningful user action. The selected plan may equal the
  // initially recommended value, so comparing values alone can leave the button inert.
  const guideDecisionChanged = guide.active && guide.step === 4 && guidePlanClicked && Boolean(decisionAction)
  const advanceGuide = () => {
    if (guide.active && guide.step === 2) setGuide(state => ({ ...state, step: 3 }))
    else if (guide.active && guide.step === 3) setGuide(state => ({ ...state, step: 4 }))
  }
  const confirmGuidePlan = () => {
    if (guide.active && guide.step === 4 && guideDecisionChanged) setGuide(state => ({ ...state, step: 5 }))
  }
  const startGuideDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    guideDragRef.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveGuideDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = guideDragRef.current
    if (!drag) return
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width || 300
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, drag.left + event.clientX - drag.x))
    const top = Math.max(8, Math.min(window.innerHeight - 80, drag.top + event.clientY - drag.y))
    setGuideBubbleStyle({ left, top, right: 'auto', transform: 'none' })
  }
  const stopGuideDrag = () => { guideDragRef.current = null }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Activity size={20} strokeWidth={2.2} /></span><span><strong>WindCare</strong><small>风电装备智能运维</small></span></div>
      <nav className="top-nav" aria-label="主导航"><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>风场总览</button><button className={view === 'signal' ? 'active' : ''} onClick={() => selected && setView('signal')} disabled={!selected}>信号诊断</button><button className={view === 'demo' ? 'active' : ''} onClick={() => selected && setView('demo')} disabled={!selected}>参数演示</button><button className={view === 'maintenance' ? 'active' : ''} onClick={openMaintenance} disabled={!selected}>维护决策</button></nav>
      <div className="top-actions"><div className="mode-switch" aria-label="数据模式"><button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>演示</button><button className={mode === 'experiment' ? 'active' : ''} onClick={() => setMode('experiment')}>实验</button><button className={mode === 'api' ? 'active' : ''} onClick={() => setMode('api')}>接口</button></div><button className={`utility-button ${engineeringView ? 'active' : ''}`} title="显示或关闭工程剖切视图" aria-label="工程剖切视图" aria-pressed={engineeringView} onClick={() => setEngineeringView(v => !v)}><Layers3 size={16} /><span>剖切视图</span></button><button className="utility-button" title="查看数据来源和证据边界" aria-label="数据来源说明" onClick={() => setShowSources(true)}><Database size={16} /><span>数据来源</span></button><button className="utility-button" title="查看操作引导" aria-label="查看引导" onClick={startGuide}><Activity size={16} /><span>查看引导</span></button></div>
    </header>

    <main className={`workspace workspace-${view} ${view === 'signal' ? 'workspace-signal' : view === 'demo' ? 'workspace-demo' : ''}`}>
      {guide.active && <div className="guide-overlay" aria-hidden="true" />}
      {guide.active && !guideMinimized && <div className={`guide-coach guide-coach-v2 ${guide.step === 4 ? 'guide-plan-step' : ''}`} style={guideBubbleStyle} role="dialog" aria-live="polite"><div className="guide-drag-handle" onPointerDown={startGuideDrag} onPointerMove={moveGuideDrag} onPointerUp={stopGuideDrag} onPointerCancel={stopGuideDrag}><strong>{guideCopy[guide.step - 1][0]}</strong><span>拖动此处移动</span></div><button className="guide-minimize" aria-label="最小化引导" title="最小化" onClick={() => setGuideMinimized(true)}>—</button><p>{guideCopy[guide.step - 1][1]}</p><div className="guide-actions">{guide.step === 2 && <button className="guide-next" onClick={advanceGuide}>查看结果，下一步</button>}{guide.step === 3 && <button className="guide-next" onClick={advanceGuide}>进入参数演示</button>}{guide.step === 4 && <button className="guide-next" onClick={closeGuide}>完成引导</button>}<button onClick={closeGuide}>跳过引导</button><button onClick={closeGuide}>关闭</button></div></div>}
      {guide.active && guideMinimized && <button className="guide-pill" onClick={() => setGuideMinimized(false)}>💡 引导进行中</button>}
      <section className="scene-panel" aria-label="风电场三维场景">
        <div className="scene-heading"><div><div className="eyebrow"><MapPin size={13} /> 风电场数字场景 <span className="source-tag">{mode === 'demo' ? '演示数据' : mode === 'experiment' ? 'Paderborn 实验数据' : '接口数据'}</span></div><h1>风场运行总览</h1><p>选择风机，查看状态与维护决策</p></div><div className="scene-weather"><CloudSun size={19} /><span>实时天气 <small>{weatherStatus}</small></span><b>{weather.wind.toFixed(1)} m/s · 浪 {weather.wave.toFixed(1)} m · 能见度 {weather.visibility.toFixed(1)} km</b></div></div>
        <WindScene turbines={turbines.map(t => t.turbine_id === selected?.turbine_id ? selected : t)} selectedId={selectedId} onSelect={selectTurbine} serviced={serviced} engineeringView={engineeringView} diagnosticFaultCategory={activeCategory} onOpenEngineering={() => setEngineeringView(true)} />
         {engineeringView && selected?.event_id && <div className="engineering-caption"><span className="engineering-caption-dot" />CARE v6 · {selected.event_name} <strong>{publicComponentLabel(selected.component_label)}</strong><small>项目 CAD 工程模型</small></div>}
         <div className="scene-bottom"><div className="scene-legend"><span><i className="legend-normal" />正常</span><span><i className="legend-low" />关注</span><span><i className="legend-high" />高风险</span></div></div>
      </section>

      <aside className="inspector" aria-label="风机信息">
        <div className="fleet-summary"><div><span>机组总数</span><strong>{turbines.length.toString().padStart(2, '0')}</strong></div><div><span>高风险</span><strong className="danger-text">{highCount.toString().padStart(2, '0')}</strong></div><div><span>当前选择</span><strong>{selected?.turbine_id || '--'}</strong></div></div>
        {error && <div className="error-banner" role="status"><AlertTriangle size={16} /><span>{error}</span><button title="关闭提示" aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div>}
        {loading && <div className="loading-state" role="status">正在连接接口...</div>}
        {!loading && !selected && <div className="empty-state"><Server size={28} /><h2>等待后端数据</h2><p>请启动 D 的 FastAPI 服务并确认风机接口可用，或切换至演示模式。</p><button onClick={() => setMode('demo')}>返回演示模式</button></div>}
        {selected && <>
          <div className="selector-row"><div><span className="section-kicker">设备状态</span><h2>{selected.turbine_id} <span>{selected.name}</span></h2></div>{persistedSelected?.status === 'monitoring' ? <span className="status-badge status-low">⚠ 故障未处理 · 继续监测中</span> : selected.has_analysis === false ? <span className="status-badge status-neutral">暂无分析结果</span> : <StatusBadge level={serviced ? 'NORMAL' : selected.warning_level} />}</div>
          <div className="turbine-tabs" data-guide-target="turbine-select" role="tablist" aria-label="选择风机">{turbines.map(t => <button role="tab" aria-selected={selectedId === t.turbine_id} className={selectedId === t.turbine_id ? 'selected' : ''} key={t.turbine_id} onClick={() => selectTurbine(t.turbine_id)}>{t.turbine_id}<i className={`level-${t.warning_level.toLowerCase()}`} /></button>)}</div>
           {view === 'signal' && diagnosticRecord ? <SignalPanel turbine={selected} record={diagnosticRecord} onLocate={() => { setEngineeringView(true); setView('overview') }} onMaintenance={openMaintenance} /> : view === 'demo' ? <DemoPanel turbine={selected} params={diagnosticParams} diagnostic={diagnostic} displayLocation={displayLocation} history={diagnosticHistory} onParamChange={updateDiagnosticParam} onReset={() => setDiagnosticParams(defaultDiagnosticParams)} onLocate={() => setEngineeringView(true)} /> : view === 'overview' ? <>
            {persistedSelected?.status === 'monitoring' && activeFault && <div className="monitoring-status-tag" role="status">⚠ 故障未处理 · 继续监测中</div>}
            <div className="reading-primary"><div className="reading-label"><Gauge size={18} /> 健康指数 <span title="与信号诊断共享同一 diagnosis_id">ⓘ</span></div><div className="reading-number">{selected.has_analysis === false ? '--' : serviced ? '待复测' : selected.health_index.toFixed(1)}{selected.has_analysis !== false && !serviced && <small>/ 100</small>}</div><div className="meter"><span style={{ width: selected.has_analysis === false || serviced ? '0%' : `${selected.health_index}%` }} className={selected.health_index < 70 ? 'meter-risk' : selected.health_index < 85 ? 'meter-warning' : 'meter-normal'} /></div><p>{selected.has_analysis === false ? '后端尚无该部件的 AI 分析结果。' : serviced ? '维护执行已记录，设备健康状态应由复测数据确认。' : selected.warning_level === 'HIGH' ? '状态持续偏离正常区间，建议进入维护评估。' : '当前状态以信号诊断结果为准。'}</p><small className="record-link">诊断记录 {diagnosticRecord?.diagnosisId} · 样本 {diagnosticRecord?.sampleId} · {diagnosticRecord?.source}</small></div>
            <div className="metric-grid"><div><span>异常分数</span><strong>{selected.has_analysis === false ? '--' : selected.anomaly_score.toFixed(2)}</strong><small>模型输出</small></div><div><span>风险评分</span><strong>{selected.has_analysis === false ? '--' : selected.failure_risk.toFixed(2)}</strong><small>0-1 指标，非校准概率</small></div><div><span>当前功率</span><strong>{selected.power_kw !== 0 ? selected.power_kw.toLocaleString() : '--'}<em> kW</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.power_kw !== 0 ? '运行示例' : '未提供'}</small></div><div><span>风速</span><strong>{selected.wind_ms !== 0 ? selected.wind_ms : '--'}<em> m/s</em></strong><small>{selected.source === 'DERIVED' ? 'CARE 派生' : selected.wind_ms !== 0 ? '运行示例' : '未提供'}</small></div></div>
            <div className="info-section"><div className="section-title"><h3>{selected.trend_label || '传感器趋势'}</h3><span>{selected.trend_unit || 'CARE telemetry'}</span></div><Sparkline values={selected.trend} level={selected.warning_level} /></div>
          <section className="ai-workbench" data-guide-target="slider-panel" aria-label="实时AI故障检测"><div className="workbench-title"><h3><Activity size={15} /> 实时 AI 故障检测</h3><span className="simulated-tag">SIMULATED · 拖动即推理</span></div><div className="diagnostic-layout"><div className="diagnostic-controls">{diagnosticFields.map(field => <label className="diagnostic-slider" key={field.key}><span><b>{field.label}</b><em>{diagnosticParams[field.key].toFixed(field.step < 1 ? 1 : 0)} {field.unit}</em></span><input style={{ '--slider-color': sliderTint(field, diagnosticParams[field.key]) } as CSSProperties} type="range" min={field.min} max={field.max} step={field.step} value={diagnosticParams[field.key]} onChange={event => updateDiagnosticParam(field.key, Number(event.target.value))} /><small>安全范围 {field.normal[0]}–{field.normal[1]} {field.unit}</small></label>)}<button className="reset-diagnostic" onClick={() => setDiagnosticParams(defaultDiagnosticParams)}><RotateCcw size={14} /> 一键重置参数</button></div><div className="diagnostic-result"><div className="ai-status-line"><span className={`ai-pulse ${diagnostic.level.toLowerCase()}`} />AI 推理完成 <StatusBadge level={diagnostic.level} /></div><DiagnosticDiagram location={displayLocation} risk={diagnostic.risk} /><div className="diagnostic-summary"><strong>{displayLocation}</strong><span>置信度 {(diagnostic.risk * 100).toFixed(0)}% · 风险评分 {diagnostic.risk.toFixed(2)}</span><button className="locate-fault" onClick={() => setEngineeringView(true)}><Eye size={13} /> 在三维中定位</button></div><ConfidenceBars scores={diagnostic.scores} /></div></div><div className="diagnostic-history"><div><strong><History size={14} /> 最近检测</strong><span>{diagnosticHistory.length ? `${diagnosticHistory.length} 条` : '暂无记录'}</span></div>{diagnosticHistory.slice(0, 3).map(item => <span key={`${item.at}-${item.risk}`}>{item.at} · {item.location} · ${(item.risk * 100).toFixed(0)}%</span>)}</div></section>
          <div className="event-selector" data-guide-target="slider-panel"><label htmlFor="wt02-event">{selectedId} 演示故障案例</label><select id="wt02-event" value={faultEventId} onChange={event => { const id = event.target.value; setFaultEventId(id); setDiagnosticParams(eventDiagnosticPresets[id] || defaultDiagnosticParams); logAction(`载入故障案例基线：${id}`) }}>{wt02FaultEvents.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select><small>选择一个预设，只用于载入对应的初始传感器参数；拖动滑块后，AI 演示会按当前参数重新计算。</small></div>
          <div className="component-line"><div className="component-symbol"><Settings2 size={18} /></div><div><strong>{publicComponentLabel(selected.component_label)}</strong><span>{selected.component_id} · {selectedFault.name}</span></div><ChevronDown size={17} /></div>
            <div className="overview-actions"><button className="secondary-action" onClick={() => setView('signal')}><Activity size={16} /> 查看信号诊断 <ArrowRight size={16} /></button><button className="primary-action" data-guide-target="enter-maintenance" disabled={!activeFault} title={!activeFault ? '当前设备无激活故障，无需维护' : '查看维护方案'} onClick={openMaintenance}><Wrench size={17} /> {activeFault ? '查看维护方案' : '设备正常，无需维护'} {activeFault && <ArrowRight size={17} />}</button></div>
          </> : <>
            <div className="decision-intro"><div className="decision-icon"><Wrench size={20} /></div><div><h3>维护决策</h3><p>{selected.turbine_id} · {publicComponentLabel(selected.component_label)}</p><small>诊断记录 {diagnosticRecord?.diagnosisId} · {diagnosticRecord?.source} · 先读风险信号，再核对窗口与人员，最后记录执行和复测</small></div></div>
            <div className="workbench-block"><div className="workbench-title"><h3>异常研判</h3><span>点击获取证据</span></div><div className="evidence-grid">
              <button onClick={() => openEvidence('evidence', '异常证据')}><Search size={15} />异常证据</button>
              <button onClick={() => openEvidence('trend', '传感器趋势')}><Activity size={15} />传感器趋势</button>
              <button onClick={() => openEvidence('history', '历史记录')}><History size={15} />历史记录</button>
              <button onClick={() => openEvidence('context', 'Event 51 说明')}><ClipboardList size={15} />Event 51 说明</button>
              <button onClick={() => openEvidence('review', '人工复核')}><ShieldCheck size={15} />请求人工复核</button>
            </div></div>
            <div className="evidence-panel">{evidencePanel === 'evidence' && <><strong>异常证据 · SIMULATED/DERIVED</strong><p>当前部件风险评分 {selected.failure_risk.toFixed(3)}，健康指数 {selected.health_index.toFixed(1)}。该评分用于相对排序，不是校准故障概率。</p></>}{evidencePanel === 'trend' && <><strong>{selected.trend_label || '传感器趋势'}</strong><Sparkline values={selected.trend} level={selected.warning_level} /><p>趋势来自 CARE telemetry；接口模式以 D 返回结果为准。</p></>}{evidencePanel === 'history' && <><strong>维护历史</strong><p>暂无可核验的历史维护记录。执行后将保留 plan_id、record_id 和复测状态。</p></>}{evidencePanel === 'context' && <><strong>CARE Version 6 · Event {selected.event_id || 51}</strong><p>当前场景为海上风场演示，部件为 {selected.component_label}。</p></>}{evidencePanel === 'review' && <><strong>人工复核请求已记录 · SIMULATED</strong><p>请工程人员确认数据来源和维护窗口；系统不会自动把复核视为故障确认。</p></>}</div>
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
          <div className="data-footnote"><span>{mode === 'demo' ? 'SIMULATED · 演示样例' : mode === 'experiment' ? 'EXTERNAL_PUBLIC · 留出集实验' : `${selected.source} · API`}</span><span>{mode === 'experiment' ? paderbornExperiment.modelVersion : `${selected.model_version} · ${selected.updated_at}`}</span></div>
        </>}
      </aside>
    </main>
    {decisionConfirm && <div className="modal-backdrop" onClick={() => setDecisionConfirm(null)}><section className="decision-confirm-modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}><h2>确认继续监测？</h2><p>当前故障预计 5 h 内恶化，维修成本可能从 0.8 万升至 8 万，并可能发生突发停机。</p><div><button className="secondary-action" onClick={() => setDecisionConfirm(null)}>返回选择</button><button className="primary-action" onClick={() => { setDecisionConfirm(null); chooseAction('CONTINUE_MONITORING') }}>确认继续监测</button></div></section></div>}
    {showSources && <div className="modal-backdrop" onClick={() => setShowSources(false)}><section className="source-modal" role="dialog" aria-modal="true" aria-label="数据来源说明" onClick={e => e.stopPropagation()}><div className="modal-head"><div><Database size={19} /><h2>数据来源说明</h2></div><button className="icon-button" title="关闭" aria-label="关闭" onClick={() => setShowSources(false)}><X size={18} /></button></div><p>当前演示模式中的风机数据、健康指数、风险评分、趋势和维护参数均为模拟样例，仅用于验证 C 模块的交互流程，不代表 CARE 数据集实测或 AI 模型结果。</p><p>八台演示风机均使用项目提供的 SolidWorks/STEP 工程模型转换版本。叶片、轮毂、塔筒、机舱、主轴、齿轮、轴承和发电机均绑定到模型中的CAD零件节点，不再使用旧外形模型或程序化内部零件作为正式显示对象。</p><p>接口模式读取 D 的风机与组件状态，并通过 <code>/api/maintenance/optimize</code>、<code>/api/maintenance/replan</code> 和 <code>/api/maintenance/execute</code> 完成维护决策闭环。映射状态为 <code>UNVERIFIED</code> 时保持中性部件名称。</p><p>风险评分默认作为 0-1 指标显示；若未完成概率校准，不称为“故障概率”。执行维护后需要后端提供复测结果，前端才会更新真实健康状态。</p><button className="modal-done" onClick={() => setShowSources(false)}>了解</button></section></div>}
  </div>
}



