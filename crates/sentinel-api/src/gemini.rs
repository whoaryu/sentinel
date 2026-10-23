use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;
use chrono::Utc;
use sentinel_core::{Action, ActionPlan, ImpactSummary, LlmResponse};
use sentinel_core::schema::llm_response_schema_json;

// ── OpenAI-compatible request structures (Groq uses this format) ─────────────

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    response_format: ResponseFormat,
}

// ── OpenAI-compatible response structures ────────────────────────────────────

#[derive(Deserialize, Debug)]
struct ChatChoice {
    message: Option<ChatMessageContent>,
}

#[derive(Deserialize, Debug)]
struct ChatMessageContent {
    content: Option<String>,
}

#[derive(Deserialize, Debug)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
    error: Option<Value>,
}

// ── Planner ──────────────────────────────────────────────────────────────────

pub struct GeminiPlanner {
    client: reqwest::Client,
    system_prompt: String,
    schema_hint: String,
}

impl GeminiPlanner {
    pub fn new(system_prompt: String) -> Self {
        let schema_json = llm_response_schema_json();
        let schema_hint = serde_json::to_string_pretty(&schema_json).unwrap_or_default();
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default(),
            system_prompt,
            schema_hint,
        }
    }

    pub async fn plan(&self, user_request: &str, custom_api_key: Option<&str>) -> Result<LlmResponse, String> {
        // Key resolution: UI input (if valid Groq gsk_ key) → GROQ_API_KEY from .env → other fallbacks
        let api_key = custom_api_key
            .map(|s| s.trim().to_string())
            .filter(|s| s.starts_with("gsk_"))
            .or_else(|| std::env::var("GROQ_API_KEY").ok().filter(|s| !s.is_empty()))
            .or_else(|| custom_api_key.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
            .ok_or_else(|| "No LLM API key configured (set GROQ_API_KEY in .env or via UI Settings)".to_string())?;

        let model = std::env::var("LLM_MODEL")
            .or_else(|_| std::env::var("GROQ_MODEL"))
            .unwrap_or_else(|_| "openai/gpt-oss-20b".to_string());

        let url = "https://api.groq.com/openai/v1/chat/completions";

        let full_system = format!(
            "{}\n\nIMPORTANT: You MUST respond strictly in valid JSON matching the LlmResponse schema below.\nNEVER wrap in markdown code fences. Output ONLY raw JSON.\n\nSchema:\n{}\n\nAllowed Action types:\n- DeleteFile {{ path, reason }}\n- DeleteFilesMatching {{ root, older_than_days, pattern, reason }}\n- MoveFile {{ from, to, reason }}\n- MoveFilesMatching {{ root, destination, pattern, older_than_days, reason }}\n- ChangePermissions {{ path, mode, recursive, reason }}\n- KillProcess {{ pid_or_name, signal, reason }}\n- CompressDirectory {{ path, output, delete_source, reason }}\n- FindLargeFiles {{ root, min_size_mb }}\n- EmptyTrash\n- ListRunningProcesses {{ filter }}\n\nRules for queries:\n- Paths must be absolute or use tilde (e.g. ~/Downloads, ~/Desktop, ~/Documents). Never use '.' as root.\n- For requests asking to show, list, find, or audit files (e.g. 'show xyz files'): emit DeleteFilesMatching with the appropriate pattern (e.g. '*xyz*' or '*.xyz') and older_than_days = null unless age is explicitly requested.\n- For requests asking to show or list running processes: emit ListRunningProcesses.\n- For requests asking to show or list large files: emit FindLargeFiles.\n- NEVER emit RunShellCommand. If ambiguous, return NeedsClarification. If impossible, return CannotDo.",
            self.system_prompt, self.schema_hint
        );

        let body = ChatRequest {
            model: model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: full_system,
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: format!("Generate an ActionPlan for: \"{}\"", user_request),
                },
            ],
            temperature: 0.1,
            response_format: ResponseFormat { format_type: "json_object".to_string() },
        };

        let res = match self.client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return Err(format!("Network error connecting to Groq API: {}", e)),
        };

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Groq API returned HTTP {}: {}", status, err_text));
        }

        let chat_resp: ChatResponse = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Groq response envelope: {}", e))?;

        if let Some(err) = chat_resp.error {
            return Err(format!("Groq API error: {}", err));
        }

        let raw_text = chat_resp
            .choices
            .as_ref()
            .and_then(|c| c.first())
            .and_then(|c| c.message.as_ref())
            .and_then(|m| m.content.as_ref())
            .ok_or_else(|| "Groq returned empty response content".to_string())?;

        tracing::info!("Successfully synthesized ActionPlan via Groq ({})", model);
        parse_llm_json(raw_text, user_request)
    }
}

