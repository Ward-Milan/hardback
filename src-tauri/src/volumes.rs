use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use sysinfo::Disks;
use walkdir::WalkDir;

static DEVICE_CLASS_CACHE: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDevice {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub is_removable: bool,
    pub device_type: String, // "sd_card" | "ssd" | "hdd" | "internal_ssd"
    pub protocol_label: String, // e.g., "Carte SD", "SSD Externe", "Disque Dur HDD", "SSD Interne"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInspection {
    pub paths: Vec<String>,
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_package: bool,
    pub exists: bool,
    pub file_count: usize,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub device_type: String,
    pub summary_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubfolderEntry {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

fn dir_has_visible_subdirectories(dir: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with('.')
                        && name != "System Volume Information"
                        && name != "$RECYCLE.BIN"
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn list_subdirectories(root_path: &str) -> Result<Vec<SubfolderEntry>, String> {
    let p = Path::new(root_path);
    if !p.exists() || !p.is_dir() {
        return Err("Ce chemin n'est pas un dossier.".to_string());
    }
    let mut subs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(p) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.')
                        || name == "System Volume Information"
                        || name == "$RECYCLE.BIN"
                    {
                        continue;
                    }
                    let sub_path = entry.path();
                    let has_children = dir_has_visible_subdirectories(&sub_path);
                    subs.push(SubfolderEntry {
                        name,
                        path: sub_path.to_string_lossy().to_string(),
                        has_children,
                    });
                }
            }
        }
    }
    subs.sort_by_key(|a| a.name.to_lowercase());
    Ok(subs)
}

/// Safely ejects a mounted external volume / SD card.
pub fn eject_storage_volume(raw_path: &str) -> Result<String, String> {
    if raw_path == "/" || raw_path.is_empty() {
        return Err("Impossible d'éjecter le disque système principal.".to_string());
    }

    // If a subfolder on /Volumes/CARD/DCIM was passed, extract the /Volumes/CARD root
    let volume_root = if raw_path.starts_with("/Volumes/") {
        let parts: Vec<&str> = raw_path.split('/').collect();
        if parts.len() >= 3 {
            format!("/Volumes/{}", parts[2])
        } else {
            raw_path.to_string()
        }
    } else {
        raw_path.to_string()
    };

    #[cfg(target_os = "macos")]
    {
        let out = Command::new("diskutil")
            .args(["eject", &volume_root])
            .output()
            .map_err(|e| format!("Erreur lors de l'appel à diskutil : {}", e))?;
        if out.status.success() {
            Ok(format!("Le support {} a été éjecté en toute sécurité.", volume_root))
        } else {
            let err_str = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if err_str.is_empty() {
                format!("Impossible d'éjecter {} (vérifiez qu'aucun fichier n'est ouvert).", volume_root)
            } else {
                err_str
            })
        }
    }

    #[cfg(target_os = "linux")]
    {
        let out = Command::new("umount")
            .arg(&volume_root)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(format!("Support {} démonté.", volume_root))
        } else {
            Err(String::from_utf8_lossy(&out.stderr).to_string())
        }
    }

    #[cfg(target_os = "windows")]
    {
        Err("L'éjection directe n'est pas disponible sur ce volume.".to_string())
    }
}

