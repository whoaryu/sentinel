import { Action, ActionPlan, EvaluatedAction, EvaluatedPlan, PolicyDecision, RiskLevel } from '../types/sentinel';

const PROTECTED_PROCESSES = [
  'system',
  'system idle process',
  'csrss.exe',
  'csrss',
  'lsass.exe',
  'lsass',
  'services.exe',
  'services',
  'smss.exe',
  'smss',
  'wininit.exe',
  'wininit',
  'svchost.exe',
  'svchost',
  'init',
  'systemd',
  'launchd',
  'kernel',
];

const PROTECTED_DIRECTORIES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/sys',
  '/proc',
  'c:\\windows',
  'c:\\windows\\system32',
  'c:\\program files',
  'c:\\program files (x86)',
];

export function evaluateAction(action: Action): PolicyDecision {
  switch (action.type) {
    case 'DeleteFile': {
      const err = checkPathSafety(action.path, true);
      if (err) return { status: 'Deny', reason: err };
      return { status: 'Allow' };
    }

    case 'DeleteFilesMatching': {
      const err = checkPathSafety(action.root, false);
      if (err) return { status: 'Deny', reason: err };
      if (!action.older_than_days && action.older_than_days !== 0) {
        return {
          status: 'RequireExtraConfirmation',
          reason: 'DeleteFilesMatching has no age filter; this will delete all matching files regardless of age.',
        };
      }
      return { status: 'Allow' };
    }

    case 'MoveFile': {
      const srcErr = checkPathSafety(action.from, false);
      if (srcErr) return { status: 'Deny', reason: `Source path denied: ${srcErr}` };
      const destErr = checkPathSafety(action.to, false);
      if (destErr) return { status: 'Deny', reason: `Destination path denied: ${destErr}` };
      return { status: 'Allow' };
    }

    case 'MoveFilesMatching': {
      const srcErr = checkPathSafety(action.root, false);
      if (srcErr) return { status: 'Deny', reason: `Source root denied: ${srcErr}` };
      const destErr = checkPathSafety(action.destination, false);
      if (destErr) return { status: 'Deny', reason: `Destination root denied: ${destErr}` };
      return { status: 'Allow' };
    }

    case 'ChangePermissions': {
      const err = checkPathSafety(action.path, false);
      if (err) return { status: 'Deny', reason: err };
      return { status: 'Allow' };
    }

    case 'KillProcess': {
      if (typeof action.pid_or_name === 'number') {
        if (action.pid_or_name < 100) {
          return {
            status: 'Deny',
            reason: `PID ${action.pid_or_name} is a protected system process (PID < 100)`,
          };
        }
      } else {
        const lower = action.pid_or_name.toLowerCase();
        if (PROTECTED_PROCESSES.some((p) => p.toLowerCase() === lower)) {
          return {
            status: 'Deny',
            reason: `Process '${action.pid_or_name}' is in the protected system processes list`,
          };
        }
      }

      if (action.signal === 'Kill') {
        return {
          status: 'RequireExtraConfirmation',
          reason: 'SIGKILL forcefully aborts execution without clean shutdown.',
        };
      }
      return { status: 'Allow' };
    }

    case 'CompressDirectory': {
      const srcErr = checkPathSafety(action.path, false);
      if (srcErr) return { status: 'Deny', reason: `Source directory denied: ${srcErr}` };
      const destErr = checkPathSafety(action.output, false);
      if (destErr) return { status: 'Deny', reason: `Output path denied: ${destErr}` };
      if (action.delete_source) {
        return {
          status: 'RequireExtraConfirmation',
          reason: 'CompressDirectory has delete_source set to true; source files will be deleted after compression.',
        };
      }
      return { status: 'Allow' };
    }

    case 'FindLargeFiles': {
      const err = checkPathSafety(action.root, false);
      if (err) return { status: 'Deny', reason: err };
      return { status: 'Allow' };
    }

    case 'EmptyTrash': {
      return {
        status: 'RequireExtraConfirmation',
        reason: 'Emptying trash permanently purges all soft-deleted files.',
      };
    }

    case 'ListRunningProcesses':
      return { status: 'Allow' };
  }
}

