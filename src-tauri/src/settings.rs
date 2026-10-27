use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Copie d'abord vers le SSD rapide puis vers les disques plus lents
    pub smart_cascading: bool,
    /// Double la vitesse en vérifiant uniquement à la volée sans relire le disque cible
    pub fast_inline_verify_only: bool,
    /// Parallélisme accru (16 threads + buffers 16 Mo) pour saturer le Thunderbolt / SSD
    pub turbo_io: bool,
    /// Ignore automatiquement .DS_Store, Thumbs.db, ._* et les fichiers temporaires
    pub ignore_junk_files: bool,
    /// Ignore les fichiers proxies/miniatures caméras (.LRV, .THM) pour gagner de la place
    pub ignore_camera_proxies: bool,
    /// Crée les fichiers .txt et .mhl directement sur le disque de destination
    pub write_reports_on_disk: bool,
    /// Range automatiquement les fichiers dans des sous-dossiers Vidéos / Photos / Audio
    pub sort_by_media_type: bool,
    /// Supprime les fichiers de la source UNIQUEMENT après vérification à 100%
    pub move_mode_delete_source: bool,
    /// Éjecte automatiquement la carte SD / le support source quand le transfert est 100% vérifié
    #[serde(default)]
    pub auto_eject_source: bool,
    /// Lancer automatiquement Hardback au démarrage du Mac en arrière-plan
    #[serde(default)]
    pub launch_at_startup: bool,
    /// Affiche une notification macOS et joue un son discret quand un transfert est terminé
    pub sound_notification: bool,
    /// URL Webhook optionnelle (Discord / Slack / HTTP) appelée en fin de transfert
    pub webhook_url: String,
    /// Algorithme de vérification mathématique ("xxh64" ou "xxh3")
    #[serde(default = "default_hash_algorithm")]
    pub hash_algorithm: String,
}

fn default_hash_algorithm() -> String {
    "xxh64".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            smart_cascading: true,
            fast_inline_verify_only: false,
            turbo_io: true,
            ignore_junk_files: false,
            ignore_camera_proxies: false,
            write_reports_on_disk: false,
            sort_by_media_type: false,
            move_mode_delete_source: false,
            auto_eject_source: false,
            launch_at_startup: false,
            sound_notification: true,
            webhook_url: String::new(),
            hash_algorithm: default_hash_algorithm(),
        }
    }
}

fn settings_file_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".hardback");
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub fn internal_reports_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".hardback").join("reports");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn load_settings() -> AppSettings {
    let path = settings_file_path();
    if !path.exists() {
        let default = AppSettings::default();
        let _ = save_settings(&default);
        return default;
    }
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<AppSettings>(&content).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save_settings(settings: &AppSettings) -> Result<AppSettings, String> {
    let path = settings_file_path();
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(settings.clone())
}