/// Opens a folder or reveals a file in macOS Finder / Windows Explorer / Linux File Manager.
pub fn open_in_file_manager(raw_path: &str) -> Result<(), String> {
    let p = Path::new(raw_path);
    let target = if p.exists() {
        p.to_path_buf()
    } else if let Some(parent) = p.parent() {
        if parent.exists() {
            parent.to_path_buf()
        } else {
            return Err(format!("Le dossier n'existe pas : {}", raw_path));
        }
    } else {
        return Err(format!("Le dossier n'existe pas : {}", raw_path));
    };

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le Finder : {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Detect all mounted storage volumes across macOS, Linux, and Windows.
pub fn list_storage_devices() -> Vec<StorageDevice> {
    let disks = Disks::new_with_refreshed_list();
    let mut devices: Vec<StorageDevice> = Vec::new();
    let mut seen_mounts: std::collections::HashSet<String> = std::collections::HashSet::new();

    for disk in disks.list() {
        let mount_path = disk.mount_point().to_string_lossy().to_string();

        if mount_path.starts_with("/System/Volumes/") && mount_path != "/System/Volumes/Data" {
            continue;
        }
        if mount_path.starts_with("/dev")
            || mount_path.starts_with("/proc")
            || mount_path.starts_with("/sys")
            || mount_path.starts_with("/run")
            || mount_path.starts_with("/private")
        {
            continue;
        }

        let normalized_mount = if mount_path == "/System/Volumes/Data" {
            "/".to_string()
        } else {
            mount_path.clone()
        };

        if seen_mounts.contains(&normalized_mount) {
            continue;
        }
        seen_mounts.insert(normalized_mount.clone());

        let total = disk.total_space();
        let avail = disk.available_space();
        let used = total.saturating_sub(avail);
        let is_removable = disk.is_removable();
        let fs = disk.file_system().to_string_lossy().to_uppercase();
        let disk_kind = format!("{:?}", disk.kind()).to_uppercase(); // "SSD" | "HDD" | "UNKNOWN"

        let raw_name = disk.name().to_string_lossy().to_string();
        let display_name = if normalized_mount == "/" {
            if raw_name.is_empty() || raw_name.starts_with("/dev") {
                "Macintosh HD".to_string()
            } else {
                raw_name
            }
        } else {
            Path::new(&normalized_mount)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| {
                    if raw_name.is_empty() {
                        normalized_mount.clone()
                    } else {
                        raw_name
                    }
                })
        };

        let (device_type, protocol_label) = classify_device(
            &normalized_mount,
            &display_name,
            &fs,
            &disk_kind,
            is_removable,
            total,
        );

        devices.push(StorageDevice {
            id: format!("vol::{}", normalized_mount),
            name: display_name,
            mount_point: normalized_mount,
            file_system: if fs.is_empty() { "APFS".to_string() } else { fs },
            total_bytes: total,
            available_bytes: avail,
            used_bytes: used,
            is_removable,
            device_type,
            protocol_label,
        });
    }

    devices.sort_by_key(|d| match d.device_type.as_str() {
        "sd_card" => 0,
        "ssd" => 1,
        "hdd" => 2,
        "internal_ssd" => 3,
        _ => 4,
    });

    devices
}

fn classify_device(
    mount_point: &str,
    name: &str,
    fs: &str,
    disk_kind: &str,
    is_removable: bool,
    total_bytes: u64,
) -> (String, String) {
    if mount_point == "/" {
        return ("internal_ssd".to_string(), "SSD Interne".to_string());
    }

    let cache_key = format!("{}:{}", mount_point, total_bytes);
    let cache = DEVICE_CLASS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.get(&cache_key) {
            return cached.clone();
        }
    }

    let result = classify_device_uncached(mount_point, name, fs, disk_kind, is_removable, total_bytes);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(cache_key, result.clone());
    }
    result
}

