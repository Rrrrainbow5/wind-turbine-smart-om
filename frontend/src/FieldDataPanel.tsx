import { useState } from 'react'
import { importFieldDiagnosis, type FieldDiagnosis } from './api'
import type { Turbine } from './data'
import './datasets.css'

export default function FieldDataPanel({ turbine, onRefresh, onLocate, onMaintenance, expanded = false }: {
  turbine?: Turbine; onRefresh: (id?: string) => Promise<void>; onLocate: () => void; onMaintenance: () => void; expanded?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const record = turbine?.field_diagnosis
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : '数据接入失败') }
    finally { setBusy(false) }
  }
  return <section className="dataset-panel field-data-panel">
    <h3>风场数据接入</h3>
    <p>采集 / 上传 → 信号诊断 → 三维定位 → 维护决策 → 维护记录 → 实测复测</p>
    <button disabled={busy} onClick={() => void run(async () => { await onRefresh(); setMessage('已同步后端最新诊断与机组状态。') })}>同步风场最新结果</button>
    <label>上传采集端诊断数据包<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      void run(async () => {
        if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB，请截取信号窗口。')
        const result: FieldDiagnosis = await importFieldDiagnosis(JSON.parse(await file.text()))
        await onRefresh(result.turbine_id)
        setMessage(`已接入 ${result.sample_id}，机组仪表盘、诊断与维护入口已更新。`)
      })
    }} /></label>
    <details><summary>采集系统如何对接</summary><p>采集端按 signal-analysis.v2 协议向 POST /api/diagnosis/analyze 提交机组编号、部件编号、原始通道、处理步骤及已注册模型的诊断结果。本入口接收并保存结果，不将上传动作冒充模型推理。后端校验机组/部件与模型来源。</p><p>只有原始波形时，可先通过下方信号分析入口计算特征。当前在线服务尚未加载诊断权重，不能自动诊断任意风场数据。</p></details>
    {busy && <p role="status">正在同步数据…</p>}{error && <p className="dataset-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {expanded && (record ? <>
      <h4>{record.event_name || record.diagnosis.predicted_class}</h4>
      <p>{record.sample_id} · {record.turbine_id} · {record.component_id}<br />{record.data_origin} · {record.diagnosis.model_version}</p>
      <div className="signal-steps"><span className="active">原始通道</span><span className={record.preprocessing.length ? 'active' : 'pending'}>预处理</span><span className={Object.keys(record.time_features).length ? 'active' : 'pending'}>特征</span><span className="active">诊断结果</span></div>
      {record.channels.map(channel => {
        const values = channel.samples
        const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
        const fs = record.sampling_rate_hz
        return <figure key={channel.name}><figcaption>{channel.name} · {channel.unit || '单位未提供'} · {channel.sensor_location || record.component_id}</figcaption>
          {values.length ? <svg viewBox="0 0 500 155" role="img" aria-label={`${channel.name}原始波形`}><path d="M48 15V125H480" fill="none" stroke="#718a96" /><polyline fill="none" stroke="#48c9d1" strokeWidth="1" points={values.map((value, i) => `${48 + i / Math.max(1, values.length - 1) * 432},${125 - (value - min) / range * 105}`).join(' ')} /><text x="0" y="22">{max.toPrecision(3)}</text><text x="0" y="125">{min.toPrecision(3)}</text><text x="48" y="148">0</text><text x="350" y="148">{fs ? `${((values.length - 1) / fs).toPrecision(3)} s` : `${values.length} 点`}</text></svg> : <p>原始数据为外部文件引用，未返回波形预览。</p>}
          <small>{channel.source_reference || '来源未提供'}</small></figure>
      })}
      <details open><summary>处理步骤与实际计算特征</summary>{record.preprocessing.map((step, i) => <p key={i}>{i + 1}. {step.name} · {step.method}</p>)}{!record.preprocessing.length && <p>采集端未提供处理步骤。</p>}<div className="signal-feature-grid">{Object.entries(record.time_features).map(([name, value]) => <div key={name}><span>{name}</span><strong>{value.toPrecision(4)}</strong></div>)}</div></details>
      <p>{record.diagnosis.rationale}</p><p>风险 {record.diagnosis.failure_risk.toFixed(3)} · 健康指数 {record.diagnosis.health_index.toFixed(1)} · 等级 {record.diagnosis.warning_level}</p>
      <details><summary>分类分数（未校准为故障概率）</summary>{Object.entries(record.diagnosis.class_probabilities).map(([name, score]) => <div className="dataset-score" key={name}><span>{name}</span><meter min={0} max={1} value={score} /><b>{score.toFixed(3)}</b></div>)}</details>
      {!turbine?.fault_category && <p>该结果尚无明确 CAD 部件对应，禁止用其他部件代替高亮。</p>}
      <button disabled={!turbine?.fault_category} onClick={onLocate}>三维定位</button><button onClick={onMaintenance}>进入维护决策</button>
    </> : <p>当前机组没有可追溯的通道诊断数据包。已有聚合状态仍在总览显示；接入数据包后，此处展示实际信号和诊断依据。</p>)}
  </section>
}
