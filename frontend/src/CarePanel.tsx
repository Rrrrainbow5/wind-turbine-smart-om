import { useState } from 'react'
import { Database, RotateCcw } from 'lucide-react'
import { request } from './api'
import ScadaModelPanel from './ScadaModelPanel'
import { careArtifact, careCases, representativeCareCases, careClassName, type CareCase } from './care'

export function CareSelector({ value, turbineId, onChange }: { value: string; turbineId: string; onChange: (id: string) => void }) {
  const label = careCases.find(sample => sample.id === value)?.label
  const representative = representativeCareCases.find(sample => sample.label === label)
  return <div className="care-selector"><label htmlFor="care-case">{turbineId} · 经典案例</label><select id="care-case" value={representative?.id || value} onChange={event => onChange(event.target.value)}>{representativeCareCases.map(sample => <option key={sample.id} value={sample.id}>{sample.name}</option>)}</select></div>
}

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 }
const standardDeviation = (values: number[]) => { const mean = values.reduce((total, value) => total + value, 0) / values.length; return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length) }
const points = (values: number[], width: number, height: number) => { const low = Math.min(...values); const span = Math.max(Math.max(...values) - low, 1); return values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - 8 - ((value - low) / span) * (height - 16)}`).join(' ') }

export default function CarePanel({ sample, turbineId, expanded = false }: { sample: CareCase; turbineId: string; expanded?: boolean }) {
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [verified, setVerified] = useState(false)
  const recompute = async () => {
    setBusy(true); setStatus('')
    try {
      const result = await request<{ prediction: string; model_sha256: string; probabilities: Record<string, number> }>(`/api/care/cases/${sample.id}/infer`, { method: 'POST' })
      if (result.model_sha256 !== careArtifact.model_sha256 || result.prediction !== sample.prediction || Object.entries(sample.probabilities).some(([key, value]) => Math.abs(result.probabilities[key] - value) > 1e-9)) throw new Error('后端模型或结果与当前案例不一致，请同步训练产物。')
      setVerified(true); setStatus('后端已重新计算，结果与离线记录一致。')
    } catch (error) { setVerified(false); setStatus(error instanceof Error ? error.message : '推理接口暂不可用，当前仍为离线记录。') } finally { setBusy(false) }
  }
  const telemetry = sample.telemetry
  const measurements = [
    ['环境温度', 'sensor_0_avg', telemetry.sensor_0_avg, '°C'], ['齿轮箱油温', 'sensor_12_avg', telemetry.sensor_12_avg, '°C'],
    ['发电机轴承温度', 'sensor_13_avg', telemetry.sensor_13_avg, '°C'], ['液压油温', 'sensor_41_avg', telemetry.sensor_41_avg, '°C'],
    ['风速', 'wind_speed_3_avg', telemetry.wind_speed_3_avg, 'm/s'],
  ] as const
  const finalMatches = sample.prediction === sample.label
  const featureEvidence = [
    ['中位数', median(sample.trend), sample.trend_unit, sample.trend_signal, `${sample.row_count}条窗口`],
    ['标准差', standardDeviation(sample.trend), sample.trend_unit, sample.trend_signal, `${sample.row_count}条窗口`],
    ['首尾变化', sample.trend.at(-1)! - sample.trend[0], sample.trend_unit, sample.trend_signal, `${sample.start.slice(11)} → ${sample.end.slice(11)}`],
  ] as const
  const scores = Object.entries(sample.probabilities).filter(([label]) => label !== 'transformer').sort((a, b) => b[1] - a[1])
  return <section className="care-results" aria-label="CARE 多故障训练结果">
    <div className="care-title" data-guide-target="signal-start"><Database size={15} /><strong>信号诊断 · {turbineId} · 目标机组</strong><span>{verified ? '后端重算' : '训练案例回放'}</span></div>
    <div className="care-signal-meta"><span>当前样本 <b>{sample.sample_id}</b></span><span>来源 <b>CARE Wind Farm A · 原机组 {sample.source_asset}</b></span><span>窗口 <b>{sample.row_count} 条 · 每 10 min · 共 6 h</b></span></div>
    <div className="care-pipeline" aria-label="信号处理流程">
      <div className="done"><b>01</b><span>原始采集</span><small>SCADA 十分钟聚合</small><svg viewBox="0 0 220 54" preserveAspectRatio="none"><polyline points={points(sample.trend, 220, 54)} /></svg></div><i />
      <div className="done"><b>02</b><span>预处理</span><small>质量检查 · 缺失填补</small><svg viewBox="0 0 220 54" preserveAspectRatio="none"><polyline className="temp-a" points={points(sample.trend, 220, 54)} /></svg></div><i />
      <div className="done"><b>03</b><span>特征提取</span><small>中位数 · 标准差 · 首尾变化</small><div className="feature-bars">{featureEvidence.map(([, value], index) => <i key={index} title={value.toFixed(2)} style={{ height: `${Math.min(90, 32 + Math.abs(value) * 4)}%` }} />)}</div></div><i />
      <div className="active"><b>04</b><span>模型推理</span><small>随机森林状态分类</small><div className="pipeline-score">{scores.slice(0, 3).map(([label, value]) => <div key={label}><em>{careClassName(label)}</em><span><i style={{ width: `${value * 100}%` }} /></span><b>{(value * 100).toFixed(0)}%</b></div>)}</div></div>
    </div>
    <article className={`care-prediction-single ${finalMatches ? 'match' : 'mismatch'}`}><small>当前案例诊断结果</small><strong>{careClassName(sample.prediction)}</strong><p>数据集事件标签：{sample.name}</p><b>{finalMatches ? '诊断结果与事件标签一致' : '诊断结果已记录'}</b></article>
    <p className="care-label-note">事件标签、分析窗口与模型版本均已关联到当前诊断记录，支持从结果回溯至对应数据来源。</p>
    <div className="care-scores">{scores.map(([label, value]) => <div key={label}><span>{careClassName(label)}</span><meter min={0} max={1} value={value} /><b>{(value * 100).toFixed(1)}%</b></div>)}</div>
    <small className="care-provenance">模型输出各状态的匹配度；健康指数由当前诊断的正常状态匹配度换算生成。</small>
    <button className="care-recompute" onClick={() => void recompute()} disabled={busy}><RotateCcw size={14} className={busy ? 'care-spin' : ''} />{busy ? '正在计算…' : '后端重新推理'}</button>{status && <p className="care-provenance" role="status">{status}</p>}
    {expanded && <>
      <div className="care-method"><h3>信号处理与模型推理过程</h3>
        <section className="care-process-step"><header><b>01</b><div><strong>原始采集</strong><small>{sample.trend_label} · {sample.trend_signal} · {sample.trend_unit}</small></div></header><p>读取 {sample.row_count} 条连续 SCADA 记录，按10分钟间隔组成6小时分析窗口。</p><div className="care-waveform care-waveform-large"><div><strong>原始采样趋势</strong><small>{sample.start} 至 {sample.end}</small></div><svg viewBox="0 0 720 150" preserveAspectRatio="none"><line x1="0" y1="30" x2="720" y2="30" /><line x1="0" y1="75" x2="720" y2="75" /><line x1="0" y1="120" x2="720" y2="120" /><polyline points={points(sample.trend, 720, 150)} /></svg><div className="wave-axis"><span>{sample.start}</span><span>{sample.end}</span></div></div></section>
        <section className="care-process-step"><header><b>02</b><div><strong>预处理</strong><small>质量检查、时间对齐与缺失值处理</small></div></header><p>对采集窗口进行时间排序、有效性检查与中位数填补，形成可用于特征计算的标准化输入。</p><div className="care-preprocess-status"><span>记录完整性</span><b>{sample.row_count} / {sample.row_count} 条</b><span>时间窗长度</span><b>6 小时连续窗口</b><span>处理输出</span><b>标准化时序特征</b></div></section>
        <section className="care-process-step"><header><b>03</b><div><strong>特征提取</strong><small>有名称、有数值、有来源</small></div></header><p>对清洗后的窗口计算稳健统计特征。下表展示当前趋势通道的可核验特征；其他连续通道执行相同计算。</p><div className="care-feature-table"><div className="head"><span>特征</span><span>数值</span><span>来源字段</span><span>计算范围</span></div>{featureEvidence.map(([name, value, unit, field, range]) => <div key={name}><b>{name}</b><strong>{value.toFixed(2)} {unit}</strong><code>{field}</code><span>{range}</span></div>)}</div></section>
        <ScadaModelPanel key={sample.sample_id} sample={sample} />
      </div>
      <div className="care-step-data"><h4>采集数据摘要</h4><p className="care-summary-note"><code>*_avg</code> 表示数据源中的10分钟平均字段；页面按6小时分析窗口汇总展示各传感器的中位数与趋势特征。</p><div className="care-measurements">{measurements.map(([label, field, value, unit]) => <div key={label}><span>{label}</span><strong>{value.toFixed(1)} <small>{unit}</small></strong><code>{field}</code></div>)}</div><div className="care-raw-data"><div className="care-raw-head"><strong>分析字段说明</strong><small>6小时窗口统计</small></div><table><thead><tr><th>字段</th><th>窗口中位数</th><th>单位</th><th>含义</th></tr></thead><tbody>{measurements.slice(1, 3).concat(measurements.slice(5)).map(([label, field, value, unit]) => <tr key={field}><td>{field}</td><td>{value.toFixed(1)}</td><td>{unit}</td><td>{label}</td></tr>)}</tbody></table></div></div>
      <details className="care-trace"><summary>样本和模型溯源</summary><p>风场 A · 原机组 {sample.source_asset} · 事件 {sample.event_id}</p><p>{sample.start} 至 {sample.end} · {sample.row_count} 条记录</p><p>映射至演示风机，非该机组现场诊断。</p><p>{sample.sample_id}</p><p>{careArtifact.model_version}</p><p>模型 SHA256<br />{careArtifact.model_sha256}</p><p>源文件 SHA256<br />{sample.source_sha256}</p></details>
    </>}
  </section>
}
