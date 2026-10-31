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
    <div className="care-title"><Database size={15} /><strong>CARE 多故障诊断</strong><span>{verified ? '后端重算' : '训练案例回放'}</span></div>
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
      <div className="care-method"><h3>计算方法 · SCADA 多故障模型</h3><p>36 条连续十分钟记录 → 6 小时窗口 → 连续传感器中位数、标准差、首尾变化 → 随机森林分类。</p><p>传感器缺失值由训练折中位数填充；按原始风机整体留出验证。</p><p>{careArtifact.training_windows} 个训练窗口 · {Object.keys(careArtifact.classes).length} 类状态 · 跨风机 Macro F1 {(careArtifact.evaluation.macro_f1 * 100).toFixed(1)}%</p></div>
      <div className="care-measurements">{measurements.map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value.toFixed(1)} <small>{unit}</small></strong></div>)}</div>
    <div className="care-waveform" aria-label="CARE 采样趋势波形"><div><strong>采样趋势波形</strong><small>36 个十分钟 SCADA 窗口 · 非高频振动原始波形</small></div><svg viewBox="0 0 360 80" preserveAspectRatio="none"><polyline points={sample.trend.map((value, index) => `${(index / Math.max(sample.trend.length - 1, 1)) * 360},${72 - ((value - Math.min(...sample.trend)) / Math.max(Math.max(...sample.trend) - Math.min(...sample.trend), 1)) * 58}`).join(' ')} /></svg></div>
      <details className="care-trace"><summary>样本和模型溯源</summary><p>风场 A · 原始机组 {sample.source_asset} · 事件 {sample.event_id}</p><p>{sample.start} 至 {sample.end} · {sample.row_count} 条记录</p><p>映射至演示风机，非该机组现场诊断。</p><p>{sample.sample_id}</p><p>{careArtifact.model_version}</p><p>模型 SHA256<br />{careArtifact.model_sha256}</p><p>源文件 SHA256<br />{sample.source_sha256}</p></details>
    </>}
  </section>
}
