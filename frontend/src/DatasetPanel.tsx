import { useEffect, useState } from 'react'
import { request } from './api'
import './datasets.css'
import SampleAssociation, { type BearingPart, type SampleMapping } from './SampleAssociation'

type Prediction = { sample_id: string; true_label: string; fault_class: string; confidence: number; source_sha256: string; class_probabilities: Record<string, number> }
type Report = { predictions: Prediction[]; model_version: string; metrics: { macro_f1: number; accuracy: number } }
type Channel = { name: string; unit: string; raw: number[]; processed: number[]; statistics: Record<string, number>; transforms: { fft: { frequency_hz: number[]; power_density: number[] }; stft: { time_s: number[]; frequency_hz: number[]; power_density: number[][] } } }
type Analysis = { sample_id: string; sampling_rate_hz: number; source_sha256: string; data_origin: string; source_reference: string; channels: Channel[] }
const label = (value: string) => ({ healthy: '健康轴承', bearing_inner_race: '轴承内圈损伤', bearing_outer_race: '轴承外圈损伤' }[value] || value)

function Plot({ values, axis, title, unit, xUnit }: { values: number[]; axis: number[]; title: string; unit: string; xUnit: string }) {
  const low = Math.min(...values), high = Math.max(...values), range = high - low || 1
  const points = values.map((v, i) => `${40 + i / Math.max(1, values.length - 1) * 430},${125 - (v - low) / range * 100}`).join(' ')
  return <figure><figcaption>{title} · {unit}</figcaption><svg viewBox="0 0 500 155" role="img" aria-label={title}><path d="M40 20V125H470" fill="none" stroke="#68818c" /><polyline points={points} fill="none" stroke="#45d4d0" strokeWidth="1" /><text x="0" y="24">{high.toPrecision(3)}</text><text x="0" y="125">{low.toPrecision(3)}</text><text x="40" y="147">{axis[0]?.toPrecision(3)}</text><text x="365" y="147">{axis.at(-1)?.toPrecision(3)} {xUnit}</text></svg></figure>
}

