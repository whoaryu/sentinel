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
- For queries asking to "show", "find", or "inspect files older than X", use DeleteFilesMatching (which defaults to simulation/dry-run review) or FindLargeFiles.
- If the user specifies "1 year", calculate older_than_days = 365.
`;

export async function callGeminiDirect(
  prompt: string,
  apiKey: string,
  preferredModel = 'gemini-1.5-flash'
): Promise<LlmResponse | null> {
  if (!apiKey || !apiKey.trim()) return null;

  const modelsToTry = [preferredModel];
  for (const candidate of ['gemini-1.5-flash', 'gemini-2.0-flash']) {
    if (!modelsToTry.includes(candidate)) {
      modelsToTry.push(candidate);
    }
  }
  modelsToTry.splice(2);

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `Generate a structured Sentinel ActionPlan for: "${prompt}"` }],
      },
    ],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Gemini Direct API error with model ${model}:`, res.status, errText);
        if (res.status === 404) {
          // Model unavailable; attempt next model in list
          continue;
        }
        return null;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

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
        planData.id = 'gemini-' + Math.random().toString(36).slice(2, 10);
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
          notes: 'Synthesized dynamically by Google Gemini',
        };
      }

      return {
        type: 'Plan',
        plan: planData,
        evaluation: evaluatePlan(planData),
      };
    }
  } catch (err) {
    console.warn('Direct Gemini call failed, using intelligent heuristic fallback:', err);
  }
}

  return null;
}
