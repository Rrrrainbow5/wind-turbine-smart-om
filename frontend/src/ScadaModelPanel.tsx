import artifact from './scada-three-branch.json'
import { careClassName, type CareCase } from './care'

export default function ScadaModelPanel({ sample, model, onModelChange }: { sample: CareCase; model: 'forest' | 'fusion'; onModelChange: (model: 'forest' | 'fusion') => void }) {
  const replay = (artifact.cases as Record<string, typeof artifact.cases[keyof typeof artifact.cases]>)[sample.sample_id]
  const fusion = model === 'fusion' && replay
  const probabilities = fusion ? replay.probabilities : sample.probabilities
  const scores = Object.entries(probabilities).filter(([label]) => label !== 'transformer').sort((a, b) => b[1] - a[1])
  const branches = ['统计特征 → XGBoost', '36×40 通道时序 → 1D CNN', '780 项通道相关性 → 关系网络']
  return <section className="care-process-step">
    <header><b>04</b><div><strong>模型推理与模型选择</strong><small>{fusion ? artifact.version : '随机森林 · 原有推理'}</small></div></header>
    <div className="model-view-switch" role="group" aria-label="推理模型选择">
      <button type="button" className={model === 'fusion' ? 'active' : ''} aria-pressed={model === 'fusion'} disabled={!replay} onClick={() => onModelChange('fusion')}>SCADA 三分支融合</button>
      <button type="button" className={model === 'forest' ? 'active' : ''} aria-pressed={model === 'forest'} onClick={() => onModelChange('forest')}>随机森林</button>
    </div>
    <p>切换用于比较同一窗口的模型输出，仅作用于本板块；设备状态、三维定位和维护流程继续采用原有随机森林结果。</p>
    {!replay && <p role="status">当前案例没有经过源文件核验的三分支回放，因此暂不提供切换；继续展示原有随机森林结果。</p>}
    {fusion ? <>
      <p>输入为连续 36 条、40 通道的十分钟 SCADA 聚合数据。三路模型已训练，以下为保存权重对当前窗口的实际计算回放，无需 64 kHz 振动数据，不使用 STFT。</p>
      <div className="hybrid-branches">{branches.map((name, index) => <div key={name}><b>0{index + 1} {name}</b><span>门控权重 {(replay.weights[index] * 100).toFixed(1)}% · 分支输出 {careClassName(artifact.classes[replay.branches[index].indexOf(Math.max(...replay.branches[index]))])}</span></div>)}<div className="hybrid-fusion"><b>门控融合 → {careClassName(replay.prediction)}</b><span>三路类别分数按当前窗口权重融合 · 已训练权重回放</span></div></div>
    </> : <p>窗口统计特征输入原有随机森林，以下展示其实际状态匹配度。切换至三分支可比较另一模型对同一窗口的结果。</p>}
    <div className="pipeline-score pipeline-score-large">{scores.map(([label, value]) => <div key={label}><em>{careClassName(label)}</em><span><i style={{ width: `${value * 100}%` }} /></span><b>{(value * 100).toFixed(1)}%</b></div>)}</div>
    {fusion && <details className="care-trace"><summary>验证说明与模型溯源</summary><p>三次初始化 Macro F1：16.59%、17.89%、15.15%，平均 16.54%；单独 XGBoost 平均 18.36%。尚未证明融合优于单分支。</p><p>样本：{sample.sample_id}</p><p>种子：{artifact.seed} · 保存权重计算回放</p><p>报告 SHA256：{artifact.report_sha256}</p><p>源文件 SHA256：{replay.source_sha256}</p></details>}
  </section>
}
