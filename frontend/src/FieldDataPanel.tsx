import { useEffect, useState } from 'react'
import { Activity, Database, Radio, Upload } from 'lucide-react'
import { inferCareScadaWindow, type FieldDiagnosis } from './api'
import type { Turbine } from './data'
import './datasets.css'

type UploadInfo = { fileName: string; receivedAt: string; runId: string; source: string; prediction?: string }

export default function FieldDataPanel({ turbine, onRefresh, onLocate, onMaintenance, expanded = false }: {
  turbine?: Turbine; onRefresh: (id?: string) => Promise<void>; onLocate: () => void; onMaintenance: () => void; expanded?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null)
  const [targetTurbineId, setTargetTurbineId] = useState(turbine?.turbine_id || '')
  const record = turbine?.field_diagnosis
  useEffect(() => {
    setTargetTurbineId(turbine?.turbine_id || '')
  }, [turbine?.turbine_id])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : '数据接入失败') }
    finally { setBusy(false) }
  }
  const submitSixHourWindow = (file: File) => void run(async () => {
    if (!targetTurbineId.trim()) throw new Error('请填写关联机组编号。')
    if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB；请仅保留最近 6 小时的 36 条 SCADA 记录。')
    const source = JSON.parse(await file.text()) as Record<string, unknown>
    const result = await inferCareScadaWindow({
      ...source,
      turbine_id: targetTurbineId.trim(),
      data_origin: source.data_origin || 'REAL',
      source_reference: source.source_reference || file.name,
    })
    await onRefresh(result.diagnosis.turbine_id)
    setUploadInfo({
      fileName: file.name, receivedAt: new Date().toLocaleString('zh-CN'),
      runId: result.diagnosis.diagnosis_id,
      source: `${result.diagnosis.data_origin} · ${result.model_version}`,
      prediction: result.prediction,
    })
    setMessage(`已完成近 6 小时数据推理，并更新 ${result.diagnosis.turbine_id} 的诊断、三维定位和维护流程。`)
  })

  return <section className="dataset-panel field-data-panel">
    <div className="field-entry-head"><div><span className="section-kicker">现场数据工作流</span><h3>上传数据或接入传感器</h3></div><span className="field-target">当前页面：{turbine?.turbine_id || '--'} · {turbine ? turbine.component_label : '等待接入'}</span></div>
    <p>近 6 小时数据 → 模型推理 → 信号诊断 → 三维定位 → 维护决策 → 执行记录与复测。接口模式与演示模式共用后续业务流程，区别仅在数据来源。</p>
    <div className="field-target-form"><label>关联机组编号<input value={targetTurbineId} onChange={event => setTargetTurbineId(event.target.value)} placeholder="例如 WT09" /></label><small>首次接入的新编号会注册为新机组；模型完成推理后自动关联齿轮箱、轴承、发电机或液压系统等对应部件。</small></div>
    <div className="dataset-entry-grid">
      <section><strong><Upload size={15} /> 方式一：上传近 6 小时 SCADA</strong><p>上传最近 36 条连续十分钟记录。系统在后端构建窗口特征并运行已部署的五类 CARE 状态模型。</p><label className="dataset-upload">选择 JSON 数据包<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) submitSixHourWindow(file) }} /></label></section>
      <section><strong><Radio size={15} /> 方式二：实时采集端接入</strong><p>采集网关保留最新 36 条记录后，向同一接口持续发送；每次提交都会更新对应机组的诊断与运维闭环。</p><code>POST /api/care/field-infer</code><small>请求体与上传文件相同。机组和部件由采集端登记，页面按该记录同步展示。</small></section>
    </div>
    <details><summary>近 6 小时数据包格式与模型边界</summary><p>当前已部署模型只适用于与 CARE 风场 A 一致的连续 SCADA 字段语义：36 条、每条间隔 10 分钟、共 40 个连续信号字段。它不是高采样振动波形模型，也不能把缺字段或不同口径的现场文件强行判断为故障。</p><pre>{JSON.stringify({ sample_id: 'SCADA-WT02-20261102T1200', source_reference: '风场采集系统/导出批次', data_origin: 'REAL', rows: [{ time_stamp: '2026-11-02T06:10:00+08:00', signals: { sensor_0_avg: '... 共40个CARE字段 ...', wind_speed_3_avg: '...', power_30_avg: '...' } }, '... 共36条连续记录 ...'] }, null, 2)}</pre><p>提交时，页面当前选中的机组与部件将作为关联对象；模型类别只提供候选部件方向，三维定位仍保留工程核验语义。</p></details>
    <button disabled={busy} onClick={() => void run(async () => { await onRefresh(); setMessage('已同步后端最新诊断与机组状态。') })}><Activity size={14} /> 同步当前风场结果</button>
    {busy && <p role="status">正在校验数据并完成模型推理…</p>}{error && <p className="dataset-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {uploadInfo && <div className="dataset-run-info"><strong>本次现场分析</strong><span>文件：{uploadInfo.fileName}</span><span>诊断运行编号：{uploadInfo.runId}</span><span>来源：{uploadInfo.source}</span><span>接入时间：{uploadInfo.receivedAt}</span>{uploadInfo.prediction && <b>当前模型结果：{uploadInfo.prediction}。已同步到三维定位和维护决策。</b>}</div>}
    {expanded && (record ? <FieldDiagnosisDetail record={record} onLocate={onLocate} onMaintenance={onMaintenance} /> : <p>当前机组尚未导入可追溯的近 6 小时数据包。完成上传后，这里会展示同一诊断记录的采样趋势、处理步骤、特征、分类结果与维护入口。</p>)}
  </section>
}

