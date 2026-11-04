import { useState } from 'react'
import artifact from './scada-three-branch.json'
import { careClassName, type CareCase } from './care'

export default function ScadaModelPanel({ sample }: { sample: CareCase }) {
  const [model, setModel] = useState<'forest' | 'fusion'>('forest')
  const replay = (artifact.cases as Record<string, typeof artifact.cases[keyof typeof artifact.cases]>)[sample.sample_id]
  const fusion = model === 'fusion' && replay
  const probabilities = fusion ? replay.probabilities : sample.probabilities
  const scores = Object.entries(probabilities).filter(([label]) => label !== 'transformer').sort((a, b) => b[1] - a[1])
  const branches = ['统计特征 → XGBoost', '36×40 通道时序 → 1D CNN', '780 项通道相关性 → 关系网络']
  return <section className="care-process-step">
    <header><b>04</b><div><strong>模型推理与模型选择</strong><small>{fusion ? artifact.version : '随机森林 · 原有推理'}</small></div></header>
    <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
      <button className="care-recompute" aria-pressed={model === 'forest'} onClick={() => setModel('forest')}>随机森林{model === 'forest' ? ' · 当前展示' : ''}</button>
      <button className="care-recompute" aria-pressed={model === 'fusion'} disabled={!replay} onClick={() => setModel('fusion')}>SCADA 三分支融合{model === 'fusion' ? ' · 当前展示' : ''}</button>
    </div>
    <p>切换用于比较同一窗口的模型输出，仅作用于本板块；设备状态、三维定位和维护流程继续采用原有随机森林结果。</p>
    {!replay && <p role="status">当前案例没有经过源文件核验的三分支回放，因此暂不提供切换；继续展示原有随机森林结果。</p>}
    {fusion ? <>
      <p>输入为连续 36 条、40 通道的十分钟 SCADA 聚合数据。三路模型已训练，以下为保存权重对当前窗口的实际计算回放，无需 64 kHz 振动数据，不使用 STFT。</p>
      <div className="care-preprocess-status">{branches.map((name, index) => <div key={name}><strong>{name}</strong><p>门控权重 {(replay.weights[index] * 100).toFixed(1)}% · 分支输出 {careClassName(artifact.classes[replay.branches[index].indexOf(Math.max(...replay.branches[index]))])}</p></div>)}</div>
      <p><strong>门控融合结果：{careClassName(replay.prediction)}</strong> · 数据集事件标签：{sample.name}</p>
      <p>这是训练案例回放，不是独立验证。跨风机留出测试 Macro F1：{(artifact.macro_f1 * 100).toFixed(2)}%，目前仅供研究，不能作为可靠自动诊断。</p>
      <p>三次初始化的门控融合 Macro F1 为 16.59%、17.89%、15.15%，平均 16.54%；单独 XGBoost 平均为 18.36%。目前没有证据证明融合优于单分支。</p>
      {replay.held_out_probabilities && <p>留出原机组后，同一窗口预测：{careClassName(artifact.classes[replay.held_out_probabilities.indexOf(Math.max(...replay.held_out_probabilities))])}。该结果与上方全量训练权重回放分别展示。</p>}
    </> : <p>窗口统计特征输入原有随机森林，以下展示其实际状态匹配度。切换至三分支可比较另一模型对同一窗口的结果。</p>}
    <div className="pipeline-score pipeline-score-large">{scores.map(([label, value]) => <div key={label}><em>{careClassName(label)}</em><span><i style={{ width: `${value * 100}%` }} /></span><b>{(value * 100).toFixed(1)}%</b></div>)}</div>
    {fusion && <details className="care-trace"><summary>三分支模型溯源</summary><p>样本：{sample.sample_id}</p><p>种子：{artifact.seed} · 保存权重计算回放</p><p>报告 SHA256：{artifact.report_sha256}</p><p>源文件 SHA256：{replay.source_sha256}</p></details>}
  </section>
}
