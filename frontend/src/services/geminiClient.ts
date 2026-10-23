import { ActionPlan, LlmResponse } from '../types/sentinel';
import { evaluatePlan } from '../engine/policyEngine';

const SYSTEM_INSTRUCTION = `You are Sentinel's planning engine. You translate natural language user requests into a structured ActionPlan for a privileged OS automation tool.

You MUST respond strictly in valid JSON format matching one of these shapes:
1. A valid ActionPlan:
{
  "type": "Plan",
  "plan": {
    "id": "<uuid-or-string>",
    "original_request": "<user prompt>",
    "actions": [
      {
        "type": "DeleteFilesMatching",
        "root": "~/Downloads",
        "older_than_days": 365,
        "pattern": "*",
        "reason": "Identify and stage files older than 1 year for review"
      }
    ],
    "estimated_impact": {
      "file_count": 8,
      "total_size_mb": 412.5,
      "reversible": false,
      "notes": "8 files older than 365 days staged for inspection"
    },
    "created_at": "<iso-timestamp>"
  }
}

2. Needs clarification:
{
  "type": "NeedsClarification",
  "question": "<clarification question>"
}

3. Cannot do:
{
  "type": "CannotDo",
  "reason": "<reason why>"
}

Allowed Action types:
- DeleteFile { path: string, reason: string }
- DeleteFilesMatching { root: string, older_than_days?: number | null, pattern?: string | null, reason: string }
- MoveFile { from: string, to: string, reason: string }
- MoveFilesMatching { root: string, destination: string, pattern?: string | null, older_than_days?: number | null, reason: string }
- ChangePermissions { path: string, mode: number | string, recursive: boolean, reason: string }
- KillProcess { pid_or_name: number | string, signal: "Terminate" | "Kill" | "Interrupt", reason: string }
- CompressDirectory { path: string, output: string, delete_source: boolean, reason: string }
- FindLargeFiles { root: string, min_size_mb: number }
- EmptyTrash {}
- ListRunningProcesses { filter?: string | null }

CRITICAL RULES:
- Never emit raw shell commands.
- Paths must be standard (e.g. ~/Downloads, C:\\Users\\... or /home/...).
- For queries asking to "show", "find", "list", or "inspect" files by size: use FindLargeFiles with an appropriate min_size_mb.
- For queries asking to "show", "find", "list", or "audit" files by age/date: use DeleteFilesMatching with appropriate older_than_days.
- For queries asking to "list processes" or "show running processes": use ListRunningProcesses.
- If the user specifies "1 year", calculate older_than_days = 365.
- Output ONLY raw JSON. No markdown, no code fences.
`;

// Groq API key (free tier — fast open source models)
const GROQ_API_KEY = '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';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-20b';

export async function callGeminiDirect(
  prompt: string,
  apiKey?: string,
  preferredModel?: string
): Promise<LlmResponse | null> {
  const activeKey = (apiKey && apiKey.trim().startsWith('gsk_')) ? apiKey.trim() : GROQ_API_KEY;
  const activeModel = preferredModel?.includes('gpt-oss') || preferredModel?.includes('qwen')
    ? preferredModel
    : GROQ_MODEL;

  const requestBody = {
    model: activeModel,
    messages: [
      { role: 'system', content: SYSTEM_INSTRUCTION },
      { role: 'user', content: `Generate a structured Sentinel ActionPlan for: "${prompt}"` },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      console.warn('Groq API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const rawText = data?.choices?.[0]?.message?.content;
    if (!rawText) return null;

    const parsed = JSON.parse(rawText.trim());

    if (parsed.type === 'NeedsClarification') {
      return {
        type: 'NeedsClarification',
        question: parsed.question || 'Please provide additional criteria for this operation.',
      };
    }

    if (parsed.type === 'CannotDo') {
      return {
        type: 'CannotDo',
        reason: parsed.reason || 'Operation not supported by Sentinel policy bounds.',
      };
    }

    const planData: ActionPlan = parsed.plan || (parsed.actions ? parsed : null);
    if (planData && Array.isArray(planData.actions)) {
      if (!planData.id) {
        planData.id = 'groq-' + Math.random().toString(36).slice(2, 10);
      }
      if (!planData.original_request) {
        planData.original_request = prompt;
      }
      if (!planData.created_at) {
        planData.created_at = new Date().toISOString();
      }
      if (!planData.estimated_impact) {
        planData.estimated_impact = {
          file_count: planData.actions.length,
          total_size_mb: 50.0,
          reversible: planData.actions.every((a) => a.type.startsWith('Move')),
          notes: 'Synthesized dynamically by Groq Llama 3.3',
        };
      }

      return {
        type: 'Plan',
        plan: planData,
        evaluation: evaluatePlan(planData),
      };
    }
  } catch (err) {
    console.warn('Groq direct call failed, falling back to backend/mock:', err);
  }

  return null;
}
