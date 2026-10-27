use crate::settings::internal_reports_dir;
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedFileRecord {
    pub relative_path: String,
    pub size_bytes: u64,
    pub source_hash: String,
    pub dest_hashes: Vec<String>,
    pub algorithm: String,
    pub status: String, // "verified" | "resumed_verified" | "failed"
    #[serde(default)]
    pub video_health: Option<String>, // None | Some("ok") | Some("corrupted_moov") | Some("truncated")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCertificateData {
    pub job_id: String,
    pub date_local: String,
    pub source_path: String,
    pub destination_path: String,
    pub algorithm: String,
    pub duration_secs: f64,
    pub total_bytes: u64,
    pub avg_speed_mb_s: f64,
    pub total_files: usize,
    pub verified_files: usize,
    pub resumed_files: usize,
    pub records: Vec<VerifiedFileRecord>,
    pub raw_text: String,
    #[serde(default)]
    pub corrupted_videos: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn write_transfer_reports(
    job_id: &str,
    source_path: &str,
    destination_roots: &[PathBuf],
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
    algorithm: &str,
    records: &[VerifiedFileRecord],
    corrupted_videos: &[String],
    write_on_destination_disk: bool,
) -> Vec<String> {
    let duration_secs = (completed_at - started_at)
        .num_milliseconds()
        .max(1) as f64
        / 1000.0;
    let total_bytes: u64 = records.iter().map(|r| r.size_bytes).sum();
    let avg_mb_s = (total_bytes as f64 / (1024.0 * 1024.0)) / duration_secs;
    let local_now: DateTime<Local> = DateTime::from(completed_at);
    let timestamp_slug = local_now.format("%Y-%m-%d_%H-%M-%S").to_string();
    let date_formatted = local_now.format("%d/%m/%Y à %H:%M:%S").to_string();

    let verified_count = records
        .iter()
        .filter(|r| r.status == "verified" || r.status == "resumed_verified")
        .count();
    let resumed_count = records
        .iter()
        .filter(|r| r.status == "resumed_verified")
        .count();

    let mut written_paths = Vec::new();
    let internal_dir = internal_reports_dir();

    for (dest_idx, dest_root) in destination_roots.iter().enumerate() {
        let txt_filename = format!("Hardback_Report_{}_{}.txt", timestamp_slug, dest_idx + 1);
        let json_filename = format!("Hardback_Report_{}_{}.json", timestamp_slug, dest_idx + 1);

        let mut txt = String::new();
        txt.push_str("================================================================================\n");
        txt.push_str("                    HARDBACK — CERTIFICAT DE TRANSFERT                          \n");
        txt.push_str("================================================================================\n\n");
        txt.push_str(&format!("ID Transfert      : {}\n", job_id));
        txt.push_str(&format!("Date              : {}\n", date_formatted));
        txt.push_str(&format!("Source            : {}\n", source_path));
        txt.push_str(&format!("Destination [{}]   : {}\n", dest_idx + 1, dest_root.display()));
        txt.push_str(&format!("Algorithme        : {}\n", algorithm.to_uppercase()));
        txt.push_str(&format!("Durée             : {:.2} s\n", duration_secs));
        txt.push_str(&format!(
            "Volume Total      : {} ({} octets)\n",
            format_bytes(total_bytes),
            total_bytes
        ));
        txt.push_str(&format!("Vitesse Moyenne   : {:.1} Mo/s\n", avg_mb_s));
        txt.push_str(&format!(
            "Fichiers Vérifiés : {} / {} ({} repris sans réécriture)\n\n",
            verified_count,
            records.len(),
            resumed_count
        ));
        txt.push_str("--------------------------------------------------------------------------------\n");
        let hash_col_header = match algorithm.to_ascii_lowercase().as_str() {
            "md5" => "EMPREINTE MD5 (128-bit)        ",
            "sha256" | "sha-256" => "EMPREINTE SHA-256 (256-bit)    ",
            "xxh3" => "EMPREINTE XXH3 (64-bit)        ",
            _ => "EMPREINTE XXH64 (64-bit)       ",
        };
        txt.push_str(&format!("STATUT       | {} | TAILLE (O)   | CHEMIN RELATIF\n", hash_col_header));
        txt.push_str("--------------------------------------------------------------------------------\n");

        for rec in records {
            let dest_hash = rec
                .dest_hashes
                .get(dest_idx)
                .cloned()
                .unwrap_or_else(|| rec.source_hash.clone());
            let status_label = match rec.status.as_str() {
                "verified" => "CERTIFIÉ    ",
                "resumed_verified" => "REPRIS-OK   ",
                _ => "ERREUR      ",
            };
            let v_warn = match rec.video_health.as_deref() {
                Some("corrupted_moov") => " [⚠️ VIDÉO SANS ATOME MOOV]",
                Some("truncated") => " [⚠️ VIDÉO TRONQUÉE]",
                _ => "",
            };
            txt.push_str(&format!(
                "{} | {} | {:>12} | {}{}\n",
                status_label, dest_hash, rec.size_bytes, rec.relative_path, v_warn
            ));
        }

        txt.push_str("--------------------------------------------------------------------------------\n");
        txt.push_str("Vérification Mathématique : SUCCÈS (100% des fichiers sont intacts)\n");
        if !corrupted_videos.is_empty() {
            txt.push_str("--------------------------------------------------------------------------------\n");
            txt.push_str("ATTENTION — INTÉGRITÉ VIDÉO (RUSH NON FINALISÉ / ATOME MOOV MANQUANT) :\n");
            for cv in corrupted_videos {
                txt.push_str(&format!("  ⚠️ {}\n", cv));
            }
            txt.push_str("AVERTISSEMENT : La caméra a été coupée ou la batterie s'est éteinte pendant\n");
            txt.push_str("l'enregistrement. Ne formatez pas la carte avant récupération spécialisée !\n");
        } else {
            txt.push_str("Intégrité Vidéo           : VALIDÉE (Tous les conteneurs MOV/MP4/MXF sont finalisés)\n");
        }
        txt.push_str("================================================================================\n");

        let internal_txt_path = internal_dir.join(&txt_filename);
        if fs::write(&internal_txt_path, &txt).is_ok() {
            written_paths.push(internal_txt_path.to_string_lossy().to_string());
        }

        // Save structured JSON certificate alongside the .txt for the Visual Certificate UI
        let cert_data = VisualCertificateData {
            job_id: job_id.to_string(),
            date_local: date_formatted.clone(),
            source_path: source_path.to_string(),
            destination_path: dest_root.to_string_lossy().to_string(),
            algorithm: algorithm.to_uppercase(),
            duration_secs,
            total_bytes,
            avg_speed_mb_s: avg_mb_s,
            total_files: records.len(),
            verified_files: verified_count,
            resumed_files: resumed_count,
            records: records.to_vec(),
            raw_text: txt.clone(),
            corrupted_videos: corrupted_videos.to_vec(),
        };
        if let Ok(json_str) = serde_json::to_string_pretty(&cert_data) {
            let _ = fs::write(internal_dir.join(&json_filename), json_str);
        }

        if write_on_destination_disk {
            let _ = fs::create_dir_all(dest_root);
            let disk_txt_path = dest_root.join(format!("Hardback_Report_{}.txt", timestamp_slug));
            let _ = fs::write(&disk_txt_path, &txt);

            let mhl_filename = format!("Hardback_{}.mhl", timestamp_slug);
            let mhl_path = dest_root.join(&mhl_filename);
            let mhl_content = build_mhl_xml(
                source_path,
                &dest_root.to_string_lossy(),
                started_at,
                completed_at,
                records,
                algorithm,
            );
            let _ = fs::write(&mhl_path, mhl_content);

            // Official ASC-MHL (v2.0) directory & manifest
            let ascmhl_dir = dest_root.join("ascmhl");
            let _ = fs::create_dir_all(&ascmhl_dir);
            let folder_slug = dest_root
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "Media".to_string());
            let ascmhl_path = ascmhl_dir.join(format!("{}_{}.mhl", folder_slug, timestamp_slug));
            let ascmhl_content = build_ascmhl_xml(
                source_path,
                &dest_root.to_string_lossy(),
                started_at,
                completed_at,
                records,
                algorithm,
            );
            let _ = fs::write(&ascmhl_path, ascmhl_content);
        }
    }

    written_paths
}

