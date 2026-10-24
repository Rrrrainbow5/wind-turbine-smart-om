import type { SourceKind, Turbine, WarningLevel } from './data'

interface ApiTurbine {
  turbine_id: string
  display_name?: string
  wind_farm?: string
  operational_status?: string
  data_origin?: SourceKind
}

interface ApiAiResult {
  diagnosis_id?: string
  sample_id?: string
  timestamp: string
  health_index: number
  anomaly_score: number
  failure_risk: number
  warning_level: WarningLevel
  model_version: string
  data_origin: SourceKind
}

export interface FieldDiagnosis {
  schema_version: 'signal-analysis.v2'
  diagnosis_id: string
  sample_id: string
  turbine_id: string
  component_id: string
  event_name?: string
  data_origin: SourceKind
  created_at: string
  sampling_rate_hz?: number
  channels: Array<{ name: string; unit: string; samples: number[]; source_reference?: string; sensor_location?: string }>
  preprocessing: Array<{ name: string; method: string }>
  time_features: Record<string, number>
  diagnosis: {
    model_version: string; predicted_class: string; component_key: string; mapping_status: string
    class_probabilities: Record<string, number>; uncertainty: number
    failure_risk: number; health_index: number; anomaly_score: number; warning_level: WarningLevel; rationale: string
  }
}

export function fetchFieldDiagnosis(id: string) {
  return request<FieldDiagnosis>(`/api/diagnosis/${encodeURIComponent(id)}`)
}

export async function importFieldDiagnosis(payload: unknown) {
  const row = payload as Partial<FieldDiagnosis> | null
  if (!row || row.schema_version !== 'signal-analysis.v2' || !row.diagnosis) throw new Error('请上传 signal-analysis.v2 诊断结果；原始波形请使用信号上传入口。')
  if (!['REAL', 'DERIVED', 'EXTERNAL_PUBLIC'].includes(row.data_origin || '')) throw new Error('现场入口不接受演示数据。')
  return request<FieldDiagnosis>('/api/diagnosis/analyze', { method: 'POST', body: JSON.stringify(payload) })
}

export function diagnosisCategory(row: FieldDiagnosis, componentName: string): Turbine['fault_category'] {
  if (row.diagnosis.mapping_status === 'UNMAPPED') return undefined
  const key = row.diagnosis.component_key.toLowerCase()
  if (key === 'gearbox') return 'GEARBOX'
  if (key === 'generator') return 'GENERATOR'
  if (key === 'drivetrain') return 'DRIVETRAIN'
  if (key === 'rotor_bearing') return 'ROTOR_BEARING'
  if (key === 'gearbox_bearing') return 'GEARBOX_BEARING'
  // A generic bearing prediction cannot identify its position by itself.
  if (key === 'bearing' && /转子|主轴|rotor|main.?shaft/i.test(componentName)) return 'ROTOR_BEARING'
  if (key === 'bearing' && /齿轮箱|gearbox/i.test(componentName)) return 'GEARBOX_BEARING'
  return undefined
}

interface ApiTurbineState {
  turbine_id: string
  component_id: string
  component_name: string
  mapping_status: string
  latest_ai_result: ApiAiResult | null
}

interface ApiTelemetry {
  turbine_id: string
  component_id: string
  active_power_kw: number | null
  available_power_kw: number | null
  wind_speed_ms: number | null
  trend: Array<Record<string, unknown>>
  bearing_temperature_c: number | null
  timestamp: string | null
  data_origin: SourceKind
  source_fields: string[]
  mapping_status?: string
  source_file?: string
}

export interface ApiCandidateAction {
  action: 'CONTINUE_MONITORING' | 'SCHEDULE_INSPECTION' | 'SCHEDULE_MAINTENANCE'
  available: boolean
  explanation: string
}

export interface ApiMaintenancePlan {
  plan_id: string
  turbine_id: string
  component_id: string
  recommended_action: ApiCandidateAction['action']
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  rationale: string
  requires_replan: boolean
  decision_origin: SourceKind
  conditions_origin: SourceKind
  candidates: ApiCandidateAction[]
  created_at: string
}

interface ApiMaintenanceRecord {
  record_id: string
  plan_id: string
  executed_at: string
  outcome: string
  data_origin: SourceKind
}

const locations: [number, number][] = [[-11, -5], [-3, 1], [6, -5], [13, 2]]
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, signal: init?.signal || AbortSignal.timeout(20000) })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`接口未到达 FastAPI（HTTP ${response.status}）。请启动后端；公网需配置 VITE_API_BASE_URL，GitHub Pages 不能运行后端。`)
  }
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`接口返回 ${response.status}${detail ? `：${detail.slice(0, 1000)}` : ''}`)
  }
  return response.json() as Promise<T>
}

