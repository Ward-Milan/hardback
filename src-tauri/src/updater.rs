use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const BUILD_TIME_SECS: &str = env!("HARDBACK_BUILD_TIME_SECS");
const GITHUB_REPO: &str = "Ward-Milan/hardback";
const APP_BUNDLE_NAME: &str = "Hardback.app";
const USER_AGENT: &str = "Hardback-Desktop-App";
const STATE_DIR_NAME: &str = ".hardback";

#[derive(Serialize, Deserialize, Default)]
struct LocalUpdateState {
    last_installed_asset_updated_at: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GithubAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    updated_at: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UpdateCheckInfo {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub asset_name: String,
    pub asset_size: u64,
    pub asset_updated_at: String,
    pub download_url: String,
    #[serde(default)]
    pub asset_digest: Option<String>,
}

pub(crate) fn validate_update_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL de mise à jour vide.".to_string());
    }
    if url.starts_with('-') || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("URL de mise à jour invalide.".to_string());
    }
    let lower = url.to_ascii_lowercase();
    let repo_prefix = format!(
        "https://github.com/{}/releases/download/",
        GITHUB_REPO.to_ascii_lowercase()
    );
    if lower.starts_with(&repo_prefix) {
        if !lower.ends_with(".dmg") {
            return Err("L'archive de mise à jour doit être un fichier .dmg.".to_string());
        }
        return Ok(());
    }
    if lower.starts_with("https://objects.githubusercontent.com/") {
        return Ok(());
    }
    Err("Origine de téléchargement non autorisée.".to_string())
}

fn get_update_state_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        let dir = PathBuf::from(home).join(STATE_DIR_NAME);
        let _ = fs::create_dir_all(&dir);
        dir.join("installed_update.json")
    } else {
        std::env::temp_dir().join("hardback_installed_update.json")
    }
}

fn read_local_update_state() -> LocalUpdateState {
    let path = get_update_state_path();
    if let Ok(bytes) = fs::read(&path) {
        if let Ok(state) = serde_json::from_slice::<LocalUpdateState>(&bytes) {
            return state;
        }
    }
    LocalUpdateState::default()
}

fn save_local_update_state(asset_updated_at: &str) {
    let path = get_update_state_path();
    let state = LocalUpdateState {
        last_installed_asset_updated_at: Some(asset_updated_at.to_string()),
    };
    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(path, json);
    }
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse_nums = |s: &str| -> Vec<u64> {
        s.trim_start_matches('v')
            .split('.')
            .filter_map(|part| part.split('-').next().and_then(|p| p.parse::<u64>().ok()))
            .collect()
    };
    let l_nums = parse_nums(latest);
    let c_nums = parse_nums(current);
    for i in 0..l_nums.len().max(c_nums.len()) {
        let l = l_nums.get(i).copied().unwrap_or(0);
        let c = c_nums.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        } else if l < c {
            return false;
        }
    }
    false
}

fn fetch_latest_release() -> Result<GithubRelease, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
    let output = Command::new("/usr/bin/curl")
        .args([
            "-s",
            "-f",
            "--proto",
            "=https",
            "--tlsv1.2",
            "-m",
            "10",
            "-H",
            &format!("User-Agent: {}", USER_AGENT),
            "-H",
            "Accept: application/vnd.github.v3+json",
            "--",
            &url,
        ])
        .output()
        .map_err(|e| format!("Impossible de vérifier les mises à jour : {}", e))?;

    if !output.status.success() {
        return Err("Erreur lors de la communication avec GitHub Releases.".to_string());
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Réponse GitHub invalide : {}", e))
}

fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "Chemin temporaire invalide.".to_string())?;
    let output = Command::new("/usr/bin/shasum")
        .args(["-a", "256", "--", path_str])
        .output()
        .map_err(|e| format!("Impossible de calculer le SHA-256 : {}", e))?;

    if !output.status.success() {
        return Err("Échec du calcul de l'empreinte SHA-256.".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .split_whitespace()
        .next()
        .map(|hex| hex.to_ascii_lowercase())
        .ok_or_else(|| "Sortie shasum invalide.".to_string())
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckInfo, String> {
    tokio::task::spawn_blocking(|| {
        let release = fetch_latest_release()?;

        let dmg_asset = release
            .assets
            .iter()
            .find(|a| a.name.ends_with(".dmg"))
            .ok_or_else(|| "Aucun fichier DMG trouvé dans la dernière version GitHub.".to_string())?;

        let remote_tag = release.tag_name.trim();
        let local_version = CURRENT_VERSION.trim();
        let has_newer_tag = is_newer_version(remote_tag, local_version);

        let asset_dt = DateTime::parse_from_rfc3339(&dmg_asset.updated_at)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let local_build_time = BUILD_TIME_SECS.parse::<i64>().unwrap_or(0);

        let local_state = read_local_update_state();
        let already_installed_this_asset = local_state
            .last_installed_asset_updated_at
            .as_deref()
            == Some(&dmg_asset.updated_at);

        let is_asset_newer_than_binary = asset_dt > (local_build_time + 60);
        let update_available =
            !already_installed_this_asset && (has_newer_tag || is_asset_newer_than_binary);

        let release_notes = release.body.unwrap_or_else(|| {
            "Améliorations de performance, nouveaux correctifs et optimisation générale."
                .to_string()
        });

        Ok(UpdateCheckInfo {
            update_available,
            current_version: format!("v{}", local_version),
            latest_version: remote_tag.to_string(),
            release_name: release
                .name
                .unwrap_or_else(|| format!("Hardback {}", remote_tag)),
            release_notes,
            published_at: release.published_at.unwrap_or_default(),
            asset_name: dmg_asset.name.clone(),
            asset_size: dmg_asset.size,
            asset_updated_at: dmg_asset.updated_at.clone(),
            download_url: dmg_asset.browser_download_url.clone(),
            asset_digest: dmg_asset.digest.clone(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    download_url: String,
    asset_size: u64,
    asset_updated_at: String,
) -> Result<(), String> {
    validate_update_url(&download_url)?;

    tokio::task::spawn_blocking(move || {
        // Re-verify download URL against GitHub Releases API and retrieve authoritative size/digest
        let release = fetch_latest_release()?;
        let official_asset = release
            .assets
            .iter()
            .find(|a| a.browser_download_url == download_url && a.name.ends_with(".dmg"))
            .ok_or_else(|| {
                "URL de téléchargement refusée : l'asset ne correspond pas à la dernière release officielle."
                    .to_string()
            })?;

        let work_dir =
            std::env::temp_dir().join(format!("hardsuite_upd_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&work_dir)
            .map_err(|e| format!("Impossible de créer le dossier temporaire : {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&work_dir, fs::Permissions::from_mode(0o700));
        }

        let temp_dmg_path = work_dir.join("update.dmg");
        let temp_dmg_str = temp_dmg_path
            .to_str()
            .ok_or_else(|| "Chemin temporaire invalide.".to_string())?
            .to_string();

        let expected_size = if official_asset.size > 0 {
            official_asset.size
        } else {
            asset_size
        };

        let mut child = Command::new("/usr/bin/curl")
            .args([
                "-L",
                "-f",
                "--proto",
                "=https",
                "--tlsv1.2",
                "--max-time",
                "300",
                "-o",
                &temp_dmg_str,
                "--",
                &official_asset.browser_download_url,
            ])
            .spawn()
            .map_err(|e| {
                let _ = fs::remove_dir_all(&work_dir);
                format!("Impossible de démarrer le téléchargement : {}", e)
            })?;

        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        let _ = fs::remove_dir_all(&work_dir);
                        return Err("Le téléchargement de la mise à jour a échoué.".to_string());
                    }
                    break;
                }
                Ok(None) => {
                    if let Ok(metadata) = fs::metadata(&temp_dmg_path) {
                        let bytes = metadata.len();
                        if expected_size > 0 {
                            let percent =
                                ((bytes as f64) / (expected_size as f64) * 100.0).clamp(0.0, 99.0);
                            let _ = app.emit("update-download-progress", percent);
                        }
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => {
                    let _ = fs::remove_dir_all(&work_dir);
                    return Err(format!("Erreur surveillance téléchargement : {}", e));
                }
            }
        }

        let dmg_meta = fs::metadata(&temp_dmg_path).map_err(|e| {
            let _ = fs::remove_dir_all(&work_dir);
            format!("Fichier téléchargé introuvable : {}", e)
        })?;

        if dmg_meta.len() == 0 || (expected_size > 0 && dmg_meta.len() != expected_size) {
            let _ = fs::remove_dir_all(&work_dir);
            return Err("Taille du fichier téléchargé non conforme.".to_string());
        }

        if let Some(ref digest) = official_asset.digest {
            if let Some(expected_hex) = digest.strip_prefix("sha256:") {
                let actual_hex = compute_file_sha256(&temp_dmg_path).inspect_err(|_| {
                    let _ = fs::remove_dir_all(&work_dir);
                })?;
                if !actual_hex.eq_ignore_ascii_case(expected_hex.trim()) {
                    let _ = fs::remove_dir_all(&work_dir);
                    return Err(
                        "Échec de vérification SHA-256 : l'image téléchargée est corrompue ou altérée."
                            .to_string(),
                    );
                }
            }
        }

        let _ = app.emit("update-download-progress", 100.0);
        save_local_update_state(&asset_updated_at);

        let script_path = work_dir.join("relaunch_installer.sh");
        let script_content = format!(
            r#"#!/bin/bash
set -euo pipefail

APP_PID="$1"
DMG_PATH="$2"
WORK_DIR="$3"
MOUNT_POINT="$WORK_DIR/mnt"
APP_NAME="{app_name}"
TARGET_APP="/Applications/$APP_NAME"
STAGING_APP="/Applications/$APP_NAME.staging.$$"

cleanup() {{
    diskutil eject "$MOUNT_POINT" 2>/dev/null || hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
    rm -rf "$STAGING_APP" "$WORK_DIR"
}}
trap cleanup EXIT

while kill -0 "$APP_PID" 2>/dev/null; do
    sleep 0.2
done

sleep 0.5

mkdir -p "$MOUNT_POINT"
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT" -quiet

if [ ! -d "$MOUNT_POINT/$APP_NAME" ]; then
    exit 1
fi

codesign --verify --deep --strict "$MOUNT_POINT/$APP_NAME"

rm -rf "$STAGING_APP"
cp -R "$MOUNT_POINT/$APP_NAME" "$STAGING_APP"
rm -rf "$TARGET_APP"
mv "$STAGING_APP" "$TARGET_APP"

if [ -d "$TARGET_APP" ]; then
    open "$TARGET_APP"
fi
"#,
            app_name = APP_BUNDLE_NAME
        );

        fs::write(&script_path, script_content).map_err(|e| {
            let _ = fs::remove_dir_all(&work_dir);
            format!("Impossible d'écrire le script d'installation : {}", e)
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = fs::Permissions::from_mode(0o700);
            fs::set_permissions(&script_path, perms).map_err(|e| {
                let _ = fs::remove_dir_all(&work_dir);
                format!("Impossible de sécuriser le script d'installation : {}", e)
            })?;
        }

        let script_str = script_path
            .to_str()
            .ok_or_else(|| "Chemin script invalide.".to_string())?
            .to_string();
        let work_dir_str = work_dir
            .to_str()
            .ok_or_else(|| "Chemin temporaire invalide.".to_string())?
            .to_string();
        let current_pid = std::process::id();

        Command::new("/bin/bash")
            .arg(&script_str)
            .arg(current_pid.to_string())
            .arg(&temp_dmg_str)
            .arg(&work_dir_str)
            .spawn()
            .map_err(|e| {
                let _ = fs::remove_dir_all(&work_dir);
                format!("Impossible de lancer le script de mise à jour : {}", e)
            })?;

        std::thread::sleep(Duration::from_millis(100));
        std::process::exit(0);
    })
    .await
    .map_err(|e| e.to_string())?
}