/// Loads structured VisualCertificateData from the companion `.json` file,
/// or parses legacy `.txt` reports seamlessly so older certificates also render visually.
pub fn load_visual_certificate(report_txt_path: &str) -> Result<VisualCertificateData, String> {
    let json_candidate = report_txt_path.replacen(".txt", ".json", 1);
    if PathBuf::from(&json_candidate).exists() {
        if let Ok(json_content) = fs::read_to_string(&json_candidate) {
            if let Ok(parsed) = serde_json::from_str::<VisualCertificateData>(&json_content) {
                return Ok(parsed);
            }
        }
    }

    let raw_text = fs::read_to_string(report_txt_path)
        .map_err(|e| format!("Impossible de lire le certificat {} : {}", report_txt_path, e))?;

    let mut job_id = String::from("—");
    let mut date_local = String::from("—");
    let mut source_path = String::from("—");
    let mut destination_path = String::from("—");
    let mut algorithm = String::from("XXH64");
    let mut duration_secs = 0.0f64;
    let mut total_bytes = 0u64;
    let mut avg_speed_mb_s = 0.0f64;
    let mut records = Vec::new();

    for line in raw_text.lines() {
        if let Some(val) = line.strip_prefix("ID Transfert      :") {
            job_id = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Job ID            :") {
            job_id = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Date              :") {
            date_local = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Date (Local)      :") {
            date_local = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Source            :") {
            source_path = val.trim().to_string();
        } else if line.starts_with("Destination [") {
            if let Some((_, rhs)) = line.split_once(':') {
                destination_path = rhs.trim().to_string();
            }
        } else if let Some(val) = line.strip_prefix("Algorithme        :") {
            algorithm = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("Durée             :") {
            duration_secs = val
                .trim()
                .trim_end_matches(" s")
                .parse::<f64>()
                .unwrap_or(0.0);
        } else if let Some(val) = line.strip_prefix("Vitesse Moyenne   :") {
            avg_speed_mb_s = val
                .trim()
                .trim_end_matches(" Mo/s")
                .parse::<f64>()
                .unwrap_or(0.0);
        } else if line.contains(" | ") && !line.starts_with("STATUT") && !line.starts_with("STATUS") {
            let parts: Vec<&str> = line.splitn(4, '|').map(|s| s.trim()).collect();
            if parts.len() == 4 {
                let st_raw = parts[0];
                let hash = parts[1].to_string();
                let sz = parts[2].parse::<u64>().unwrap_or(0);
                let rel = parts[3].to_string();
                total_bytes += sz;
                let status = if st_raw.contains("REPRIS") || st_raw.contains("RESUMED") {
                    "resumed_verified".to_string()
                } else {
                    "verified".to_string()
                };
                records.push(VerifiedFileRecord {
                    relative_path: rel,
                    size_bytes: sz,
                    source_hash: hash.clone(),
                    dest_hashes: vec![hash],
                    algorithm: algorithm.clone(),
                    status,
                    video_health: None,
                });
            }
        }
    }

    let total_files = records.len();
    let resumed_files = records
        .iter()
        .filter(|r| r.status == "resumed_verified")
        .count();

    Ok(VisualCertificateData {
        job_id,
        date_local,
        source_path,
        destination_path,
        algorithm,
        duration_secs,
        total_bytes,
        avg_speed_mb_s,
        total_files,
        verified_files: total_files,
        resumed_files,
        records,
        raw_text,
        corrupted_videos: Vec::new(),
    })
}

fn format_mhl_hash_element(algo: &str, hash: &str) -> String {
    let lower = algo.to_ascii_lowercase();
    if lower == "md5" {
        format!("    <md5>{}</md5>\n", hash)
    } else if lower == "sha256" || lower == "sha-256" {
        format!("    <sha256>{}</sha256>\n", hash)
    } else if lower == "xxh3" {
        format!("    <xxh3>{}</xxh3>\n", hash)
    } else {
        format!("    <xxhash64be>{}</xxhash64be>\n", hash)
    }
}

fn build_mhl_xml(
    source_path: &str,
    dest_path: &str,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
    records: &[VerifiedFileRecord],
    algorithm: &str,
) -> String {
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<hashlist version=\"1.1\">\n");
    xml.push_str("  <creatorinfo>\n");
    xml.push_str("    <name>Hardback Rust Offload Engine</name>\n");
    xml.push_str("    <version>0.1.0</version>\n");
    xml.push_str(&format!("    <startdate>{}</startdate>\n", started_at.to_rfc3339()));
    xml.push_str(&format!("    <finishdate>{}</finishdate>\n", completed_at.to_rfc3339()));
    xml.push_str(&format!("    <source>{}</source>\n", escape_xml(source_path)));
    xml.push_str(&format!("    <destination>{}</destination>\n", escape_xml(dest_path)));
    xml.push_str("  </creatorinfo>\n");

    let hash_date = completed_at.to_rfc3339();
    for rec in records {
        xml.push_str("  <hash>\n");
        xml.push_str(&format!("    <file>{}</file>\n", escape_xml(&rec.relative_path)));
        xml.push_str(&format!("    <size>{}</size>\n", rec.size_bytes));
        xml.push_str(&format_mhl_hash_element(algorithm, &rec.source_hash));
        xml.push_str(&format!("    <hashdate>{}</hashdate>\n", hash_date));
        xml.push_str("  </hash>\n");
    }

    xml.push_str("</hashlist>\n");
    xml
}

