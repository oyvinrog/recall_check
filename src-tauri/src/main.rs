#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use keyring::Entry;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::json;

const KEYRING_SERVICE: &str = "RecallCheck";
const KEYRING_USER: &str = "openai_api_key";

#[derive(Serialize)]
struct ApiKeyStatus {
    exists: bool,
}

#[derive(Deserialize)]
struct EvaluationRequest {
    reference: String,
    recall: String,
}

#[derive(Serialize, Deserialize)]
struct IncorrectSpan {
    start: usize,
    end: usize,
    comment: String,
}

#[derive(Serialize, Deserialize)]
struct EvaluationResponse {
    grade: String,
    incorrect_spans: Vec<IncorrectSpan>,
    missing: Vec<String>,
    summary: String,
}

#[tauri::command]
fn get_api_key_status() -> Result<ApiKeyStatus, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| err.to_string())?;
    let exists = entry.get_password().is_ok();
    Ok(ApiKeyStatus { exists })
}

#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| err.to_string())?;
    entry.set_password(&key).map_err(|err| err.to_string())
}

#[tauri::command]
async fn evaluate_recall(payload: EvaluationRequest) -> Result<EvaluationResponse, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| err.to_string())?;
    let api_key = entry
        .get_password()
        .map_err(|_| "Missing API key".to_string())?;

    let client = reqwest::Client::new();
    let prompt = format!(
        "You are grading a recall exercise. Compare the reference text to the user's recall.\n\nReference:\n{}\n\nRecall:\n{}\n\nReturn STRICT JSON with keys: grade (A-F), incorrect_spans (array of objects with start, end, comment), missing (array of missing phrases), summary (1-2 sentences). The start/end are character offsets into the recall string (0-based, end exclusive). Only point out incorrect parts; do not mark stylistic changes as incorrect. If recall is perfect, incorrect_spans must be empty and missing must be empty.",
        payload.reference,
        payload.recall
    );

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&json!({
            "model": "gpt-4o-mini",
            "messages": [
                { "role": "system", "content": "You are a strict grader that responds only with JSON." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.2
        }))
        .send()
        .await
        .map_err(|err| err.to_string())?;

    let value: serde_json::Value = response.json().await.map_err(|err| err.to_string())?;
    let content = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .ok_or_else(|| "Unexpected OpenAI response".to_string())?;

    let cleaned = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    let parsed: EvaluationResponse = serde_json::from_str(&cleaned)
        .map_err(|err| format!("Failed to parse model output: {}", err))?;

    Ok(parsed)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_api_key_status,
            set_api_key,
            evaluate_recall
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
