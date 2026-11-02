use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const BUILD_TIME_SECS: &str = env!("HARDBACK_BUILD_TIME_SECS");
const GITHUB_REPO: &str = "Ward-Milan/hardback";

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
}

fn get_update_state_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        let dir = PathBuf::from(home).join(".hardback");
        let _ = fs::create_dir_all(&dir);
        dir.join("installed_update.json")
    } else {
        PathBuf::from("/tmp").join("hardback_installed_update.json")
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

/// Helper to compare semver strings like "0.1.1" and "0.1.0"
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

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckInfo, String> {
    tokio::task::spawn_blocking(|| {
        let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);
        let output = Command::new("/usr/bin/curl")
            .args([
                "-s",
                "-f",
                "-m", "10",
                "-H", "User-Agent: Hardback-Desktop-App",
                "-H", "Accept: application/vnd.github.v3+json",
                &url,
            ])
            .output()
            .map_err(|e| format!("Impossible de vérifier les mises à jour : {}", e))?;

        if !output.status.success() {
            return Err("Erreur lors de la communication avec GitHub Releases.".to_string());
        }

        let release: GithubRelease = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Réponse GitHub invalide : {}", e))?;

        // Locate DMG asset
        let dmg_asset = release
            .assets
            .iter()
            .find(|a| a.name.ends_with(".dmg"))
            .ok_or_else(|| "Aucun fichier DMG trouvé dans la dernière version GitHub.".to_string())?;

        let remote_tag = release.tag_name.trim();
        let local_version = CURRENT_VERSION.trim();

        // Check 1: Newer semantic tag
        let has_newer_tag = is_newer_version(remote_tag, local_version);

        // Check 2: Same tag, but DMG asset on GitHub is newer than this binary build time
        let asset_dt = DateTime::parse_from_rfc3339(&dmg_asset.updated_at)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let local_build_time = BUILD_TIME_SECS.parse::<i64>().unwrap_or(0);

        let local_state = read_local_update_state();
        let already_installed_this_asset = local_state
            .last_installed_asset_updated_at
            .as_deref()
            == Some(&dmg_asset.updated_at);

        // An update is available if:
        // - there is a newer semver tag, OR
        // - GitHub asset has a timestamp at least 60s newer than our binary's build time,
        //   AND we haven't already downloaded/applied this exact asset update.
        let is_asset_newer_than_binary = asset_dt > (local_build_time + 60);
        let update_available = !already_installed_this_asset && (has_newer_tag || is_asset_newer_than_binary);

        let release_notes = release
            .body
            .unwrap_or_else(|| "Améliorations de performance, nouveaux correctifs et optimisation générale.".to_string());

        Ok(UpdateCheckInfo {
            update_available,
            current_version: format!("v{}", local_version),
            latest_version: remote_tag.to_string(),
            release_name: release.name.unwrap_or_else(|| format!("Hardback {}", remote_tag)),
            release_notes,
            published_at: release.published_at.unwrap_or_default(),
            asset_name: dmg_asset.name.clone(),
            asset_size: dmg_asset.size,
            asset_updated_at: dmg_asset.updated_at.clone(),
            download_url: dmg_asset.browser_download_url.clone(),
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
    tokio::task::spawn_blocking(move || {
        let temp_dmg_path = PathBuf::from("/tmp/Hardback_Update.dmg");
        if temp_dmg_path.exists() {
            let _ = fs::remove_file(&temp_dmg_path);
        }

        // Spawn curl in the background to download the DMG
        let mut child = Command::new("/usr/bin/curl")
            .args([
                "-L",
                "-f",
                "-o",
                temp_dmg_path.to_str().unwrap(),
                &download_url,
            ])
            .spawn()
            .map_err(|e| format!("Impossible de démarrer le téléchargement : {}", e))?;

        // Monitor download progress
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        let _ = fs::remove_file(&temp_dmg_path);
                        return Err("Le téléchargement de la mise à jour a échoué.".to_string());
                    }
                    break;
                }
                Ok(None) => {
                    if let Ok(metadata) = fs::metadata(&temp_dmg_path) {
                        let bytes = metadata.len();
                        if asset_size > 0 {
                            let percent = ((bytes as f64) / (asset_size as f64) * 100.0).clamp(0.0, 99.0);
                            let _ = app.emit("update-download-progress", percent);
                        }
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => {
                    let _ = fs::remove_file(&temp_dmg_path);
                    return Err(format!("Erreur surveillance téléchargement : {}", e));
                }
            }
        }

        let _ = app.emit("update-download-progress", 100.0);

        // Record that this asset is installed
        save_local_update_state(&asset_updated_at);

        // Prepare helper relaunch script
        let script_path = PathBuf::from("/tmp/hardback_relaunch_installer.sh");
        let script_content = r#"#!/bin/bash
set -e

APP_PID="$1"
DMG_PATH="$2"
MOUNT_POINT="/tmp/HardbackMount_$$"

# 1. Wait for current app process to exit
while kill -0 "$APP_PID" 2>/dev/null; do
    sleep 0.2
done

sleep 0.5

# 2. Attach DMG
mkdir -p "$MOUNT_POINT"
hdiutil attach "$DMG_PATH" -nobrowse -mountpoint "$MOUNT_POINT" -quiet

# 3. Replace /Applications/Hardback.app
if [ -d "$MOUNT_POINT/Hardback.app" ]; then
    rm -rf /Applications/Hardback.app
    cp -R "$MOUNT_POINT/Hardback.app" /Applications/
fi

# 4. Clean up mount and downloaded DMG
diskutil eject "$MOUNT_POINT" 2>/dev/null || hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
rm -rf "$MOUNT_POINT"
rm -f "$DMG_PATH"

# 5. Relaunch Hardback
if [ -d "/Applications/Hardback.app" ]; then
    open /Applications/Hardback.app
fi

rm -f "$0"
"#;

        fs::write(&script_path, script_content)
            .map_err(|e| format!("Impossible d'écrire le script d'installation : {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&script_path).unwrap().permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&script_path, perms);
        }

        let current_pid = std::process::id();

        // Spawn script detached
        let _ = Command::new("/bin/bash")
            .arg(script_path.to_str().unwrap())
            .arg(current_pid.to_string())
            .arg(temp_dmg_path.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Impossible de lancer le script de mise à jour : {}", e))?;

        // Exit process immediately to let helper script replace the app bundle
        std::thread::sleep(Duration::from_millis(100));
        std::process::exit(0);
    })
    .await
    .map_err(|e| e.to_string())?
}

