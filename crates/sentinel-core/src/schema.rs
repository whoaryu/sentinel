use schemars::{schema_for, schema::RootSchema};
use crate::action::{Action, ActionPlan, LlmResponse};

pub fn action_schema() -> RootSchema {
    schema_for!(Action)
}

pub fn action_plan_schema() -> RootSchema {
    schema_for!(ActionPlan)
}

pub fn llm_response_schema() -> RootSchema {
    schema_for!(LlmResponse)
}

pub fn action_plan_schema_json() -> serde_json::Value {
    serde_json::to_value(action_plan_schema()).unwrap_or_default()
}

pub fn llm_response_schema_json() -> serde_json::Value {
    serde_json::to_value(llm_response_schema()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_generation() {
        let plan_schema = action_plan_schema_json();
        assert!(plan_schema.get("properties").is_some() || plan_schema.get("definitions").is_some());
        
        let llm_schema = llm_response_schema_json();
        assert!(!llm_schema.is_null());
    }
}