export async function fetchTurbines(): Promise<Turbine[]> {
  const list = await request<ApiTurbine[]>('/api/turbines')
  if (!Array.isArray(list) || list.length === 0) throw new Error('风机列表为空或格式不正确')

  return Promise.all(list.slice(0, 8).map(async (item, index) => {
    const [states, telemetryRows] = await Promise.all([
      request<ApiTurbineState[]>(`/api/turbines/${encodeURIComponent(item.turbine_id)}/state`),
      request<ApiTelemetry[]>(`/api/turbines/${encodeURIComponent(item.turbine_id)}/telemetry`),
    ])
    const state = [...states].sort((a, b) => (Date.parse(b.latest_ai_result?.timestamp || '') || 0) - (Date.parse(a.latest_ai_result?.timestamp || '') || 0))[0]
    const latest = state?.latest_ai_result
    const diagnosis = latest?.diagnosis_id ? await fetchFieldDiagnosis(latest.diagnosis_id) : undefined
    const telemetry = telemetryRows.find(record => record.component_id === state?.component_id) || telemetryRows[0]
    const sensorTrend = telemetry?.trend
      ?.map(point => Number(point.rotor_bearing_temperature_2_c))
      .filter(value => Number.isFinite(value)) || []
    const verified = state?.mapping_status === 'VERIFIED'
    return {
      turbine_id: item.turbine_id,
      name: item.display_name || `${item.turbine_id} 机组`,
      position: locations[index % locations.length],
      warning_level: latest?.warning_level || 'NORMAL',
      health_index: latest?.health_index ?? 0,
      anomaly_score: latest?.anomaly_score ?? 0,
      failure_risk: latest?.failure_risk ?? 0,
      // Treat tiny negative sensor offsets as zero for display; preserve larger
      // negative values so genuine reverse power flow remains diagnosable.
      power_kw: telemetry?.active_power_kw != null && telemetry.active_power_kw < 0 && telemetry.active_power_kw > -0.01
        ? 0
        : telemetry?.active_power_kw ?? 0,
      wind_ms: telemetry?.wind_speed_ms ?? 0,
      component_id: state?.component_id || `${item.turbine_id}_COMPONENT_01`,
      component_label: diagnosis ? state.component_name : verified ? state.component_name : '待核验关键部件',
      mapping_status: state?.mapping_status || 'UNVERIFIED',
      has_analysis: Boolean(latest),
      updated_at: latest?.timestamp || '暂无分析结果',
      trend: sensorTrend,
      trend_label: sensorTrend.length ? '转子轴承温度 2' : '传感器趋势',
      trend_unit: sensorTrend.length ? '°C' : undefined,
      source: latest?.data_origin || telemetry?.data_origin || item.data_origin || 'REFERENCE',
      model_version: latest?.model_version || '未提供',
      field_diagnosis: diagnosis,
      ...(diagnosis ? {
        event_name: diagnosis.event_name || diagnosis.diagnosis.predicted_class,
        fault_category: diagnosisCategory(diagnosis, state.component_name),
      } : {}),
    }
  }))
}

function maintenanceBody(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, personnelAvailable = true, diagnosis?: FieldDiagnosis) {
  return {
    turbine_id: turbineId,
    component_id: componentId,
    maintenance_window_available: maintenanceWindowAvailable,
    personnel_available: personnelAvailable,
    decision_origin: 'DERIVED',
    conditions_origin: 'USER_INPUT',
    source_diagnosis_id: diagnosis?.diagnosis_id,
    source_sample_id: diagnosis?.sample_id,
    rule_version: 'trial-v0.1',
  }
}

export function optimizeMaintenance(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, personnelAvailable = true, diagnosis?: FieldDiagnosis) {
  return request<ApiMaintenancePlan>('/api/maintenance/optimize', {
    method: 'POST',
    body: JSON.stringify(maintenanceBody(turbineId, componentId, maintenanceWindowAvailable, personnelAvailable, diagnosis)),
  })
}

export function replanMaintenance(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, sourcePlanId: string, personnelAvailable = true, diagnosis?: FieldDiagnosis) {
  return request<ApiMaintenancePlan>('/api/maintenance/replan', {
    method: 'POST',
    body: JSON.stringify({
      ...maintenanceBody(turbineId, componentId, maintenanceWindowAvailable, personnelAvailable, diagnosis),
      source_plan_id: sourcePlanId,
      replan_trigger: maintenanceWindowAvailable ? 'maintenance_window_reopened' : 'weather_window_closed',
    }),
  })
}

export function executeMaintenance(planId: string) {
  return request<ApiMaintenanceRecord>('/api/maintenance/execute', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId,
      executed_at: new Date().toISOString(),
      outcome: 'Maintenance request recorded by WindCare C frontend',
      data_origin: 'USER_INPUT',
    }),
  })
}

export interface ApiRetest {
  retest_id: string
  record_id: string
  observed_at: string
  health_index: number
  failure_risk: number
  conclusion: string
  data_origin: SourceKind
}

export function fetchRetests(recordId: string) {
  return request<ApiRetest[]>(`/api/maintenance/records/${encodeURIComponent(recordId)}/retests`)
}
