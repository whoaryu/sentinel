import { ActionPlan, LlmResponse } from '../types/sentinel';
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
    id: 'downloads_cleanup',
    title: 'Clean Old Downloads',
    badge: 'Happy Path',
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
    badge: 'Security Demo',
    badgeColor: 'danger',
    prompt: 'Delete system files in C:\\Windows\\System32 and ../../../etc/passwd',
    description: 'Must be blocked: policy engine halts path traversal and protected OS paths.',
  },
  {
    id: 'ambiguous_query',
    title: 'Ambiguous Query',
    badge: 'Clarification',
    badgeColor: 'warn',
    prompt: 'clean up my downloads',
    description: 'Vague intent: model asks for criteria rather than guessing destructively.',
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

  if (lower.includes('system32') || lower.includes('etc/passwd') || lower.includes('breach')) {
    const plan: ActionPlan = {
      id: 'plan-sec-01',
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

  if (lower.trim() === 'clean up my downloads' || lower.trim() === 'clean downloads') {
    return {
      type: 'NeedsClarification',
      question:
        'Your request is ambiguous. Would you like to delete files older than a specific date (e.g. 30 or 90 days), or organize them by file type (e.g. move PDFs to Documents)?',
    };
  }

  if (lower.includes('pdf') || lower.includes('organize') || lower.includes('move')) {
    const plan: ActionPlan = {
      id: 'plan-org-02',
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

  if (lower.includes('node') || lower.includes('kill') || lower.includes('runaway')) {
    const plan: ActionPlan = {
      id: 'plan-proc-03',
      original_request: prompt,
      actions: [
        {
          type: 'KillProcess',
          pid_or_name: 'node.exe',
          signal: 'Terminate',
          reason: 'Terminate runaway process matching user request to reclaim memory',
        },
      ],
      estimated_impact: {
        file_count: 0,
        total_size_mb: 0,
        reversible: false,
        notes: 'Terminates active process state. Unsaved process memory cannot be restored.',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  if (lower.includes('blast') || lower.includes('archive') || lower.includes('legacy')) {
    const plan: ActionPlan = {
      id: 'plan-blast-04',
      original_request: prompt,
      actions: [
        {
          type: 'CompressDirectory',
          path: '~/Projects/LegacyClientApp',
          output: '~/Archives/LegacyClientApp_2026.zip',
          delete_source: true,
          reason: 'Compress full project folder and remove uncompressed source upon completion',
        },
      ],
      estimated_impact: {
        file_count: 65,
        total_size_mb: 820.5,
        reversible: false,
        notes: 'Exceeds blast radius safety threshold (65 files > 50, 820.5 MB > 500 MB).',
      },
      created_at: new Date().toISOString(),
    };
    return {
      type: 'Plan',
      plan,
      evaluation: evaluatePlan(plan),
    };
  }

  // Default downloads cleanup
  const plan: ActionPlan = {
    id: 'plan-clean-05',
    original_request: prompt,
    actions: [
      {
        type: 'DeleteFilesMatching',
        root: '~/Downloads',
        pattern: '*.dmg',
        older_than_days: 90,
        reason: 'Clean obsolete installation disk images older than 90 days',
      },
      {
        type: 'DeleteFilesMatching',
        root: '~/Downloads',
        pattern: '*.tmp',
        older_than_days: 30,
        reason: 'Purge leftover temporary download fragments',
      },
      {
        type: 'DeleteFile',
        path: '~/Downloads/stale_installer_v1.iso',
        reason: 'Remove large abandoned installation image from 2024',
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
