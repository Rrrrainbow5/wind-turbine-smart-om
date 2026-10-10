import type { SourceKind, Turbine, WarningLevel } from './data'

interface ApiTurbine {
  turbine_id: string
  display_name?: string
  wind_farm?: string
  operational_status?: string
  data_origin?: SourceKind
}

interface ApiAiResult {
  timestamp: string
  health_index: number
  anomaly_score: number
  failure_risk: number
  warning_level: WarningLevel
  model_version: string
  data_origin: SourceKind
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${apiBase}${path}`, { ...init, headers })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`接口返回 ${response.status}${detail ? `：${detail}` : ''}`)
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
    const state = states.find(record => record.latest_ai_result) || states[0]
    const latest = state?.latest_ai_result
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
      power_kw: telemetry?.active_power_kw ?? 0,
      wind_ms: telemetry?.wind_speed_ms ?? 0,
      component_id: state?.component_id || `${item.turbine_id}_COMPONENT_01`,
      component_label: verified ? state.component_name : '待核验关键部件',
      mapping_status: state?.mapping_status || 'UNVERIFIED',
      has_analysis: Boolean(latest),
      updated_at: latest?.timestamp || '暂无分析结果',
      trend: sensorTrend,
      trend_label: sensorTrend.length ? '转子轴承温度 2' : '传感器趋势',
      trend_unit: sensorTrend.length ? '°C' : undefined,
      source: latest?.data_origin || telemetry?.data_origin || item.data_origin || 'REFERENCE',
      model_version: latest?.model_version || '未提供',
      ...(item.wind_farm === 'Wind Farm B' && item.turbine_id === 'WT02' ? {
        event_id: 53,
        event_name: '转子轴承 2损伤',
        event_description: 'Rotor Bearing 2 - Damage',
        component_label: verified ? state.component_name : '转子轴承 2（映射待核验）',
        fault_category: 'BEARING' as const,
      } : {}),
    }
  }))
}

function maintenanceBody(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, personnelAvailable = true) {
  return {
    turbine_id: turbineId,
    component_id: componentId,
    maintenance_window_available: maintenanceWindowAvailable,
    personnel_available: personnelAvailable,
    decision_origin: 'SIMULATED',
    conditions_origin: 'SIMULATED',
    rule_version: 'trial-v0.1',
  }
}

export function optimizeMaintenance(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, personnelAvailable = true) {
  return request<ApiMaintenancePlan>('/api/maintenance/optimize', {
    method: 'POST',
    body: JSON.stringify(maintenanceBody(turbineId, componentId, maintenanceWindowAvailable, personnelAvailable)),
  })
}

export function replanMaintenance(turbineId: string, componentId: string, maintenanceWindowAvailable: boolean, sourcePlanId: string, personnelAvailable = true) {
  return request<ApiMaintenancePlan>('/api/maintenance/replan', {
    method: 'POST',
    body: JSON.stringify({
      ...maintenanceBody(turbineId, componentId, maintenanceWindowAvailable, personnelAvailable),
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
      data_origin: 'SIMULATED',
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