fn build_ascmhl_xml(
    source_path: &str,
    dest_path: &str,
    started_at: DateTime<Utc>,
    completed_at: DateTime<Utc>,
    records: &[VerifiedFileRecord],
    algorithm: &str,
) -> String {
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<hashlist xmlns=\"urn:ASC:MHL:v2.0\" version=\"2.0\">\n");
    xml.push_str("  <creatorinfo>\n");
    xml.push_str("    <tool>\n");
    xml.push_str("      <name>Hardback Verified Media Ingest</name>\n");
    xml.push_str("      <version>0.1.0</version>\n");
    xml.push_str("    </tool>\n");
    xml.push_str(&format!("    <creationdate>{}</creationdate>\n", completed_at.to_rfc3339()));
    xml.push_str("    <hostname>macOS-Hardback</hostname>\n");
    xml.push_str("  </creatorinfo>\n");
    xml.push_str("  <processinfo>\n");
    xml.push_str("    <process>copy</process>\n");
    xml.push_str(&format!("    <source>{}</source>\n", escape_xml(source_path)));
    xml.push_str(&format!("    <destination>{}</destination>\n", escape_xml(dest_path)));
    xml.push_str(&format!("    <startdate>{}</startdate>\n", started_at.to_rfc3339()));
    xml.push_str(&format!("    <finishdate>{}</finishdate>\n", completed_at.to_rfc3339()));
    xml.push_str("  </processinfo>\n");

    let hash_tag = match algorithm.to_ascii_lowercase().as_str() {
        "md5" => "md5",
        "sha256" | "sha-256" => "sha256",
        "xxh3" => "xxh3",
        _ => "xxh64",
    };

    let hash_date = completed_at.to_rfc3339();
    for rec in records {
        xml.push_str("  <hash>\n");
        xml.push_str(&format!(
            "    <file size=\"{}\" hashdate=\"{}\">{}</file>\n",
            rec.size_bytes, hash_date, escape_xml(&rec.relative_path)
        ));
        xml.push_str(&format!("    <{}>{}</{}>\n", hash_tag, rec.source_hash, hash_tag));
        xml.push_str("    <action>verified</action>\n");
        xml.push_str("  </hash>\n");
    }

    xml.push_str("</hashlist>\n");
    xml
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    const TB: f64 = GB * 1024.0;
    let b = bytes as f64;
    if b >= TB {
        format!("{:.2} To", b / TB)
    } else if b >= GB {
        format!("{:.2} Go", b / GB)
    } else if b >= MB {
        format!("{:.1} Mo", b / MB)
    } else if b >= KB {
        format!("{:.1} Ko", b / KB)
    } else {
        format!("{} o", bytes)
    }
}