export function getActionRiskLevel(action: Action): RiskLevel {
  switch (action.type) {
    case 'FindLargeFiles':
    case 'ListRunningProcesses':
    case 'MoveFile':
    case 'MoveFilesMatching':
    case 'ChangePermissions':
      return 'Low';
    case 'CompressDirectory':
      return action.delete_source ? 'High' : 'Low';
    case 'DeleteFilesMatching':
      return !action.older_than_days ? 'Critical' : 'Medium';
    case 'DeleteFile':
      return 'Medium';
    case 'KillProcess':
      return action.signal === 'Kill' ? 'Critical' : 'High';
    case 'EmptyTrash':
      return 'High';
  }
}

export function isActionReversible(action: Action): boolean {
  switch (action.type) {
    case 'MoveFile':
    case 'MoveFilesMatching':
    case 'FindLargeFiles':
    case 'ListRunningProcesses':
    case 'ChangePermissions':
      return true;
    case 'CompressDirectory':
      return !action.delete_source;
    case 'DeleteFile':
    case 'DeleteFilesMatching':
    case 'KillProcess':
    case 'EmptyTrash':
      return false;
  }
}

function checkPathSafety(path: string, isDeletion: boolean): string | null {
  const norm = path.replace(/\\/g, '/');

  // Rule 1: Traversal sequence
  if (norm.includes('..') || norm.split('/').includes('..')) {
    return `Path contains directory traversal sequence '..': ${path}`;
  }

  // Check against protected directories
  const lower = norm.toLowerCase();
  for (const prot of PROTECTED_DIRECTORIES) {
    const protNorm = prot.replace(/\\/g, '/').toLowerCase();
    if (lower === protNorm || lower.startsWith(protNorm + '/')) {
      return `Target path '${path}' is within protected system location '${prot}'`;
    }
  }

  // Rule 3: Depth check for deletions
  if (isDeletion) {
    const segments = norm.split('/').filter((s) => s.length > 0 && s !== '.');
    // On Windows, drive letter like "C:" is first segment
    if (segments.length < 3) {
      return `Cannot delete shallow system path '${path}' (minimum 3 path segments required for safe deletion)`;
    }
  }

  return null;
}

export function evaluatePlan(plan: ActionPlan): EvaluatedPlan {
  const evaluated_actions: EvaluatedAction[] = plan.actions.map((action) => {
    const decision = evaluateAction(action);
    const risk_level = getActionRiskLevel(action);
    const reversible = isActionReversible(action);
    return {
      action,
      decision,
      risk_level,
      reversible,
    };
  });

  let overall_decision: PolicyDecision = { status: 'Allow' };

  for (const ea of evaluated_actions) {
    if (ea.decision.status === 'Deny') {
      overall_decision = ea.decision;
      break;
    }
    if (ea.decision.status === 'RequireExtraConfirmation' && overall_decision.status === 'Allow') {
      overall_decision = ea.decision;
    }
  }

  // Blast-radius check
  if (plan.estimated_impact.file_count && plan.estimated_impact.file_count > 50 && overall_decision.status === 'Allow') {
    overall_decision = {
      status: 'RequireExtraConfirmation',
      reason: `Blast-radius cap exceeded: Plan estimates affecting ${plan.estimated_impact.file_count} files (limit: 50)`,
    };
  }

  if (plan.estimated_impact.total_size_mb && plan.estimated_impact.total_size_mb > 500 && overall_decision.status === 'Allow') {
    overall_decision = {
      status: 'RequireExtraConfirmation',
      reason: `Blast-radius cap exceeded: Plan estimates modifying ${plan.estimated_impact.total_size_mb.toFixed(1)} MB (limit: 500 MB)`,
    };
  }

  return {
    plan,
    evaluated_actions,
    overall_decision,
  };
}
