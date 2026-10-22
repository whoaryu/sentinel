export type KillSignal = 'Terminate' | 'Kill' | 'Interrupt';

export type ProcessTarget = 
  | number 
  | string;

export type PermissionSpec = 
  | number 
  | string;

export type Action =
  | {
      type: 'DeleteFile';
      path: string;
      reason: string;
    }
  | {
      type: 'DeleteFilesMatching';
      root: string;
      older_than_days?: number | null;
      pattern?: string | null;
      reason: string;
    }
  | {
      type: 'MoveFile';
      from: string;
      to: string;
      reason: string;
    }
  | {
      type: 'MoveFilesMatching';
      root: string;
      destination: string;
      pattern?: string | null;
      older_than_days?: number | null;
      reason: string;
    }
  | {
      type: 'ChangePermissions';
      path: string;
      mode: PermissionSpec;
      recursive: boolean;
      reason: string;
    }
  | {
      type: 'KillProcess';
      pid_or_name: ProcessTarget;
      signal: KillSignal;
      reason: string;
    }
  | {
      type: 'CompressDirectory';
      path: string;
      output: string;
      delete_source: boolean;
      reason: string;
    }
  | {
      type: 'FindLargeFiles';
      root: string;
      min_size_mb: number;
    }
  | {
      type: 'EmptyTrash';
    }
  | {
      type: 'ListRunningProcesses';
      filter?: string | null;
    };

export interface ImpactSummary {
  file_count?: number | null;
  total_size_mb?: number | null;
  reversible: boolean;
  notes: string;
}

export interface ActionPlan {
  id: string;
  original_request: string;
  actions: Action[];
  estimated_impact: ImpactSummary;
  created_at: string;
}

export type PolicyDecision =
  | { status: 'Allow'; reason?: undefined }
  | { status: 'Deny'; reason: string }
  | { status: 'RequireExtraConfirmation'; reason: string };

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface EvaluatedAction {
  action: Action;
  decision: PolicyDecision;
  risk_level: RiskLevel;
  reversible: boolean;
}

export interface EvaluatedPlan {
  plan: ActionPlan;
  evaluated_actions: EvaluatedAction[];
  overall_decision: PolicyDecision;
}

export type LlmResponse =
  | { type: 'Plan'; plan: ActionPlan; evaluation: EvaluatedPlan }
  | { type: 'NeedsClarification'; question: string }
  | { type: 'CannotDo'; reason: string };

export type PlanStatus =
  | 'Drafting'
  | 'PendingApproval'
  | 'Approved'
  | 'Executing'
  | 'Completed'
  | 'Failed'
  | 'Rejected';

export type ActionExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ActionRuntimeState {
  index: number;
  action: Action;
  evaluated: EvaluatedAction;
  status: ActionExecutionStatus;
  message?: string;
  filesAffected?: number;
  bytesFreed?: number;
  error?: string;
  undoAction?: Action;
  details?: string[];
}

export interface ExecutionEvent {
  type: 'ActionStarted' | 'ActionProgress' | 'ActionCompleted' | 'ActionFailed' | 'PlanCompleted';
  action_index?: number;
  action_type?: string;
  message?: string;
  files_affected?: number;
  bytes_freed?: number;
  error?: string;
  total_actions?: number;
  succeeded?: number;
  failed?: number;
  details?: string[];
  timestamp: string;
}

export interface AuditPlanRecord {
  id: string;
  request: string;
  plan_json: string;
  status: string;
  created_at: string;
  approved_at?: string | null;
  executed_at?: string | null;
  actions_count?: number;
  summary_notes?: string;
}
