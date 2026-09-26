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
  fault_category?: 'GEARBOX_BEARING' | 'GEARBOX' | 'GENERATOR' | 'DRIVETRAIN' | 'BEARING'
  event_name?: string
  event_description?: string
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
  { turbine_id: 'WT02', name: '二号机组', position: [-3, 1], warning_level: 'HIGH', health_index: 63.2, anomaly_score: .87, failure_risk: .76, power_kw: 1580, wind_ms: 9.8, component_id: 'WT02_COMPONENT_01', component_label: '转子轴承 2（映射待核验）', updated_at: 'CARE v6 Wind Farm B', trend: [88, 86, 82, 79, 75, 70, 66, 63], source: 'DERIVED', model_version: 'care-v6-offshore-demo-0.1', event_id: 53, event_name: '转子轴承 2损伤', event_description: 'Rotor Bearing 2 - Damage', mapping_status: 'UNVERIFIED', fault_category: 'BEARING' },
  { turbine_id: 'WT03', name: '三号机组', position: [6, -5], warning_level: 'NORMAL', health_index: 89.6, anomaly_score: .18, failure_risk: .13, power_kw: 2010, wind_ms: 9.6, component_id: 'WT03_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [87, 88, 87, 89, 90, 88, 90, 90], source: 'SIMULATED', model_version: 'demo-0.1' },
  { turbine_id: 'WT04', name: '四号机组', position: [13, 2], warning_level: 'LOW', health_index: 78.1, anomaly_score: .39, failure_risk: .31, power_kw: 1770, wind_ms: 9.1, component_id: 'WT04_COMPONENT_01', component_label: '齿轮传动关注对象', updated_at: '演示时刻 09:00', trend: [84, 82, 83, 81, 80, 79, 79, 78], source: 'SIMULATED', model_version: 'demo-0.1', fault_category: 'GEARBOX' },
  { turbine_id: 'WT05', name: '五号机组', position: [-15, 8], warning_level: 'NORMAL', health_index: 91.2, anomaly_score: .14, failure_risk: .1, power_kw: 1980, wind_ms: 9.5, component_id: 'WT05_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [89, 90, 90, 91, 90, 91, 91, 91], source: 'SIMULATED', model_version: 'demo-0.1' },
  { turbine_id: 'WT06', name: '六号机组', position: [1, 10], warning_level: 'NORMAL', health_index: 87.8, anomaly_score: .2, failure_risk: .16, power_kw: 1870, wind_ms: 9.2, component_id: 'WT06_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [86, 87, 87, 88, 87, 88, 88, 88], source: 'SIMULATED', model_version: 'demo-0.1' },
  { turbine_id: 'WT07', name: '七号机组', position: [16, 9], warning_level: 'LOW', health_index: 79.8, anomaly_score: .35, failure_risk: .29, power_kw: 1760, wind_ms: 8.9, component_id: 'WT07_COMPONENT_01', component_label: '发电机关注对象', updated_at: '演示时刻 09:00', trend: [84, 83, 82, 82, 81, 80, 80, 80], source: 'SIMULATED', model_version: 'demo-0.1', fault_category: 'GENERATOR' },
  { turbine_id: 'WT08', name: '八号机组', position: [-18, -12], warning_level: 'NORMAL', health_index: 94.1, anomaly_score: .08, failure_risk: .06, power_kw: 2050, wind_ms: 9.9, component_id: 'WT08_COMPONENT_01', component_label: '关键状态对象 01', updated_at: '演示时刻 09:00', trend: [92, 92, 93, 93, 94, 93, 94, 94], source: 'SIMULATED', model_version: 'demo-0.1' },
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
