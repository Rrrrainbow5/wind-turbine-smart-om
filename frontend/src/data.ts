export type WarningLevel = 'NORMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
export type SourceKind = 'REAL' | 'DERIVED' | 'SIMULATED' | 'ASSUMED' | 'REFERENCE'

export interface Turbine {
  turbine_id: string
  name: string
  position: [number, number]
  warning_level: WarningLevel
  health_index: number
  anomaly_score: number
  failure_risk: number
  power_kw: number
  wind_ms: number
  component_id: string
  component_label: string
  updated_at: string
  trend: number[]
  source: SourceKind
  model_version: string
  event_id?: number
  mapping_status?: string
  has_analysis?: boolean
}

export interface MaintenancePlan {
  id: string
  title: string
  timing: string
  action: string
  risk: string
  downtime: string
  cost: string
  recommended?: boolean
  available?: boolean
}

export const demoTurbines: Turbine[] = [
  { turbine_id: 'WT01', name: '一号机组', position: [-11, -5], warning_level: 'NORMAL', health_index: 92.4, anomaly_score: .12, failure_risk: .08, power_kw: 1940, wind_ms: 9.3, component_id: 'WT01_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [87, 88, 90, 89, 91, 90, 92, 92], source: 'SIMULATED', model_version: 'demo-0.1' },
  { turbine_id: 'WT02', name: '二号机组', position: [-3, 1], warning_level: 'HIGH', health_index: 63.2, anomaly_score: .87, failure_risk: .76, power_kw: 1580, wind_ms: 9.8, component_id: 'WF_A_EVENT_51_GEARBOX_BEARING', component_label: '齿轮箱轴承状态对象 · Event 51', updated_at: 'CARE v6 演示窗口', trend: [88, 86, 82, 79, 75, 70, 66, 63], source: 'SIMULATED', model_version: 'care-v6-demo-0.1', event_id: 51 },
  { turbine_id: 'WT03', name: '三号机组', position: [6, -5], warning_level: 'NORMAL', health_index: 89.6, anomaly_score: .18, failure_risk: .13, power_kw: 2010, wind_ms: 9.6, component_id: 'WT03_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [87, 88, 87, 89, 90, 88, 90, 90], source: 'SIMULATED', model_version: 'demo-0.1' },
  { turbine_id: 'WT04', name: '四号机组', position: [13, 2], warning_level: 'LOW', health_index: 78.1, anomaly_score: .39, failure_risk: .31, power_kw: 1770, wind_ms: 9.1, component_id: 'WT04_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [84, 82, 83, 81, 80, 79, 79, 78], source: 'SIMULATED', model_version: 'demo-0.1' },
]

export const warningText: Record<WarningLevel, string> = {
  NORMAL: '正常', LOW: '关注', MEDIUM: '预警', HIGH: '高风险',
}

export function getDemoPlans(weatherRestricted: boolean): MaintenancePlan[] {
  return weatherRestricted ? [
    { id: 'inspect', title: '远程监测并准备备件', timing: '今日', action: '持续监测，准备现场检查', risk: '中', downtime: '0 h', cost: '低', recommended: true },
    { id: 'service', title: '窗口恢复后安排维护', timing: '下个可用窗口', action: '现场检查后按需维护', risk: '较低', downtime: '按现场计划', cost: '中' },
  ] : [
    { id: 'inspect', title: '安排现场检查', timing: '今日', action: '核验异常并准备备件', risk: '中', downtime: '待定', cost: '低', recommended: true },
    { id: 'service', title: '安排预防性维护', timing: '下一可用窗口', action: '检查后执行维护', risk: '较低', downtime: '按现场计划', cost: '中' },
    { id: 'monitor', title: '继续监测', timing: '持续', action: '提高监测频率并复评', risk: '较高', downtime: '0 h', cost: '低' },
  ]
}
