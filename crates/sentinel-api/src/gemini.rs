use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;
use chrono::Utc;
use sentinel_core::{Action, ActionPlan, ImpactSummary, LlmResponse};
use sentinel_core::schema::llm_response_schema_json;

#[derive(Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Serialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType")]
    response_mime_type: String,
    temperature: f32,
}

#[derive(Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiSystemInstruction,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Deserialize, Debug)]
struct GeminiCandidatePart {
    text: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GeminiCandidateContent {
    parts: Option<Vec<GeminiCandidatePart>>,
}

#[derive(Deserialize, Debug)]
struct GeminiCandidate {
    content: Option<GeminiCandidateContent>,
}

#[derive(Deserialize, Debug)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<Value>,
}

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
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
            system_prompt,
            schema_hint,
        }
    }

    pub async fn plan(&self, user_request: &str, custom_api_key: Option<&str>) -> Result<LlmResponse, String> {
        let api_key = custom_api_key
            .map(|s| s.to_string())
            .or_else(|| std::env::var("GEMINI_API_KEY").ok())
            .or_else(|| std::env::var("GOOGLE_API_KEY").ok());

        let api_key = match api_key {
            Some(k) if !k.trim().is_empty() => k.trim().to_string(),
            _ => {
                return Err("GEMINI_API_KEY is not set. Using local engine fallback.".to_string());
            }
        };

        let preferred_model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-1.5-flash".to_string());
        let mut models_to_try = vec![preferred_model];
        for candidate in &["gemini-1.5-flash", "gemini-2.0-flash"] {
            if !models_to_try.iter().any(|m| m == candidate) {
                models_to_try.push(candidate.to_string());
            }
        }
        models_to_try.truncate(2);

        let full_system = format!(
            "{}\n\nIMPORTANT: You MUST respond strictly in valid JSON adhering to the following LlmResponse schema:\n{}\n\nAllowed Action types:\n- DeleteFile {{ path, reason }}\n- DeleteFilesMatching {{ root, older_than_days, pattern, reason }}\n- MoveFile {{ from, to, reason }}\n- MoveFilesMatching {{ root, destination, pattern, older_than_days, reason }}\n- ChangePermissions {{ path, mode, recursive, reason }}\n- KillProcess {{ pid_or_name, signal, reason }}\n- CompressDirectory {{ path, output, delete_source, reason }}\n- FindLargeFiles {{ root, min_size_mb }}\n- EmptyTrash\n- ListRunningProcesses {{ filter }}\n\nNEVER emit any RunShellCommand. If ambiguous, return NeedsClarification. If impossible, return CannotDo.",
            self.system_prompt, self.schema_hint
        );

        let body = GeminiRequest {
            contents: vec![GeminiContent {
                role: "user".to_string(),
                parts: vec![GeminiPart {
                    text: format!("Generate an ActionPlan for the following request: \"{}\"", user_request),
                }],
            }],
            system_instruction: GeminiSystemInstruction {
                parts: vec![GeminiPart { text: full_system }],
            },
            generation_config: GeminiGenerationConfig {
                response_mime_type: "application/json".to_string(),
                temperature: 0.1,
            },
        };

        let mut last_error = String::new();

        for target_model in &models_to_try {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                target_model, api_key
            );

            let res = match self.client.post(&url).json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_error = format!("Network error connecting to Gemini API: {}", e);
                    continue;
                }
            };

            if !res.status().is_success() {
                let status = res.status();
                let err_text = res.text().await.unwrap_or_default();
                last_error = format!("Gemini API ({}) returned error HTTP {}: {}", target_model, status, err_text);

                // If model not found (404), try next model in fallback list
                if status == reqwest::StatusCode::NOT_FOUND {
                    tracing::warn!("Model '{}' not available (404); attempting next candidate model...", target_model);
                    continue;
                }
                return Err(last_error);
            }

            let gemini_resp: GeminiResponse = res
                .json()
                .await
                .map_err(|e| format!("Failed to parse Gemini response envelope: {}", e))?;

            if let Some(err) = gemini_resp.error {
                last_error = format!("Gemini error: {}", err);
                continue;
            }

            let raw_text = gemini_resp
                .candidates
                .as_ref()
                .and_then(|c| c.first())
                .and_then(|c| c.content.as_ref())
                .and_then(|c| c.parts.as_ref())
                .and_then(|p| p.first())
                .and_then(|p| p.text.as_ref())
                .ok_or_else(|| "Gemini returned empty candidate content".to_string())?;

            tracing::info!("Successfully synthesized ActionPlan using Google Gemini model: {}", target_model);
            return parse_gemini_json(raw_text, user_request);
        }

        Err(last_error)
    }
}

fn parse_gemini_json(json_str: &str, original_request: &str) -> Result<LlmResponse, String> {
    let clean = json_str.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();

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
                let question = val.get("question").and_then(|q| q.as_str()).unwrap_or("Could you clarify the exact criteria?");
                return Ok(LlmResponse::NeedsClarification { question: question.to_string() });
            }
            if t == "CannotDo" {
                let reason = val.get("reason").and_then(|r| r.as_str()).unwrap_or("This operation is not supported by Sentinel's closed action model.");
                return Ok(LlmResponse::CannotDo { reason: reason.to_string() });
            }
            if t == "Plan" {
                if let Some(plan_val) = val.get("plan") {
                    if let Ok(mut plan) = serde_json::from_value::<ActionPlan>(plan_val.clone()) {
                        if plan.id.is_nil() {
                            plan.id = Uuid::new_v4();
                        }
                        if plan.original_request.is_empty() {
                            plan.original_request = original_request.to_string();
                        }
                        return Ok(LlmResponse::Plan(plan));
                    }
                }
            }
        }

        // If it contains "actions", try to reconstruct ActionPlan
        if let Some(actions_val) = val.get("actions") {
            if let Ok(actions) = serde_json::from_value::<Vec<Action>>(actions_val.clone()) {
                let plan = ActionPlan {
                    id: Uuid::new_v4(),
                    original_request: original_request.to_string(),
                    actions,
                    estimated_impact: ImpactSummary {
                        file_count: val.get("estimated_impact").and_then(|i| i.get("file_count")).and_then(|c| c.as_u64()),
                        total_size_mb: val.get("estimated_impact").and_then(|i| i.get("total_size_mb")).and_then(|s| s.as_f64()),
                        reversible: val.get("estimated_impact").and_then(|i| i.get("reversible")).and_then(|r| r.as_bool()).unwrap_or(false),
                        notes: val.get("estimated_impact").and_then(|i| i.get("notes")).and_then(|n| n.as_str()).unwrap_or("Estimated by Gemini").to_string(),
                    },
                    created_at: Utc::now(),
                };
                return Ok(LlmResponse::Plan(plan));
            }
        }
    }

    Err(format!("Could not deserialize Gemini JSON into ActionPlan or LlmResponse: {}", clean))
}