function FieldDiagnosisDetail({ record, onLocate, onMaintenance }: { record: FieldDiagnosis; onLocate: () => void; onMaintenance: () => void }) {
  return <article className="field-diagnosis-detail"><h4>{record.event_name || record.diagnosis.predicted_class}</h4><p>{record.sample_id} · {record.turbine_id} · {record.component_id}<br />{record.data_origin} · {record.diagnosis.model_version}</p>
    <div className="signal-steps"><span className="active">原始采集</span><span className={record.preprocessing.length ? 'active' : 'pending'}>预处理</span><span className={Object.keys(record.time_features).length ? 'active' : 'pending'}>特征构建</span><span className="active">模型推理</span></div>
    {record.channels.map(channel => <ScadaTrend key={channel.name} channel={channel} rate={record.sampling_rate_hz} />)}
    <details open><summary>处理步骤与实际计算特征</summary>{record.preprocessing.map((step, index) => <p key={index}>{index + 1}. {step.name} · {step.method}</p>)}<div className="signal-feature-grid">{Object.entries(record.time_features).map(([name, value]) => <div key={name}><span>{name}</span><strong>{value.toPrecision(4)}</strong></div>)}</div></details>
    <p>{record.diagnosis.rationale}</p><p>健康指数 {record.diagnosis.health_index.toFixed(1)} · 异常分数 {record.diagnosis.anomaly_score.toFixed(3)} · 状态匹配度 {record.diagnosis.failure_risk.toFixed(3)} · 等级 {record.diagnosis.warning_level}</p>
    <details><summary>各状态匹配度</summary>{Object.entries(record.diagnosis.class_probabilities).map(([name, score]) => <div className="dataset-score" key={name}><span>{name}</span><meter min={0} max={1} value={score} /><b>{score.toFixed(3)}</b></div>)}</details>
    <p className="field-mapping-note">三维定位依据：模型状态类别与本次所选部件的候选关联；请在现场检修时完成部件核验。</p>
    <button onClick={onLocate}><Database size={14} /> 三维定位</button><button onClick={onMaintenance}>进入维护决策</button>
  </article>
}

function ScadaTrend({ channel, rate }: { channel: FieldDiagnosis['channels'][number]; rate?: number }) {
  const values = channel.samples
  if (!values.length) return <p>原始数据为外部文件引用，未返回趋势预览。</p>
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  return <figure><figcaption>{channel.name} · {channel.unit || '单位未提供'} · {channel.sensor_location || '采集通道'}</figcaption><svg viewBox="0 0 500 155" role="img" aria-label={`${channel.name}近6小时趋势`}><path d="M48 15V125H480" fill="none" stroke="#718a96" /><polyline fill="none" stroke="#48c9d1" strokeWidth="1" points={values.map((value, index) => `${48 + index / Math.max(1, values.length - 1) * 432},${125 - (value - min) / range * 105}`).join(' ')} /><text x="0" y="22">{max.toPrecision(3)}</text><text x="0" y="125">{min.toPrecision(3)}</text><text x="48" y="148">窗口起点</text><text x="350" y="148">{rate ? '6 小时窗口终点' : `${values.length} 点`}</text></svg><small>{channel.source_reference || '来源未提供'}</small></figure>
}