export default function DatasetPanel({ expanded = false, parts, onLocate }: { expanded?: boolean; parts: BearingPart[]; onLocate: (mapping: SampleMapping | null) => void }) {
  const [open, setOpen] = useState(expanded)
  useEffect(() => { if (expanded) setOpen(true) }, [expanded])
  const [base, setBase] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [sample, setSample] = useState(0)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [channel, setChannel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!base.trim()) return request<T>(path, init)
    const url = new URL(base)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请输入 HTTP / HTTPS 服务地址')
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, { ...init, signal: AbortSignal.timeout(20000) })
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('该地址没有返回 FastAPI JSON，请核对服务地址')
    if (!response.ok) throw new Error(`HTTP ${response.status}：${(await response.text()).slice(0, 500)}`)
    return response.json()
  }
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '请求失败') } finally { setBusy(false) } }
  const prediction = report?.predictions[sample]
  const selected = analysis?.channels[channel]
  return <section className="dataset-panel"><button className="secondary-action" onClick={() => setOpen(!open)} aria-expanded={open}>数据集接入 · 上传 / 实验查询</button>{open && <div>
    <h3>数据集工作台</h3><label>后端地址（本地开发可留空）<input placeholder="https://你的后端域名" value={base} onChange={e => { setBase(e.target.value); setReport(null); setAnalysis(null); onLocate(null) }} /></label>
    <p>默认自动连接数据服务，无需填写地址；仅调试其他服务时修改上方地址。</p>
    <button disabled={busy} onClick={() => run(async () => { onLocate(null); setAnalysis(null); setReport(null); setReport(await call<Report>('/api/datasets/experiments')); setSample(0) })}>加载 Paderborn 实验数据</button>
    <label className="dataset-upload">上传多通道 JSON（≤2 MB，每通道 16–4096 点）<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; void run(async () => { onLocate(null); setReport(null); setAnalysis(null); if (file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，请先截取信号窗口'); const body = await file.text(); JSON.parse(body); setAnalysis(await call<Analysis>('/api/datasets/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })); setChannel(0) }); e.target.value = '' }} /></label>
    <details><summary>上传格式与结果说明</summary><pre>{JSON.stringify({ sample_id: 'measurement-001', sampling_rate_hz: 64000, data_origin: 'EXTERNAL_PUBLIC', source_reference: '数据集名称 / 原始文件', channels: [{ name: 'vibration_1', unit: 'm/s²', samples: ['至少16个实际数值'] }] }, null, 2)}</pre><p>填写真实来源与通道单位。SCADA 聚合量不作为高频振动波形。新上传数据只计算信号特征；模型权重未部署时不生成故障结论。</p></details>
    {busy && <p role="status">正在连接并处理数据…</p>}{error && <p className="dataset-error" role="alert">{error}</p>}
    {report && prediction && <article><h4>接口已连接 · {report.predictions.length} 条留出评估记录</h4><select aria-label="实验样本" value={sample} onChange={e => setSample(Number(e.target.value))}>{report.predictions.map((row, i) => <option key={row.sample_id} value={i}>{row.sample_id}</option>)}</select><p>真实标签：{label(prediction.true_label)} · 预测：{label(prediction.fault_class)}</p>{Object.entries(prediction.class_probabilities).map(([name, score]) => <div className="dataset-score" key={name}><span>{label(name)}</span><meter min="0" max="1" value={score} /><b>{(score * 100).toFixed(2)}%</b></div>)}<p>总体 Macro-F1 {report.metrics.macro_f1.toFixed(4)} · Accuracy {report.metrics.accuracy.toFixed(4)}</p><small>{report.model_version} · 分类分数未校准 · 已保存评估查询，非实时推理</small><details><summary>来源哈希</summary><code>{prediction.source_sha256}</code></details></article>}
    {(prediction || analysis) && <SampleAssociation key={prediction ? `eval-${prediction.sample_id}` : `signal-${analysis!.sample_id}-${analysis!.source_sha256}`} parts={parts} onLocate={onLocate} evidence={prediction ? { sampleId: prediction.sample_id, hash: prediction.source_sha256, kind: 'evaluation', prediction: prediction.fault_class, source: 'Paderborn 留出实验评估' } : { sampleId: analysis!.sample_id, hash: analysis!.source_sha256, kind: 'signal', source: analysis!.source_reference }} />}
    {analysis && selected && <article><h4>{analysis.sample_id} · {analysis.data_origin}</h4><p>{analysis.source_reference} · {analysis.sampling_rate_hz} Hz</p><select aria-label="信号通道" value={channel} onChange={e => setChannel(Number(e.target.value))}>{analysis.channels.map((c, i) => <option key={c.name} value={i}>{c.name} ({c.unit})</option>)}</select><p>原始波形 → 线性去趋势 → Hann STFT / FFT → 特征；模型状态：未推理</p><Plot title="原始时域波形" values={selected.raw} axis={selected.raw.map((_, i) => i / analysis.sampling_rate_hz)} unit={selected.unit} xUnit="s" /><Plot title="预处理波形" values={selected.processed} axis={selected.processed.map((_, i) => i / analysis.sampling_rate_hz)} unit={selected.unit} xUnit="s" /><Plot title="功率谱密度（青色）" values={selected.transforms.fft.power_density} axis={selected.transforms.fft.frequency_hz} unit={`${selected.unit}²/Hz`} xUnit="Hz" /><Spectrogram channel={selected} /><div className="dataset-statistics">{Object.entries(selected.statistics).map(([key, value]) => <span key={key}>{key}<b>{value.toPrecision(4)}</b></span>)}</div><small>原始样本统计量，方差单位为 {selected.unit}²，峭度/偏度/峰值因子无量纲；其余单位为 {selected.unit}。</small><details><summary>上传文件 SHA-256</summary><code>{analysis.source_sha256}</code></details></article>}
  </div>}</section>
}

function Spectrogram({ channel }: { channel: Channel }) {
  const stft = channel.transforms.stft
  const logs = stft.power_density.map(frame => frame.map(value => 10 * Math.log10(Math.max(value, 1e-20))))
  const min = Math.min(...logs.flat()), max = Math.max(...logs.flat())
  return <figure><figcaption>STFT · {channel.unit}²/Hz · 对数色标 {min.toFixed(1)} 至 {max.toFixed(1)} dB（蓝低，黄高）</figcaption><svg viewBox="0 0 500 180" role="img" aria-label="STFT时频图">{logs.map((frame, t) => frame.map((value, f) => <rect key={`${t}-${f}`} x={40 + t / logs.length * 430} y={140 - (f + 1) / frame.length * 120} width={430 / logs.length + .2} height={120 / frame.length + .2} fill={`hsl(${240 - (value - min) / (max - min || 1) * 180} 80% 50%)`} />))}<text x="0" y="20">{stft.frequency_hz.at(-1)} Hz</text><text x="0" y="140">0 Hz</text><text x="40" y="166">{stft.time_s[0]?.toFixed(4)} s</text><text x="380" y="166">{stft.time_s.at(-1)?.toFixed(4)} s</text></svg></figure>
}
