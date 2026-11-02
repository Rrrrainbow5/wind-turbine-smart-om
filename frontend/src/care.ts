import artifact from './care-cases.json'
import type { Turbine } from './data'

export type CareCase = {
  id: string; sample_id: string; event_id: number; source_asset: number
  label: string; name: string; category: Turbine['fault_category'] | null; description: string
  start: string; end: string; row_count: number; source_sha256: string
  prediction: string; probabilities: Record<string, number>
  held_out_prediction: string; held_out_probabilities: Record<string, number>
  independent_class_assets: number; validation: string
  features: Array<number | null>; telemetry: Record<string, number>; trend: number[]
  trend_signal: string; trend_label: string; trend_unit: string
}

export const careArtifact = artifact
// The engineering CAD covers drivetrain and hydraulic assemblies only.
// Electrical-transformer events are excluded from the interactive workflow
// until an authoritative transformer CAD assembly is supplied.
export const careCases = (artifact.cases as CareCase[]).filter(sample => sample.prediction !== 'transformer')
export const careClassName = (key: string) => artifact.classes[key as keyof typeof artifact.classes]?.name || key
export const defaultCareCases: Record<string, string> = {
  WT01: 'A-24', WT02: 'A-10', WT03: 'A-3', WT04: 'A-51',
  WT05: 'A-22', WT06: 'A-0', WT07: 'A-0', WT08: 'A-26',
}
// Keep a deterministic representative per label, without selecting by prediction.
export const representativeCareCases = ['A-24', 'A-0', 'A-10', 'A-22', 'A-51']
  .map(id => careCases.find(sample => sample.id === id)!)

// These categories have verified target meshes in wind-turbine-engineering.glb.
const cadLocatableCategories = new Set<NonNullable<Turbine['fault_category']>>([
  'GEARBOX', 'GEARBOX_BEARING', 'GENERATOR', 'HYDRAULIC', 'ROTOR_BEARING', 'DRIVETRAIN',
])

export function applyCareCase(turbine: Turbine, id: string): Turbine {
  const sample = careCases.find(row => row.id === id)
  if (!sample) return turbine
  const risk = 1 - sample.probabilities.healthy
  const predicted = artifact.classes[sample.prediction as keyof typeof artifact.classes]
  const predictedCategory = predicted.category as Turbine['fault_category'] | null
  const cadLocatable = predictedCategory !== null && predictedCategory !== undefined && cadLocatableCategories.has(predictedCategory)
  const hasThreeDTarget = cadLocatable
  return {
    ...turbine, source: 'EXTERNAL_PUBLIC', model_version: artifact.model_version,
    care_case: sample, event_id: sample.event_id, event_name: sample.name,
    event_description: sample.description,
    component_label: predicted.name,
    component_id: hasThreeDTarget ? `${turbine.turbine_id}_${sample.prediction.toUpperCase()}` : `${turbine.turbine_id}_ELECTRICAL_STATE`,
    fault_category: hasThreeDTarget ? predictedCategory || undefined : undefined,
    failure_risk: risk, anomaly_score: risk, health_index: 100 * sample.probabilities.healthy,
    warning_level: sample.prediction === 'healthy' ? 'NORMAL' : risk >= .72 ? 'HIGH' : risk >= .42 ? 'MEDIUM' : risk >= .2 ? 'LOW' : 'NORMAL',
    has_analysis: true, mapping_status: cadLocatable ? 'CAD_VERIFIED' : 'UNIT_LEVEL_ONLY',
    power_kw: sample.telemetry.power_30_avg, wind_ms: sample.telemetry.wind_speed_3_avg,
    trend: sample.trend, trend_label: `${sample.trend_label} · 同一样本 6 小时`, trend_unit: sample.trend_unit,
    updated_at: sample.end,
  }
}