fn classify_device_uncached(
    mount_point: &str,
    name: &str,
    fs: &str,
    disk_kind: &str,
    is_removable: bool,
    total_bytes: u64,
) -> (String, String) {
    let upper_name = name.to_uppercase();
    let is_external_mount = mount_point.starts_with("/Volumes/")
        || mount_point.starts_with("/media/")
        || mount_point.starts_with("/mnt/");

    // On macOS, query `diskutil info` quickly for accurate Protocol & Solid State detection
    #[cfg(target_os = "macos")]
    if is_external_mount {
        if let Ok(output) = Command::new("diskutil").arg("info").arg(mount_point).output() {
            let info = String::from_utf8_lossy(&output.stdout);
            let info_upper = info.to_uppercase();

            if info_upper.contains("SECURE DIGITAL")
                || info_upper.contains("SD CARD")
                || info_upper.contains("SDXC")
                || info_upper.contains("CFEXPRESS")
                || info_upper.contains("COMPACT FLASH")
                || info_upper.contains("READER")
            {
                return ("sd_card".to_string(), "Carte SD / Média".to_string());
            }

            // Check parent device name (e.g. "PRO-READER", "Lexar Dual-Slot Reader", "Sony MRW")
            let parent_is_reader = if let Some(part_line) = info.lines().find(|l| l.contains("Part of Whole:")) {
                let parent_disk = part_line.split(':').nth(1).unwrap_or("").trim();
                if !parent_disk.is_empty() {
                    Command::new("diskutil")
                        .arg("info")
                        .arg(parent_disk)
                        .output()
                        .map(|o| {
                            let p_info = String::from_utf8_lossy(&o.stdout).to_uppercase();
                            p_info.contains("READER")
                                || p_info.contains("SDXC")
                                || p_info.contains("CARD")
                        })
                        .unwrap_or(false)
                } else {
                    false
                }
            } else {
                false
            };

            if parent_is_reader {
                return ("sd_card".to_string(), "Carte SD / Média".to_string());
            }

            // Removable media <= 1 TB with FAT/ExFAT is a camera memory card (SD, CFexpress, microSD)
            let is_card_by_specs = is_removable
                && total_bytes <= 1024 * 1024 * 1024 * 1024
                && (fs.contains("EXFAT") || fs.contains("FAT") || fs.contains("MSDOS"));

            if is_card_by_specs {
                return ("sd_card".to_string(), "Carte SD / Média".to_string());
            }

            let is_thunderbolt_or_pcie =
                info_upper.contains("THUNDERBOLT") || info_upper.contains("PCI");
            let is_usb = info_upper.contains("PROTOCOL:                  USB")
                || info_upper.contains("PROTOCOL:                 USB");
            let is_solid_state_yes = info_upper.contains("SOLID STATE:               YES")
                || info_upper.contains("SOLID STATE:              YES")
                || disk_kind.contains("SSD");
            let is_solid_state_no = info_upper.contains("SOLID STATE:               NO")
                || info_upper.contains("SOLID STATE:              NO")
                || disk_kind.contains("HDD");
            let is_solid_state_unknown = info_upper.contains("SOLID STATE:               INFO NOT AVAILABLE")
                || info_upper.contains("SOLID STATE:              INFO NOT AVAILABLE");

            let name_hints_ssd = upper_name.contains("SSD")
                || upper_name.contains("NVME")
                || upper_name.contains("EXTREME")
                || upper_name.contains("T7")
                || upper_name.contains("T9")
                || upper_name.contains("X8")
                || upper_name.contains("X9")
                || upper_name.contains("X10")
                || info_upper.contains("SSD")
                || info_upper.contains("NVME");

            if is_solid_state_no && !is_solid_state_yes {
                return ("hdd".to_string(), "Disque Dur (HDD)".to_string());
            }
            if is_thunderbolt_or_pcie && is_solid_state_yes {
                return ("ssd".to_string(), "SSD Thunderbolt / NVMe".to_string());
            }
            if is_solid_state_yes {
                return ("ssd".to_string(), "SSD Externe".to_string());
            }
            // USB-to-SATA bridges for mechanical HDDs (e.g. ASMedia ASM1352R, WD, Seagate, LaCie)
            // report "Protocol: USB" and "Solid State: Info not available".
            if (is_usb || is_solid_state_unknown) && !name_hints_ssd {
                return ("hdd".to_string(), "Disque Dur (HDD)".to_string());
            }
            if is_thunderbolt_or_pcie {
                return ("ssd".to_string(), "SSD Thunderbolt".to_string());
            }
        }
    }

    let looks_like_card = upper_name.contains("SD")
        || upper_name.contains("CARD")
        || upper_name.contains("EOS")
        || upper_name.contains("SONY")
        || upper_name.contains("LUMIX")
        || upper_name.contains("RED")
        || upper_name.contains("ARRI")
        || upper_name.contains("BMD")
        || upper_name.contains("NIKON")
        || upper_name.contains("FUJI")
        || upper_name.contains("DCIM")
        || ((fs.contains("EXFAT") || fs.contains("FAT") || fs.contains("MSDOS"))
            && is_removable
            && total_bytes <= 512 * 1024 * 1024 * 1024);

    if looks_like_card {
        ("sd_card".to_string(), "Carte SD".to_string())
    } else if disk_kind.contains("HDD") {
        ("hdd".to_string(), "Disque Dur (HDD)".to_string())
    } else if is_removable || is_external_mount {
        ("ssd".to_string(), "SSD Externe".to_string())
    } else {
        ("internal_ssd".to_string(), "Disque Interne".to_string())
    }
}

