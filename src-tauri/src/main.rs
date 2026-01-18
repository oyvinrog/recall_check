#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use keyring::Entry;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

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

#[derive(Serialize)]
struct FetchResponse {
    url: String,
    title: String,
    text: String,
}

#[derive(Serialize)]
struct VersionBumpResponse {
    previous: String,
    next: String,
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn bump_semver(version: &str, kind: &str) -> Result<String, String> {
    let parts: Vec<&str> = version.trim().split('.').collect();
    if parts.len() != 3 {
        return Err("Version must be in major.minor.patch format".to_string());
    }
    let major: u64 = parts[0].parse().map_err(|_| "Invalid major version".to_string())?;
    let minor: u64 = parts[1].parse().map_err(|_| "Invalid minor version".to_string())?;
    let patch: u64 = parts[2].parse().map_err(|_| "Invalid patch version".to_string())?;

    let (next_major, next_minor, next_patch) = match kind {
        "major" => (major + 1, 0, 0),
        "minor" => (major, minor + 1, 0),
        "patch" => (major, minor, patch + 1),
        _ => return Err("Unknown bump kind. Use major, minor, or patch.".to_string()),
    };

    Ok(format!("{}.{}.{}", next_major, next_minor, next_patch))
}

fn find_project_root() -> Result<PathBuf, String> {
    let mut current = std::env::current_dir().map_err(|err| err.to_string())?;
    for _ in 0..6 {
        let candidate = current.join("src-tauri").join("tauri.conf.json");
        if candidate.exists() {
            return Ok(current);
        }
        if !current.pop() {
            break;
        }
    }
    Err("Unable to locate project root".to_string())
}

fn replace_cargo_version(path: &Path, next: &str) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut in_package = false;
    let mut previous = None;
    let mut updated = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_package = trimmed == "[package]";
        }
        if in_package && trimmed.starts_with("version") && trimmed.contains('=') {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    previous = Some(line[start + 1..start + 1 + end].to_string());
                    let mut new_line = String::new();
                    new_line.push_str(&line[..start + 1]);
                    new_line.push_str(next);
                    new_line.push_str(&line[start + 1 + end..]);
                    updated.push(new_line);
                    continue;
                }
            }
        }
        updated.push(line.to_string());
    }

    let previous = previous.ok_or_else(|| "Cargo.toml version not found".to_string())?;
    let mut output = updated.join("\n");
    if content.ends_with('\n') {
        output.push('\n');
    }
    fs::write(path, output).map_err(|err| err.to_string())?;
    Ok(previous)
}

fn replace_tauri_version(path: &Path, next: &str) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut previous = None;
    let mut updated = Vec::new();

    for line in content.lines() {
        if line.contains("\"version\"") {
            if let Some(key_pos) = line.find("\"version\"") {
                if let Some(colon_pos) = line[key_pos..].find(':') {
                    let colon = key_pos + colon_pos;
                    if let Some(start_rel) = line[colon..].find('"') {
                        let start = colon + start_rel + 1;
                        if let Some(end_rel) = line[start..].find('"') {
                            let end = start + end_rel;
                            previous = Some(line[start..end].to_string());
                            let mut new_line = String::new();
                            new_line.push_str(&line[..start]);
                            new_line.push_str(next);
                            new_line.push_str(&line[end..]);
                            updated.push(new_line);
                            continue;
                        }
                    }
                }
            }
        }
        updated.push(line.to_string());
    }

    let previous = previous.ok_or_else(|| "tauri.conf.json version not found".to_string())?;
    let mut output = updated.join("\n");
    if content.ends_with('\n') {
        output.push('\n');
    }
    fs::write(path, output).map_err(|err| err.to_string())?;
    Ok(previous)
}

fn read_cargo_version(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut in_package = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_package = trimmed == "[package]";
        }
        if in_package && trimmed.starts_with("version") && trimmed.contains('=') {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    return Ok(line[start + 1..start + 1 + end].to_string());
                }
            }
        }
    }
    Err("Cargo.toml version not found".to_string())
}

fn read_tauri_version(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    for line in content.lines() {
        if line.contains("\"version\"") {
            if let Some(key_pos) = line.find("\"version\"") {
                if let Some(colon_pos) = line[key_pos..].find(':') {
                    let colon = key_pos + colon_pos;
                    if let Some(start_rel) = line[colon..].find('"') {
                        let start = colon + start_rel + 1;
                        if let Some(end_rel) = line[start..].find('"') {
                            let end = start + end_rel;
                            return Ok(line[start..end].to_string());
                        }
                    }
                }
            }
        }
    }
    Err("tauri.conf.json version not found".to_string())
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

#[tauri::command]
async fn fetch_url_text(url: String) -> Result<FetchResponse, String> {
    let parsed_url = reqwest::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    let client = reqwest::Client::new();

    let response = client
        .get(parsed_url.clone())
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !response.status().is_success() {
        return Err(format!("URL request failed with {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = response.text().await.map_err(|err| err.to_string())?;
    let mut title = String::new();
    let text = if content_type.contains("text/html") {
        let document = Html::parse_document(&body);
        let title_selector = Selector::parse("title").unwrap();
        if let Some(found) = document.select(&title_selector).next() {
            title = normalize_whitespace(&found.text().collect::<Vec<_>>().join(" "));
        }

        let body_selector = Selector::parse("body").unwrap();
        let raw_text = if let Some(found) = document.select(&body_selector).next() {
            found.text().collect::<Vec<_>>().join(" ")
        } else {
            document.root_element().text().collect::<Vec<_>>().join(" ")
        };
        normalize_whitespace(&raw_text)
    } else {
        normalize_whitespace(&body)
    };

    if text.is_empty() {
        return Err("No text extracted from URL".to_string());
    }

    Ok(FetchResponse { url, title, text })
}

#[tauri::command]
fn bump_version(kind: Option<String>) -> Result<VersionBumpResponse, String> {
    let bump_kind = kind.unwrap_or_else(|| "patch".to_string());
    let root = find_project_root()?;
    let cargo_path = root.join("src-tauri").join("Cargo.toml");
    let tauri_path = root.join("src-tauri").join("tauri.conf.json");

    let current_cargo = read_cargo_version(&cargo_path)?;
    let current_tauri = read_tauri_version(&tauri_path)?;

    if current_cargo != current_tauri {
        return Err("Version mismatch between Cargo.toml and tauri.conf.json".to_string());
    }

    let next = bump_semver(&current_cargo, &bump_kind)?;
    replace_cargo_version(&cargo_path, &next)?;
    replace_tauri_version(&tauri_path, &next)?;

    Ok(VersionBumpResponse {
        previous: current_cargo,
        next,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_api_key_status,
            set_api_key,
            evaluate_recall,
            fetch_url_text,
            bump_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