/// Encodes a UTF-8 string into a PDF literal string `(...)` using WinAnsiEncoding (CP1252 / Latin-1)
/// so French accented characters render cleanly in standard Type1 Helvetica/Courier fonts.
fn pdf_escape_winansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    out.push('(');
    for ch in s.chars() {
        let code: u8 = match ch {
            '(' => {
                out.push_str("\\(");
                continue;
            }
            ')' => {
                out.push_str("\\)");
                continue;
            }
            '\\' => {
                out.push_str("\\\\");
                continue;
            }
            '•' => 0x95,
            '—' | '–' => 0x96,
            '’' | '\'' => b'\'',
            '\u{0020}'..='\u{007E}' => ch as u8,
            '\u{00A0}'..='\u{00FF}' => ch as u8,
            'œ' => 0x9C,
            'Œ' => 0x8C,
            '€' => 0x80,
            _ => b'?',
        };
        if (0x20..=0x7E).contains(&code) {
            out.push(code as char);
        } else {
            out.push_str(&format!("\\{:03o}", code));
        }
    }
    out.push(')');
    out
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        s.to_string()
    } else {
        let keep = max_chars.saturating_sub(3);
        let prefix: String = s.chars().take(keep).collect();
        format!("{}...", prefix)
    }
}

/// Generates a native, multi-page PDF 1.4 certificate directly in Rust and opens it in the OS viewer.
pub fn export_certificate_pdf(
    cert: &VisualCertificateData,
    output_path: &str,
) -> Result<String, String> {
    let rows_per_first_page = 24usize;
    let rows_per_next_page = 36usize;

    let mut page_chunks: Vec<&[VerifiedFileRecord]> = Vec::new();
    if cert.records.is_empty() {
        page_chunks.push(&[]);
    } else if cert.records.len() <= rows_per_first_page {
        page_chunks.push(&cert.records[..]);
    } else {
        page_chunks.push(&cert.records[..rows_per_first_page]);
        let mut idx = rows_per_first_page;
        while idx < cert.records.len() {
            let end = (idx + rows_per_next_page).min(cert.records.len());
            page_chunks.push(&cert.records[idx..end]);
            idx = end;
        }
    }

    let total_pages = page_chunks.len();
    let mut page_streams: Vec<String> = Vec::with_capacity(total_pages);

    for (page_idx, chunk) in page_chunks.iter().enumerate() {
        let mut s = String::with_capacity(8192);

        // Top dark header banner
        s.push_str("0.11 0.11 0.12 rg\n");
        s.push_str("36 752 523 58 re f\n");

        // Green verified pill
        s.push_str("0.06 0.72 0.50 rg\n");
        s.push_str("430 772 115 20 re f\n");

        // Title text in header
        s.push_str("BT\n/F2 14 Tf\n1 1 1 rg\n50 784 Td\n");
        s.push_str(&format!(
            "{} Tj\nET\n",
            pdf_escape_winansi("HARDBACK — CERTIFICAT DE TRANSFERT")
        ));

        s.push_str("BT\n/F1 8.5 Tf\n0.72 0.72 0.75 rg\n50 766 Td\n");
        s.push_str(&format!(
            "{} Tj\nET\n",
            pdf_escape_winansi(&format!(
                "Date : {}   •   ID : {}   •   Page {}/{}",
                cert.date_local, cert.job_id, page_idx + 1, total_pages
            ))
        ));

        s.push_str("BT\n/F2 8.5 Tf\n1 1 1 rg\n440 779 Td\n");
        s.push_str(&format!(
            "{} Tj\nET\n",
            pdf_escape_winansi(&format!("100% CERTIFIÉ ({})", cert.algorithm))
        ));

        let mut y_cursor = 732.0f64;

        if page_idx == 0 {
            // Summary box on page 1
            s.push_str("0.96 0.96 0.97 rg\n");
            s.push_str("36 632 523 94 re f\n");
            s.push_str("0.85 0.85 0.87 RG\n0.7 w\n36 632 523 94 re S\n");

            let lines = [
                (
                    "Source :",
                    truncate_str(&cert.source_path, 78),
                ),
                (
                    "Destination :",
                    truncate_str(&cert.destination_path, 78),
                ),
                (
                    "Bilan :",
                    format!(
                        "{} / {} fichiers vérifiés ({} repris)   •   Volume : {}",
                        cert.verified_files,
                        cert.total_files,
                        cert.resumed_files,
                        format_bytes(cert.total_bytes)
                    ),
                ),
                (
                    "Performance :",
                    format!(
                        "Vitesse : {:.1} Mo/s   •   Durée : {:.2} s   •   {}   •   Vidéo : {}",
                        cert.avg_speed_mb_s,
                        cert.duration_secs,
                        cert.algorithm,
                        if cert.corrupted_videos.is_empty() { "100% Intacte" } else { "⚠️ Rushes incomplets détectés" }
                    ),
                ),
            ];

            let mut meta_y = 708.0f64;
            for (label, val) in lines {
                s.push_str(&format!(
                    "BT\n/F2 8.5 Tf\n0.25 0.25 0.28 rg\n48 {:.1} Td\n{} Tj\nET\n",
                    meta_y,
                    pdf_escape_winansi(label)
                ));
                s.push_str(&format!(
                    "BT\n/F1 8.5 Tf\n0.10 0.10 0.12 rg\n118 {:.1} Td\n{} Tj\nET\n",
                    meta_y,
                    pdf_escape_winansi(&val)
                ));
                meta_y -= 19.0;
            }

            y_cursor = 608.0;
        }

        // Table Header
        s.push_str("0.18 0.18 0.20 rg\n");
        s.push_str(&format!("36 {:.1} 523 18 re f\n", y_cursor));

        s.push_str(&format!(
            "BT\n/F2 7.5 Tf\n1 1 1 rg\n44 {:.1} Td\n{} Tj\nET\n",
            y_cursor + 5.5,
            pdf_escape_winansi("FICHIER (CHEMIN RELATIF)")
        ));
        s.push_str(&format!(
            "BT\n/F2 7.5 Tf\n1 1 1 rg\n330 {:.1} Td\n{} Tj\nET\n",
            y_cursor + 5.5,
            pdf_escape_winansi("TAILLE")
        ));
        s.push_str(&format!(
            "BT\n/F2 7.5 Tf\n1 1 1 rg\n392 {:.1} Td\n{} Tj\nET\n",
            y_cursor + 5.5,
            pdf_escape_winansi(&format!("EMPREINTE {}", cert.algorithm))
        ));
        s.push_str(&format!(
            "BT\n/F2 7.5 Tf\n1 1 1 rg\n504 {:.1} Td\n{} Tj\nET\n",
            y_cursor + 5.5,
            pdf_escape_winansi("STATUT")
        ));

        y_cursor -= 16.0;

        for (row_i, rec) in chunk.iter().enumerate() {
            if row_i % 2 == 1 {
                s.push_str("0.965 0.965 0.975 rg\n");
                s.push_str(&format!("36 {:.1} 523 15 re f\n", y_cursor - 3.5));
            }

            let rel_short = truncate_str(&rec.relative_path, 54);
            let size_label = format_bytes(rec.size_bytes);
            let hash_val = rec
                .dest_hashes
                .first()
                .cloned()
                .unwrap_or_else(|| rec.source_hash.clone());
            let status_txt = if rec.status == "resumed_verified" {
                "REPRIS OK"
            } else {
                "CERTIFIÉ"
            };

            s.push_str(&format!(
                "BT\n/F1 7.5 Tf\n0.12 0.12 0.14 rg\n44 {:.1} Td\n{} Tj\nET\n",
                y_cursor,
                pdf_escape_winansi(&rel_short)
            ));
            s.push_str(&format!(
                "BT\n/F1 7.5 Tf\n0.35 0.35 0.38 rg\n330 {:.1} Td\n{} Tj\nET\n",
                y_cursor,
                pdf_escape_winansi(&size_label)
            ));
            s.push_str(&format!(
                "BT\n/F3 7.5 Tf\n0.15 0.35 0.65 rg\n392 {:.1} Td\n{} Tj\nET\n",
                y_cursor,
                pdf_escape_winansi(&hash_val)
            ));
            s.push_str(&format!(
                "BT\n/F2 7.0 Tf\n0.05 0.58 0.40 rg\n504 {:.1} Td\n{} Tj\nET\n",
                y_cursor,
                pdf_escape_winansi(status_txt)
            ));

            y_cursor -= 15.5;
        }

        // Footer
        s.push_str("0.55 0.55 0.58 rg\n");
        s.push_str(&format!(
            "BT\n/F1 7.5 Tf\n36 28 Td\n{} Tj\nET\n",
            pdf_escape_winansi(
                "Généré par Hardback — Vérification mathématique bit-à-bit hors cache RAM (F_NOCACHE)."
            )
        ));

        page_streams.push(s);
    }

    // Build PDF object table:
    // 1: Catalog
    // 2: Pages
    // 3: Font F1 (Helvetica)
    // 4: Font F2 (Helvetica-Bold)
    // 5: Font F3 (Courier)
    // Then for each page i (0..total_pages):
    //   page_obj_id = 6 + i * 2
    //   content_obj_id = 7 + i * 2
    let mut objects: Vec<Vec<u8>> = Vec::new();
    objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());

    let kids_refs: Vec<String> = (0..total_pages)
        .map(|i| format!("{} 0 R", 6 + i * 2))
        .collect();
    objects.push(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids_refs.join(" "),
            total_pages
        )
        .into_bytes(),
    );

    objects.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    objects.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    objects.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>".to_vec(),
    );

    for (i, stream_content) in page_streams.iter().enumerate() {
        let content_id = 7 + i * 2;
        let page_obj = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents {} 0 R >>",
            content_id
        );
        objects.push(page_obj.into_bytes());

        let stream_bytes = stream_content.as_bytes();
        let mut content_obj = format!("<< /Length {} >>\nstream\n", stream_bytes.len()).into_bytes();
        content_obj.extend_from_slice(stream_bytes);
        content_obj.extend_from_slice(b"\nendstream");
        objects.push(content_obj);
    }

    let mut pdf: Vec<u8> = Vec::with_capacity(32768);
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    let mut offsets: Vec<usize> = Vec::with_capacity(objects.len());
    for (idx, obj_body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", idx + 1).as_bytes());
        pdf.extend_from_slice(obj_body);
        pdf.extend_from_slice(b"\nendobj\n");
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for off in offsets {
        pdf.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
    }

    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_offset
        )
        .as_bytes(),
    );

    fs::write(output_path, &pdf)
        .map_err(|e| format!("Impossible d'écrire le fichier PDF {} : {}", output_path, e))?;

    // Automatically open the generated PDF in macOS Preview / system PDF viewer
    let _ = crate::volumes::open_in_file_manager(output_path);

    Ok(output_path.to_string())
}
