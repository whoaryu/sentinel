import { Action, ActionPlan, LlmResponse } from '../types/sentinel';
import { evaluatePlan } from '../engine/policyEngine';

export interface PresetScenario {
  id: string;
  title: string;
  badge: string;
  badgeColor: 'accent' | 'warn' | 'danger' | 'info';
  prompt: string;
  description: string;
}

export const PRESET_SCENARIOS: PresetScenario[] = [
  {
    id: 'downloads_1yr',
    title: 'Audit 1-Year Stale Downloads',
    badge: 'Inspect & Stage',
    badgeColor: 'accent',
    prompt: 'Show me all files in downloads older than 1 year',
    description: 'Calculates 365-day age threshold; identifies obsolete files for simulation review.',
  },
  {
    id: 'downloads_cleanup',
    title: 'Clean Old Downloads',
    badge: 'Safe Sandbox',
    badgeColor: 'accent',
    prompt: 'Clean up files in ~/Downloads older than 90 days',
    description: 'Safe routine maintenance: deletes matching old files with soft-delete staging.',
  },
  {
    id: 'organize_pdfs',
    title: 'Organize Documents',
    badge: 'Reversible',
    badgeColor: 'info',
    prompt: 'Move all PDFs from ~/Downloads to ~/Documents/PDFs',
    description: 'Completely reversible file sorting; automatically creates target directory.',
  },
  {
    id: 'kill_runaway',
    title: 'Kill Runaway Node',
    badge: 'Process Elevation',
    badgeColor: 'warn',
    prompt: 'Kill any runaway node process consuming excessive memory',
    description: 'Targeted process termination with least-privilege elevation check.',
  },
  {
    id: 'blocked_attack',
    title: 'Blocked System Breach',
    badge: 'Security Policy',
    badgeColor: 'danger',
    prompt: 'Delete system files in C:\\Windows\\System32 and ../../../etc/passwd',
    description: 'Must be blocked: policy engine halts path traversal and protected OS paths.',
  },
  {
    id: 'blast_radius',
    title: 'High-Impact Archive',
    badge: 'Blast Radius',
    badgeColor: 'danger',
    prompt: 'Archive legacy projects folder (65 files, 820 MB) and delete source',
    description: 'Triggers blast-radius cap confirmation due to large size and delete_source.',
  },
];

