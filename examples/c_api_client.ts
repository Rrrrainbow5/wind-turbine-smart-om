export type DataOrigin =
  | "REAL"
  | "DERIVED"
  | "SIMULATED"
  | "ASSUMED"
  | "REFERENCE";

export type WarningLevel = "NORMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface AIResult {
  id: number;
  turbine_id: string;
  component_id: string;
  timestamp: string;
  health_index: number;
  anomaly_score: number;
  failure_risk: number;
  warning_level: WarningLevel;
  model_version: string;
  data_origin: DataOrigin;
  created_at: string;
}

export interface TurbineState {
  turbine_id: string;
  component_id: string;
  component_name: string;
  mapping_status: string;
  latest_ai_result: AIResult | null;
}

export interface CandidateAction {
  action:
    | "CONTINUE_MONITORING"
    | "SCHEDULE_INSPECTION"
    | "SCHEDULE_MAINTENANCE";
  available: boolean;
  explanation: string;
}

export interface MaintenancePlan {
  plan_id: string;
  turbine_id: string;
  component_id: string;
  recommended_action: CandidateAction["action"];
  priority: "LOW" | "MEDIUM" | "HIGH";
  rationale: string;
  requires_replan: boolean;
  decision_origin: DataOrigin;
  candidates: CandidateAction[];
  created_at: string;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WindCare API ${response.status}: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export function getTurbineState(turbineId: string): Promise<TurbineState[]> {
  return request(`/api/turbines/${encodeURIComponent(turbineId)}/state`);
}

export function getComponentRisk(componentId: string): Promise<AIResult> {
  return request(`/api/components/${encodeURIComponent(componentId)}/risk`);
}

export function optimizeMaintenance(
  turbineId: string,
  componentId: string,
): Promise<MaintenancePlan> {
  return request("/api/maintenance/optimize", {
    method: "POST",
    body: JSON.stringify({
      turbine_id: turbineId,
      component_id: componentId,
      maintenance_window_available: true,
      personnel_available: true,
      decision_origin: "SIMULATED",
    }),
  });
}
