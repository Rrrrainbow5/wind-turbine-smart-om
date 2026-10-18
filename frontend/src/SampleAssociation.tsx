import { useEffect, useState } from 'react'

export type BearingPart = { turbineId: string; category: 'ROTOR_BEARING' | 'GEARBOX_BEARING'; label: string; count: number }
export type SampleEvidence = { sampleId: string; hash: string; kind: 'evaluation' | 'signal'; prediction?: string; source: string }
export type SampleMapping = { evidence: SampleEvidence; part: BearingPart }

export default function SampleAssociation({ evidence, parts, onLocate }: {
  evidence: SampleEvidence; parts: BearingPart[]; onLocate: (mapping: SampleMapping | null) => void
}) {
  const [turbineId, setTurbineId] = useState('')
  const [category, setCategory] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [review, setReview] = useState(false)
  const [checks, setChecks] = useState({ identity: false, sensor: false, inspection: false })
  const turbineIds = [...new Set(parts.map(part => part.turbineId))]
  const available = parts.filter(part => part.turbineId === turbineId)
  const part = available.find(item => item.category === category)
  useEffect(() => { onLocate(null) }, [evidence.sampleId, evidence.hash, onLocate])
  const clear = () => { setConfirmed(false); setReview(false); setChecks({ identity: false, sensor: false, inspection: false }); onLocate(null) }
  const damaged = evidence.kind === 'evaluation' && evidence.prediction !== 'healthy'
  return <article className="sample-association">
    <h4>关联机组与 CAD 轴承部件</h4>
    <p>当前样本：{evidence.sampleId} · {evidence.kind === 'evaluation' ? '实验评估结果' : '上传信号，尚未模型推理'}</p>
    <label>目标机组<select value={turbineId} onChange={event => { clear(); setTurbineId(event.target.value); setCategory('') }}><option value="">请选择机组</option>{turbineIds.map(id => <option key={id}>{id}</option>)}</select></label>
    <label>模型中已识别的轴承部件<select value={category} disabled={!turbineId} onChange={event => { clear(); setCategory(event.target.value) }}><option value="">请选择部件</option>{available.map(item => <option key={item.category} value={item.category}>{item.label} · {item.count} 个 CAD 节点</option>)}</select></label>
    {!parts.length && <p role="status">等待三维 CAD 加载并识别轴承节点；模型未加载时不提供虚构部件。</p>}
    <p>这是用户指定的展示关联，不证明该样本来自此风机，也不覆盖现场健康指数、遥测或维护记录。内圈/外圈损伤展示在轴承总成，不声称已识别独立滚道。</p>
    <button disabled={!part} onClick={() => { if (part) { setConfirmed(true); onLocate({ evidence, part }) } }}>确认关联并三维定位</button>
    {confirmed && part && <><p role="status">已关联 {part.turbineId} · {part.label}。{evidence.kind === 'signal' ? '黄色表示采集位置，不代表检测到故障。' : damaged ? '红色表示实验预测损伤的映射展示，不代表现场风险等级。' : '该实验样本预测为健康，不添加故障高亮。'}</p><button onClick={() => setReview(!review)}>维护评估 · {review ? '收起' : '展开'}</button></>}
    {review && confirmed && part && <div className="sample-review"><h4>样本关联维护评估</h4><p>{part.turbineId} · {part.label} · {evidence.sampleId}</p>
      <p>{evidence.kind === 'signal' ? '尚无模型诊断结论。先核验信号质量与采集来源，再进行诊断，不能据此认定设备损坏。' : damaged ? '实验预测提示轴承损伤。建议现场复核并补充振动、温度及润滑证据，不能仅凭试验台分类安排更换。' : '实验样本预测健康，不排除现场设备异常；是否维护仍需机组自身证据。'}</p>
      {([{ key: 'identity', text: '核对样本来源、采集时间与机组/部件身份' }, { key: 'sensor', text: '核对采样率、通道单位与传感器安装位置' }, { key: 'inspection', text: '现场复核振动、温度、润滑与异常声响' }] as const).map(item => <label key={item.key}><input type="checkbox" checked={checks[item.key]} onChange={event => setChecks(current => ({ ...current, [item.key]: event.target.checked }))} />{item.text}</label>)}
      <details open><summary>1. 核验证据与采集链路</summary><p>保留样本编号与 SHA-256，检查缺失、饱和与工况差异。安全：遵守海上作业许可，禁止未授权进入运行机舱。</p></details>
      <details><summary>2. 复核轴承与传动系统</summary><p>由工程人员检查润滑、紧固、温升及振动特征，必要时停机检测。安全：停机、上锁挂牌并确认旋转部件停止后才可接近。</p></details>
      <details><summary>3. 确认维护范围并安排复测</summary><p>现场确认后再制定维修工单，结合天气、船舶、人员和备件安排作业；维护后使用同工况数据复测。</p></details>
      <strong>{Object.values(checks).every(Boolean) ? '核对项已勾选；仍须工程人员确认，未创建维护工单。' : '待完成证据核对；当前仅为评估清单。'}</strong>
    </div>}
  </article>
}