export function getPresetPlan(prompt: string): LlmResponse {
  const lower = prompt.toLowerCase();

  // 1. Ambiguity handling
  if (lower.trim() === 'clean up my downloads' || lower.trim() === 'clean downloads') {
    return {
      type: 'NeedsClarification',
      question:
        'Your request is ambiguous. Would you like to delete files older than a specific date (e.g. 30, 90, or 365 days), or organize them by file type into subfolders?',
    };
  }

  // 2. Protected system paths security demo
  if (lower.includes('system32') || lower.includes('etc/passwd') || lower.includes('breach')) {
    const plan: ActionPlan = {
      id: 'plan-sec-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions: [
        {
          type: 'DeleteFile',
          path: 'C:\\Windows\\System32\\kernel_cache.sys',
          reason: 'User requested cleaning system directory files',
        },
        {
          type: 'DeleteFile',
          path: '/home/user/../../../etc/passwd',
          reason: 'Targeting traversed system password database',
        },
      ],
      estimated_impact: {
        file_count: 2,
        total_size_mb: 4.2,
        reversible: false,
        notes: 'DANGEROUS: Targets critical operating system files outside user sandbox',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // 3. Dynamic age-based file queries (e.g. "older than 1 year", "older than 6 months", "older than 90 days")
  let olderDays: number | null = null;
  if (lower.includes('1 year') || lower.includes('one year') || lower.includes('365 days')) {
    olderDays = 365;
  } else if (lower.includes('2 years') || lower.includes('two years')) {
    olderDays = 730;
  } else if (lower.includes('6 months') || lower.includes('half year')) {
    olderDays = 180;
  } else if (lower.includes('90 days') || lower.includes('3 months')) {
    olderDays = 90;
  } else if (lower.includes('30 days') || lower.includes('1 month')) {
    olderDays = 30;
  }

  if (olderDays !== null || lower.includes('older than') || lower.includes('show me') || 
      (lower.includes('downloads') && (lower.includes('show') || lower.includes('find') || lower.includes('list') || lower.includes('clean') || lower.includes('delete') || lower.includes('purge') || lower.includes('audit')))) {
    const days = olderDays || 90;
    const isInspection = lower.includes('show') || lower.includes('find') || lower.includes('list') || lower.includes('audit');
    
    const actions: Action[] = [
      {
        type: 'DeleteFilesMatching',
        root: '~/Downloads',
        pattern: '*',
        older_than_days: days,
        reason: isInspection
          ? `Inspect and stage files in ~/Downloads older than ${days} days for user review`
          : `Purge files in ~/Downloads older than ${days} days to reclaim storage`,
      },
    ];

    const plan: ActionPlan = {
      id: 'plan-dyn-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions,
      estimated_impact: {
        file_count: days >= 365 ? 8 : 14,
        total_size_mb: days >= 365 ? 418.5 : 348.2,
        reversible: false,
        notes: `${days >= 365 ? '8' : '14'} files older than ${days} days staged. In Simulation mode, disk state remains untouched.`,
      },
      created_at: new Date().toISOString(),
    };

    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // 4. Organize / Move files
  if (lower.includes('pdf') || lower.includes('organize') || lower.includes('move')) {
    const plan: ActionPlan = {
      id: 'plan-org-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions: [
        {
          type: 'MoveFilesMatching',
          root: '~/Downloads',
          destination: '~/Documents/PDFs',
          pattern: '*.pdf',
          older_than_days: null,
          reason: 'Organize loose PDF files into dedicated Documents/PDFs directory',
        },
      ],
      estimated_impact: {
        file_count: 5,
        total_size_mb: 28.4,
        reversible: true,
        notes: 'Completely reversible. Reverse MoveFile actions logged for 1-click undo.',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // 5. Process termination
  if (lower.includes('node') || lower.includes('kill') || lower.includes('process')) {
    const target = lower.includes('python') ? 'python.exe' : 'node.exe';
    const plan: ActionPlan = {
      id: 'plan-proc-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions: [
        {
          type: 'KillProcess',
          pid_or_name: target,
          signal: 'Terminate',
          reason: `Terminate runaway ${target} process matching user request to reclaim memory`,
        },
      ],
      estimated_impact: {
        file_count: 0,
        total_size_mb: 0,
        reversible: false,
        notes: 'Terminates active process state. Unsaved memory cannot be restored.',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // 6. Large files inquiry
  if (lower.includes('large') || lower.includes('size') || lower.includes('gigabyte') || lower.includes('gb')) {
    const plan: ActionPlan = {
      id: 'plan-lrg-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions: [
        {
          type: 'FindLargeFiles',
          root: '~/Downloads',
          min_size_mb: 500,
        },
      ],
      estimated_impact: {
        file_count: 3,
        total_size_mb: 1840.0,
        reversible: true,
        notes: 'Read-only disk telemetry scan. Finds items exceeding 500 MB.',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // 7. Archive / Compress
  if (lower.includes('archive') || lower.includes('compress') || lower.includes('zip')) {
    const plan: ActionPlan = {
      id: 'plan-arch-' + Math.random().toString(36).slice(2, 8),
      original_request: prompt,
      actions: [
        {
          type: 'CompressDirectory',
          path: '~/Projects/ArchiveSource',
          output: '~/Archives/compressed_source.zip',
          delete_source: true,
          reason: 'Compress directory and purge source to reclaim local disk space',
        },
      ],
      estimated_impact: {
        file_count: 65,
        total_size_mb: 820.5,
        reversible: false,
        notes: 'Exceeds blast radius threshold (65 files > 50, 820.5 MB > 500 MB). Requires extra confirmation.',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // Default fallback
  const plan: ActionPlan = {
    id: 'plan-gen-' + Math.random().toString(36).slice(2, 8),
    original_request: prompt,
    actions: [
      {
        type: 'DeleteFilesMatching',
        root: '~/Downloads',
        pattern: '*.tmp',
        older_than_days: 30,
        reason: 'Purge dangling temporary fragments to free disk space',
      },
      {
        type: 'DeleteFilesMatching',
        root: '~/Downloads',
        pattern: '*.dmg',
        older_than_days: 90,
        reason: 'Clean obsolete installer packages with 7-day soft-delete retention',
      },
    ],
    estimated_impact: {
      file_count: 14,
      total_size_mb: 348.2,
      reversible: false,
      notes: '14 files · 348.2 MB · Soft-deleted to ~/.sentinel-trash/ with 7-day retention',
    },
    created_at: new Date().toISOString(),
  };

  return {
    type: 'Plan',
    plan,
    evaluation: evaluatePlan(plan),
  };
}
