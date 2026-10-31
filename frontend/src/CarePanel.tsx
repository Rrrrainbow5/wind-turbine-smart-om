import { useState } from 'react'
import { Database, RotateCcw } from 'lucide-react'
import { request } from './api'
import { careArtifact, careCases, representativeCareCases, careClassName, type CareCase } from './care'

export function CareSelector({ value, turbineId, onChange }: { value: string; turbineId: string; onChange: (id: string) => void }) {
  const label = careCases.find(sample => sample.id === value)?.label
  const representative = representativeCareCases.find(sample => sample.label === label)
  return <div className="care-selector">
    <label htmlFor="care-case">{turbineId} · 经典案例</label>
    <select id="care-case" value={representative?.id || value} onChange={event => onChange(event.target.value)}>
      {representativeCareCases.map(sample => <option key={sample.id} value={sample.id}>{sample.name}</option>)}
    </select>
  </div>
}

export default function CarePanel({ sample, turbineId, expanded = false }: { sample: CareCase; turbineId: string; expanded?: boolean }) {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const recompute = async () => {
    setBusy(true); setStatus('')
    try {
      const result = await request<{ prediction: string; model_sha256: string; probabilities: Record<string, number> }>(
        `/api/care/cases/${sample.id}/infer`, { method: 'POST' },
      )
      if (result.model_sha256 !== careArtifact.model_sha256 || result.prediction !== sample.prediction
        || Object.entries(sample.probabilities).some(([key, value]) => Math.abs(result.probabilities[key] - value) > 1e-9)) {
        throw new Error('后端模型或结果与当前案例不一致，请同步训练产物。')
      }
      setVerified(true); setStatus('后端已重新计算，结果与离线记录一致。')
    } catch (error) {
      setVerified(false); setStatus(error instanceof Error ? error.message : '推理接口暂不可用，当前仍为离线记录。')
    } finally { setBusy(false) }
  }
  const telemetry = sample.telemetry
  const measurements = [
    ['环境温度', telemetry.sensor_0_avg, '°C'], ['齿轮箱油温', telemetry.sensor_12_avg, '°C'],
    ['发电机轴承温度', telemetry.sensor_13_avg, '°C'], ['液压油温', telemetry.sensor_41_avg, '°C'],
    ['变压器温度 L1', telemetry.sensor_38_avg, '°C'], ['风速', telemetry.wind_speed_3_avg, 'm/s'],
  ] as const
  return <section className="care-results" aria-label="CARE 多故障训练结果">
    <div className="care-title"><Database size={15} /><strong>信号诊断 · {turbineId} · {turbineId === 'WT02' ? '二号机组' : '目标机组'}</strong><span>{verified ? '后端重算' : '训练案例回放'}</span></div>
    <div className="care-signal-meta"><span>当前样本 <b>{sample.sample_id}</b></span><span>来源 <b>CARE Wind Farm A · 机组 {sample.source_asset}</b></span><span>窗口 <b>{sample.row_count} 条 · 每 10 min</b></span></div>
    <div className="care-pipeline" aria-label="信号处理流程"><div className="done"><b>01</b><span>原始采集</span><small>SCADA 多通道</small><svg viewBox="0 0 220 54" preserveAspectRatio="none"><polyline points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 220},${48 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 38}`).join(' ')} /></svg></div><i /><div className="done"><b>02</b><span>预处理</span><small>缺失值填补 · 对齐</small><svg viewBox="0 0 220 54" preserveAspectRatio="none"><polyline className="temp-a" points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 220},${48 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 38}`).join(' ')} /><polyline className="temp-b" points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 220},${40 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 28}`).join(' ')} /></svg></div><i /><div className="done"><b>03</b><span>特征提取</span><small>中位数 · 标准差 · 趋势</small><div className="feature-bars">{[.42,.64,.53,.78,.58].map((height, index) => <i key={index} style={{ height: `${height * 100}%` }} />)}</div></div><i /><div className="active"><b>04</b><span>模型推理</span><small>多故障分类</small><div className="pipeline-score">{Object.entries(sample.probabilities).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, value]) => <div key={label}><em>{careClassName(label)}</em><span><i style={{ width: `${value * 100}%` }} /></span><b>{(value * 100).toFixed(0)}%</b></div>)}</div></div></div>
    <dl className="care-comparison">
      <div><dt>事件真实标签</dt><dd>{sample.name}</dd></div>
      <div><dt>最终模型预测</dt><dd>{careClassName(sample.prediction)}</dd></div>
      <div><dt>留出该风机后预测</dt><dd>{careClassName(sample.held_out_prediction)}</dd></div>
    </dl>
    {turbineId === 'WT05' && <>
      {sample.validation === 'single_asset_replay' && <p className="care-limitation">该类别仅来自一台原始风机，尚无跨风机识别验证。</p>}
      {sample.prediction === 'hydraulic' && <p className="care-limitation">三维标红液压制动总成中的泵、油箱及管路；类别映射不代表具体零件已确诊。</p>}
      {sample.prediction === 'transformer' && <p className="care-limitation">当前 CAD 未映射此部件，保留机组级状态标记。</p>}
    </>}
    <div className="care-scores">{Object.entries(sample.probabilities).sort((a, b) => b[1] - a[1]).map(([label, value]) =>
      <div key={label}><span>{careClassName(label)}</span><meter min={0} max={1} value={value} /><b>{(value * 100).toFixed(1)}%</b></div>)}</div>
    <small className="care-provenance">分类分数未校准；异常分数 = 1 − 正常分数，健康指数 = 正常分数 × 100。该指数不代表设备寿命或故障概率。</small>
    <button className="care-recompute" onClick={() => void recompute()} disabled={busy}><RotateCcw size={14} className={busy ? 'care-spin' : ''} />{busy ? '正在计算…' : '后端重新推理'}</button>
    {status && <p className="care-provenance" role="status">{status}</p>}
    {expanded && <>
      <div className="care-method"><h3>信号处理与推理过程</h3><p><b>采集：</b>读取 {sample.row_count} 条连续 SCADA 记录，按 10 分钟时间间隔组成 6 小时分析窗口。</p><div className="care-waveform care-waveform-large"><div><strong>原始采样趋势</strong><small>采集步骤 · 36 个窗口</small></div><svg viewBox="0 0 720 150" preserveAspectRatio="none"><line x1="0" y1="30" x2="720" y2="30" /><line x1="0" y1="75" x2="720" y2="75" /><line x1="0" y1="120" x2="720" y2="120" /><polyline points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 720},${132 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 104}`).join(' ')} /></svg><div className="wave-axis"><span>{sample.start}</span><span>{sample.end}</span></div></div><p><b>预处理：</b>按训练集统计量填补缺失值，对每个连续传感器计算中位数、标准差、首尾变化等稳健特征。</p><div className="care-chart-grid"><article><div><strong>预处理通道对齐</strong><small>°C · 同步窗口</small></div><svg viewBox="0 0 300 82" preserveAspectRatio="none"><polyline className="temp-a" points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 300},${74 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 58}`).join(' ')} /><polyline className="temp-b" points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 300},${62 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 42}`).join(' ')} /></svg></article></div><p><b>特征提取：</b>将清洗后的窗口转为中位数、标准差和首尾变化等稳健特征。</p><div className="feature-bars feature-bars-large">{[.42,.64,.53,.78,.58].map((height, index) => <i key={index} style={{ height: `${height * 100}%` }} />)}</div><p><b>模型：</b>将窗口特征输入随机森林多故障分类器，输出各故障类别分数，并以最高分作为当前预测。</p><div className="pipeline-score pipeline-score-large">{Object.entries(sample.probabilities).sort((a, b) => b[1] - a[1]).map(([label, value]) => <div key={label}><em>{careClassName(label)}</em><span><i style={{ width: `${value * 100}%` }} /></span><b>{(value * 100).toFixed(1)}%</b></div>)}</div><p><b>验证：</b>{careArtifact.training_windows} 个训练窗口 · {Object.keys(careArtifact.classes).length} 类状态 · 跨风机留出 Macro F1 {(careArtifact.evaluation.macro_f1 * 100).toFixed(1)}%。</p></div>
      <div className="care-measurements">{measurements.map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value.toFixed(1)} <small>{unit}</small></strong></div>)}</div>
    <div className="care-raw-data"><div className="care-raw-head"><strong>原始字段摘要</strong><small>当前接口提供的是窗口聚合值，原始逐行 CSV 未随样本打包</small></div><table><thead><tr><th>字段</th><th>窗口聚合值</th><th>单位</th><th>来源</th></tr></thead><tbody>{[['sensor_12_avg', telemetry.sensor_12_avg.toFixed(1), '°C', '齿轮箱油温'], ['sensor_13_avg', telemetry.sensor_13_avg.toFixed(1), '°C', '发电机轴承温度'], ['wind_speed_3_avg', telemetry.wind_speed_3_avg.toFixed(1), 'm/s', '风速'], ['power_30_avg', telemetry.power_30_avg.toFixed(1), 'kW', '输出功率']].map(([field, value, unit, label]) => <tr key={field}><td>{field}</td><td>{value}</td><td>{unit}</td><td>{label}</td></tr>)}</tbody></table></div>
      <details className="care-trace"><summary>样本和模型溯源</summary><p>风场 A · 原始机组 {sample.source_asset} · 事件 {sample.event_id}</p><p>{sample.start} 至 {sample.end} · {sample.row_count} 条记录</p><p>映射至演示风机，非该机组现场诊断。</p><p>{sample.sample_id}</p><p>{careArtifact.model_version}</p><p>模型 SHA256<br />{careArtifact.model_sha256}</p><p>源文件 SHA256<br />{sample.source_sha256}</p></details>
    </>}
  </section>
}
