use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestHistoryEntry {
    pub id: String,
    pub source_name: String,
    pub source_path: String,
    #[serde(default)]
    pub source_paths: Vec<String>,
    pub destination_paths: Vec<String>,
    pub total_files: usize,
    pub verified_files: usize,
    pub resumed_files: usize,
    pub total_bytes: u64,
    pub duration_secs: f64,
    pub average_speed_bps: f64,
    pub status: String, // "completed" | "paused" | "interrupted" | "failed"
    pub error_message: Option<String>,
    pub algorithm: String,
    pub report_paths: Vec<String>,
    pub created_at: String,
}

fn history_file_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".hardback");
    let _ = fs::create_dir_all(&dir);
    dir.join("ingest_history.json")
}

pub fn load_history() -> Vec<IngestHistoryEntry> {
    let path = history_file_path();
    if !path.exists() {
        return Vec::new();
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<Vec<IngestHistoryEntry>>(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_or_update_history_entry(entry: IngestHistoryEntry) -> Vec<IngestHistoryEntry> {
    let mut list = load_history();
    if let Some(existing) = list.iter_mut().find(|e| e.id == entry.id) {
        *existing = entry;
    } else {
        list.insert(0, entry);
    }
    if list.len() > 50 {
        list.truncate(50);
    }
    let path = history_file_path();
    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let _ = fs::write(path, json);
    }
    list
}

pub fn delete_history_entry(id: &str) -> Vec<IngestHistoryEntry> {
    let mut list = load_history();
    list.retain(|e| e.id != id);
    let path = history_file_path();
    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let _ = fs::write(path, json);
    }
    list
}