fn parse_llm_json(json_str: &str, original_request: &str) -> Result<LlmResponse, String> {
    let clean = json_str
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // 1. Try parsing directly into LlmResponse
    if let Ok(resp) = serde_json::from_str::<LlmResponse>(clean) {
        return Ok(resp);
    }

    // 2. Try parsing directly into ActionPlan
    if let Ok(mut plan) = serde_json::from_str::<ActionPlan>(clean) {
        if plan.id.is_nil() {
            plan.id = Uuid::new_v4();
        }
        if plan.original_request.is_empty() {
            plan.original_request = original_request.to_string();
        }
        return Ok(LlmResponse::Plan(plan));
    }

    // 3. Try parsing generic JSON object with "type" or "actions"
    if let Ok(val) = serde_json::from_str::<Value>(clean) {
        if let Some(t) = val.get("type").and_then(|t| t.as_str()) {
            if t == "NeedsClarification" {
                let question = val.get("question").and_then(|q| q.as_str())
                    .unwrap_or("Could you clarify the exact criteria?");
                return Ok(LlmResponse::NeedsClarification { question: question.to_string() });
            }
            if t == "CannotDo" {
                let reason = val.get("reason").and_then(|r| r.as_str())
                    .unwrap_or("This operation is not supported by Sentinel's closed action model.");
                return Ok(LlmResponse::CannotDo { reason: reason.to_string() });
            }
            if t == "Plan" {
                let plan_val = val.get("plan").unwrap_or(&val);
                if let Ok(mut plan) = serde_json::from_value::<ActionPlan>(plan_val.clone()) {
                    if plan.id.is_nil() {
                        plan.id = Uuid::new_v4();
                    }
                    if plan.original_request.is_empty() {
                        plan.original_request = original_request.to_string();
                    }
                    return Ok(LlmResponse::Plan(plan));
                }

                // If ActionPlan direct deserialization failed, extract actions manually
                if let Some(actions_val) = plan_val.get("actions") {
                    if let Ok(actions) = serde_json::from_value::<Vec<Action>>(actions_val.clone()) {
                        let impact_val = plan_val.get("estimated_impact").unwrap_or(&val);
                        let plan = ActionPlan {
                            id: Uuid::new_v4(),
                            original_request: original_request.to_string(),
                            actions,
                            estimated_impact: ImpactSummary {
                                file_count: impact_val.get("file_count").and_then(|i| i.as_u64()),
                                total_size_mb: impact_val.get("total_size_mb").and_then(|i| i.as_f64()),
                                reversible: impact_val.get("reversible").and_then(|i| i.as_bool()).unwrap_or(true),
                                notes: impact_val.get("notes").and_then(|i| i.as_str()).unwrap_or("Estimated by LLM").to_string(),
                            },
                            created_at: Utc::now(),
                        };
                        return Ok(LlmResponse::Plan(plan));
                    }
                }
            }
        }

        // If it contains "actions", try to reconstruct ActionPlan
        let actions_val = val.get("actions").or_else(|| val.get("plan").and_then(|p| p.get("actions")));
        if let Some(actions_val) = actions_val {
            if let Ok(actions) = serde_json::from_value::<Vec<Action>>(actions_val.clone()) {
                let plan = ActionPlan {
                    id: Uuid::new_v4(),
                    original_request: original_request.to_string(),
                    actions,
                    estimated_impact: ImpactSummary {
                        file_count: val.get("estimated_impact").and_then(|i| i.get("file_count")).and_then(|c| c.as_u64()),
                        total_size_mb: val.get("estimated_impact").and_then(|i| i.get("total_size_mb")).and_then(|s| s.as_f64()),
                        reversible: val.get("estimated_impact").and_then(|i| i.get("reversible")).and_then(|r| r.as_bool()).unwrap_or(false),
                        notes: val.get("estimated_impact").and_then(|i| i.get("notes")).and_then(|n| n.as_str()).unwrap_or("Estimated by LLM").to_string(),
                    },
                    created_at: Utc::now(),
                };
                return Ok(LlmResponse::Plan(plan));
            }
        }
    }

    Err(format!("Could not deserialize LLM JSON into ActionPlan or LlmResponse: {}", clean))
}