/// Inspects a single path (folder, drive, or single file)
pub fn inspect_path_details(raw_path: &str) -> Result<PathInspection, String> {
    inspect_multiple_paths(&[raw_path.to_string()])
}

/// Inspects one or multiple paths (e.g. 1 folder, 1 video file, or 400 selected photos)
/// and packages them into a single lightweight summary so the UI stays fast and clean.
pub fn inspect_multiple_paths(raw_paths: &[String]) -> Result<PathInspection, String> {
    if raw_paths.is_empty() {
        return Err("Aucun chemin sélectionné.".to_string());
    }

    let first_path = PathBuf::from(&raw_paths[0]);
    if !first_path.exists() {
        return Err(format!("Le chemin n'existe pas : {}", raw_paths[0]));
    }

    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    let mut photos_count = 0usize;
    let mut videos_count = 0usize;
    let mut audio_count = 0usize;

    let mut count_ext = |path: &Path| {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            match ext.to_ascii_lowercase().as_str() {
                "jpg" | "jpeg" | "png" | "cr2" | "cr3" | "arw" | "nef" | "dng" | "raf" | "heic"
                | "tif" | "tiff" | "webp" => photos_count += 1,
                "mov" | "mp4" | "mxf" | "r3d" | "braw" | "ari" | "mkv" | "avi" | "mts" => {
                    videos_count += 1
                }
                "wav" | "mp3" | "aif" | "aiff" | "flac" | "m4a" => audio_count += 1,
                _ => {}
            }
        }
    };

    for raw in raw_paths {
        let p = PathBuf::from(raw);
        if !p.exists() {
            continue;
        }
        if p.is_dir() {
            for entry in WalkDir::new(&p)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if entry.file_type().is_file() {
                    let fname = entry.file_name().to_string_lossy();
                    if fname == ".DS_Store" || fname.ends_with(".hardback.part") {
                        continue;
                    }
                    file_count += 1;
                    count_ext(entry.path());
                    if let Ok(meta) = entry.metadata() {
                        total_bytes += meta.len();
                    }
                }
            }
        } else if let Ok(meta) = p.metadata() {
            file_count += 1;
            count_ext(&p);
            total_bytes += meta.len();
        }
    }

    // Available space on the volume hosting the first path
    let disks = Disks::new_with_refreshed_list();
    let mut available_bytes = 0u64;
    let mut best_prefix_len = 0usize;
    for disk in disks.list() {
        let mp = disk.mount_point();
        if first_path.starts_with(mp) {
            let len = mp.as_os_str().len();
            if len >= best_prefix_len {
                best_prefix_len = len;
                available_bytes = disk.available_space();
            }
        }
    }

    let is_multi_selection = raw_paths.len() > 1;
    let is_single_dir = raw_paths.len() == 1 && first_path.is_dir();

    let name = if is_multi_selection {
        let parent_name = first_path
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Sélection".to_string());
        format!("Package • {} éléments ({})", raw_paths.len(), parent_name)
    } else {
        first_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| raw_paths[0].clone())
    };

    let mut breakdown = Vec::new();
    if videos_count > 0 {
        breakdown.push(format!("{} vidéo(s)", videos_count));
    }
    if photos_count > 0 {
        breakdown.push(format!("{} photo(s)", photos_count));
    }
    if audio_count > 0 {
        breakdown.push(format!("{} audio(s)", audio_count));
    }
    let summary_label = if breakdown.is_empty() {
        format!("{} fichier(s)", file_count)
    } else {
        breakdown.join(" • ")
    };

    let device_type = if is_multi_selection {
        "package".to_string()
    } else if !is_single_dir {
        "single_file".to_string()
    } else if raw_paths[0].starts_with("/Volumes/")
        && first_path.parent() == Some(Path::new("/Volumes"))
    {
        "sd_card".to_string()
    } else {
        "folder".to_string()
    };

    Ok(PathInspection {
        paths: raw_paths.to_vec(),
        path: raw_paths[0].clone(),
        name,
        is_dir: is_single_dir,
        is_package: is_multi_selection || !is_single_dir,
        exists: true,
        file_count,
        total_bytes,
        available_bytes,
        device_type,
        summary_label,
    })
}
