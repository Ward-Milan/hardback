use crate::history::{save_or_update_history_entry, IngestHistoryEntry};
use crate::report::{format_bytes, write_transfer_reports, VerifiedFileRecord};
use crate::settings::{load_settings, AppSettings};
use bytes::Bytes;
use chrono::Utc;
use md5::Md5;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use sysinfo::Disks;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Semaphore};
use walkdir::WalkDir;
use xxhash_rust::xxh3::{xxh3_64, Xxh3};
use xxhash_rust::xxh64::{xxh64, Xxh64};

pub const CTRL_RUNNING: u8 = 0;
pub const CTRL_PAUSED: u8 = 1;
pub const CTRL_CANCELLED: u8 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJobState {
    pub id: String,
    pub source_name: String,
    pub source_path: String,
    pub source_paths: Vec<String>,
    pub destination_paths: Vec<String>,
    pub create_subfolder: bool,
    pub custom_folder_name: Option<String>,
    pub algorithm: String,
    pub status: String, // "scanning" | "copying" | "verifying" | "paused" | "completed" | "failed" | "cancelled"
    pub phase_label: String,
    pub current_file: String,
    pub total_files: usize,
    pub processed_files: usize,
    pub verified_files: usize,
    pub resumed_files: usize,
    pub total_bytes: u64,
    pub copied_bytes: u64,
    pub verified_bytes: u64,
    pub progress_percent: f64,
    pub speed_bps: f64,
    pub eta_seconds: Option<u64>,
    pub elapsed_seconds: f64,
    pub error_message: Option<String>,
    pub report_paths: Vec<String>,
    pub started_at: String,
    #[serde(default)]
    pub corrupted_videos: Vec<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct JobCheckpoint {
    pub verified_map: HashMap<String, VerifiedFileRecord>,
    #[serde(default)]
    pub resolved_destinations: Vec<PathBuf>,
    #[serde(default)]
    pub created_dest_roots: Vec<PathBuf>,
    #[serde(default)]
    pub written_rel_paths: HashSet<String>,
    #[serde(default)]
    pub corrupted_videos: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct PersistedSessionState {
    jobs: Vec<TransferJobState>,
    checkpoints: HashMap<String, JobCheckpoint>,
}

pub struct EngineManager {
    pub jobs: Mutex<HashMap<String, TransferJobState>>,
    pub control_flags: Mutex<HashMap<String, Arc<AtomicU8>>>,
    pub checkpoints: Mutex<HashMap<String, Arc<Mutex<JobCheckpoint>>>>,
    pub drive_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl Default for EngineManager {
    fn default() -> Self {
        Self::load_from_disk()
    }
}

impl EngineManager {
    fn session_file_path() -> PathBuf {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        let dir = PathBuf::from(home).join(".hardback");
        let _ = fs::create_dir_all(&dir);
        dir.join("active_session.json")
    }

    /// Loads any previously active or paused transfers from disk so that if the app
    /// was closed or the Mac lost battery mid-transfer, the user can resume seamlessly.
    pub fn load_from_disk() -> Self {
        let path = Self::session_file_path();
        let mut jobs_map = HashMap::new();
        let mut flags_map = HashMap::new();
        let mut cps_map = HashMap::new();

        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(persisted) = serde_json::from_str::<PersistedSessionState>(&content) {
                    for mut job in persisted.jobs {
                        if job.status == "scanning"
                            || job.status == "copying"
                            || job.status == "verifying"
                            || job.status == "queued"
                        {
                            job.status = "paused".to_string();
                            job.phase_label =
                                "Interrompu à la fermeture — Prêt pour reprise immédiate"
                                    .to_string();
                            job.speed_bps = 0.0;
                            job.eta_seconds = None;
                        }
                        let id = job.id.clone();
                        jobs_map.insert(id.clone(), job);
                        flags_map.insert(id.clone(), Arc::new(AtomicU8::new(CTRL_PAUSED)));
                    }
                    for (id, cp) in persisted.checkpoints {
                        cps_map.insert(id, Arc::new(Mutex::new(cp)));
                    }
                }
            }
        }

        Self {
            jobs: Mutex::new(jobs_map),
            control_flags: Mutex::new(flags_map),
            checkpoints: Mutex::new(cps_map),
            drive_locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn persist_to_disk(&self) {
        let jobs_vec: Vec<TransferJobState> = {
            let guard = self.jobs.lock().unwrap();
            guard.values().cloned().collect()
        };
        let mut cps_plain: HashMap<String, JobCheckpoint> = HashMap::new();
        {
            let guard = self.checkpoints.lock().unwrap();
            for (k, v) in guard.iter() {
                if let Ok(cp) = v.lock() {
                    cps_plain.insert(k.clone(), cp.clone());
                }
            }
        }
        let state = PersistedSessionState {
            jobs: jobs_vec,
            checkpoints: cps_plain,
        };
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = fs::write(Self::session_file_path(), json);
        }
    }
}

/// Prevents macOS from putting the CPU or external USB/Thunderbolt disks to sleep
/// while a transfer is running. Automatically releases when dropped.
struct SleepInhibitor {
    child: Option<Child>,
}

impl SleepInhibitor {
    fn acquire() -> Self {
        #[cfg(target_os = "macos")]
        {
            let pid = std::process::id().to_string();
            let child = Command::new("/usr/bin/caffeinate")
                .args(["-i", "-m", "-s", "-w", &pid])
                .spawn()
                .ok();
            Self { child }
        }
        #[cfg(not(target_os = "macos"))]
        {
            Self { child: None }
        }
    }
}

impl Drop for SleepInhibitor {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// Disables the OS unified buffer RAM cache (`F_NOCACHE` on macOS) on a file descriptor.
/// Guarantees that Read-Back Verification reads physical sectors from the external SSD/HDD
/// instead of being tricked by cached bytes still sitting in RAM.
#[inline]
fn disable_os_ram_cache(file: &File) {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::os::unix::io::AsRawFd;
        let _ = libc::fcntl(file.as_raw_fd(), libc::F_NOCACHE, 1);
    }
}

/// Explicitly enables macOS kernel sequential read-ahead (`F_RDAHEAD = 1`) on a source file.
/// Critical for SDXC/CFexpress cards mounted via `fskit.exfat` so the kernel prefetches
/// contiguous clusters ahead of the reader thread without bus stalls.
#[inline]
fn enable_os_readahead(file: &File) {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::os::unix::io::AsRawFd;
        let _ = libc::fcntl(file.as_raw_fd(), libc::F_RDAHEAD, 1);
    }
}

/// Preserves the original camera shooting timestamp (`mtime`) on the copied file.
#[inline]
fn preserve_camera_mtime(file: &File, mtime: Option<SystemTime>) {
    if let Some(t) = mtime {
        let _ = file.set_modified(t);
    }
}

#[derive(Clone)]
struct SourceFileEntry {
    abs_path: PathBuf,
    rel_path: String,
    size: u64,
    mtime: Option<SystemTime>,
}

enum StreamHasher {
    Xxh64(Xxh64),
    Xxh3(Box<Xxh3>),
    Md5(Box<Md5>),
    Sha256(Box<Sha256>),
}

impl StreamHasher {
    fn new(algo: &str) -> Self {
        if algo.eq_ignore_ascii_case("xxh3") {
            Self::Xxh3(Box::new(Xxh3::new()))
        } else if algo.eq_ignore_ascii_case("md5") {
            Self::Md5(Box::new(Md5::new()))
        } else if algo.eq_ignore_ascii_case("sha256") || algo.eq_ignore_ascii_case("sha-256") {
            Self::Sha256(Box::new(Sha256::new()))
        } else {
            Self::Xxh64(Xxh64::new(0))
        }
    }

    #[inline(always)]
    fn update(&mut self, data: &[u8]) {
        match self {
            Self::Xxh64(h) => h.update(data),
            Self::Xxh3(h) => h.update(data),
            Self::Md5(h) => h.update(data),
            Self::Sha256(h) => h.update(data),
        }
    }

    fn digest_hex(&self) -> String {
        match self {
            Self::Xxh64(h) => format!("{:016x}", h.digest()),
            Self::Xxh3(h) => format!("{:016x}", h.digest()),
            Self::Md5(h) => hex_string((*h).clone().finalize()),
            Self::Sha256(h) => hex_string((*h).clone().finalize()),
        }
    }
}

#[inline(always)]
fn hex_string(bytes: impl AsRef<[u8]>) -> String {
    use std::fmt::Write;
    let b = bytes.as_ref();
    let mut out = String::with_capacity(b.len() * 2);
    for byte in b {
        let _ = write!(out, "{:02x}", byte);
    }
    out
}

#[inline(always)]
fn hash_slice_fast(data: &[u8], algo: &str) -> String {
    if algo.eq_ignore_ascii_case("xxh3") {
        format!("{:016x}", xxh3_64(data))
    } else if algo.eq_ignore_ascii_case("md5") {
        let mut h = Md5::new();
        h.update(data);
        hex_string(h.finalize())
    } else if algo.eq_ignore_ascii_case("sha256") || algo.eq_ignore_ascii_case("sha-256") {
        let mut h = Sha256::new();
        h.update(data);
        hex_string(h.finalize())
    } else {
        format!("{:016x}", xxh64(data, 0))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VideoHealth {
    Ok,
    CorruptedMissingMoov,
    TruncatedHeader,
    NotVideo,
}

/// Fast non-invasive video container sanity check.
/// Verifies whether QuickTime (.MOV) and MP4 (.MP4, .M4V) files contain their required `moov` atom header,
/// protecting videographers and DITs against unfinalized recordings (battery died or drone crashed while recording).
pub fn check_video_container_health(file_path: &Path) -> VideoHealth {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "mp4" | "mov" | "m4v" => check_quicktime_mp4_health(file_path),
        "mxf" => check_mxf_health(file_path),
        _ => VideoHealth::NotVideo,
    }
}

fn check_quicktime_mp4_health(file_path: &Path) -> VideoHealth {
    use std::io::{Seek, SeekFrom};

    let mut file = match File::open(file_path) {
        Ok(f) => f,
        Err(_) => return VideoHealth::Ok,
    };

    let file_len = match file.metadata().map(|m| m.len()) {
        Ok(l) => l,
        Err(_) => return VideoHealth::Ok,
    };

    if file_len < 16 {
        return VideoHealth::TruncatedHeader;
    }

    let mut offset = 0u64;
    let mut found_moov = false;
    let mut found_mdat = false;
    let mut header_buf = [0u8; 16];

    // Traverse top-level atom headers by seeking directly, without reading raw mdat payload bytes
    while offset + 8 <= file_len {
        if file.seek(SeekFrom::Start(offset)).is_err() {
            break;
        }
        if file.read_exact(&mut header_buf[..8]).is_err() {
            break;
        }

        let raw_size = u32::from_be_bytes([header_buf[0], header_buf[1], header_buf[2], header_buf[3]]) as u64;
        let atom_type = &header_buf[4..8];

        if atom_type == b"moov" {
            found_moov = true;
        } else if atom_type == b"mdat" {
            found_mdat = true;
        }

        let atom_size = if raw_size == 1 {
            // 64-bit largesize
            if file.read_exact(&mut header_buf[8..16]).is_err() {
                break;
            }
            u64::from_be_bytes([
                header_buf[8], header_buf[9], header_buf[10], header_buf[11],
                header_buf[12], header_buf[13], header_buf[14], header_buf[15],
            ])
        } else if raw_size == 0 {
            file_len.saturating_sub(offset)
        } else {
            raw_size
        };

        if atom_size < 8 {
            break;
        }

        offset = offset.saturating_add(atom_size);
    }

    if found_mdat && !found_moov {
        VideoHealth::CorruptedMissingMoov
    } else {
        VideoHealth::Ok
    }
}

fn check_mxf_health(file_path: &Path) -> VideoHealth {
    let mut file = match File::open(file_path) {
        Ok(f) => f,
        Err(_) => return VideoHealth::Ok,
    };

    let file_len = match file.metadata().map(|m| m.len()) {
        Ok(l) => l,
        Err(_) => return VideoHealth::Ok,
    };

    if file_len < 16 {
        return VideoHealth::TruncatedHeader;
    }

    let mut header = [0u8; 14];
    if file.read_exact(&mut header).is_err() {
        return VideoHealth::TruncatedHeader;
    }

    let smpte_prefix = [0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0D, 0x01, 0x02, 0x01, 0x01];
    if header[..13] != smpte_prefix[..13] {
        return VideoHealth::TruncatedHeader;
    }

    VideoHealth::Ok
}

/// Reads a destination file from physical storage with `F_NOCACHE` enabled to compute its physical checksum.
fn compute_file_hash_nocache(
    path: &Path,
    algo: &str,
    ctrl_flag: &AtomicU8,
    mut on_chunk: impl FnMut(u64),
) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|e| format!("Impossible d'ouvrir {} pour vérification : {}", path.display(), e))?;
    disable_os_ram_cache(&file);

    let mut hasher = StreamHasher::new(algo);
    let mut buf = vec![0u8; 2 * 1024 * 1024]; // 2 MiB chunks for high-speed physical verification

    loop {
        if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
            return Err("INTERRUPTED".to_string());
        }
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Erreur de relecture physique sur {} : {}", path.display(), e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        on_chunk(n as u64);
    }

    Ok(hasher.digest_hex())
}

/// Reads a source file sequentially with `F_RDAHEAD` enabled (used during delta-resume checks).
fn compute_file_hash_source_readahead(
    path: &Path,
    algo: &str,
    ctrl_flag: &AtomicU8,
    mut on_chunk: impl FnMut(u64),
) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|e| format!("Impossible d'ouvrir la source {} : {}", path.display(), e))?;
    enable_os_readahead(&file);

    let mut hasher = StreamHasher::new(algo);
    let mut buf = vec![0u8; 2 * 1024 * 1024]; // 2 MiB sequential read buffer

    loop {
        if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
            return Err("INTERRUPTED".to_string());
        }
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Erreur de lecture source sur {} : {}", path.display(), e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        on_chunk(n as u64);
    }

    Ok(hasher.digest_hex())
}

/// Hardware-Adaptive I/O Profile:
/// Automatically adapts concurrency, multi-queue `pread` workers, chunk size, and ring-buffer
/// depth according to the physical characteristics of the source and destination media.
#[derive(Clone, Debug)]
struct HardwareIoProfile {
    max_concurrent_files: usize,
    inline_file_max_bytes: u64,
    stream_chunk_bytes: usize,
    pread_workers: usize,
    ring_buffer_slots: usize,
    estimated_dest_verify_bps: f64,
    shadow_verify_concurrent: bool,
}

impl HardwareIoProfile {
    fn detect(
        source_paths: &[String],
        resolved_destinations: &[PathBuf],
        settings: &AppSettings,
    ) -> Self {
        let devices = crate::volumes::list_storage_devices();

        let classify_path = |p: &Path| -> String {
            let p_str = p.to_string_lossy();
            let mut best_len = 0usize;
            let mut dev_type = if p_str.starts_with("/Volumes/") {
                "sd_card".to_string() // Safe conservative default for any external media
            } else {
                "internal_ssd".to_string()
            };
            for d in &devices {
                let mp = Path::new(&d.mount_point);
                if mp == Path::new("/") && p_str.starts_with("/Volumes/") {
                    continue; // Never match root "/" for an external /Volumes/ path!
                }
                if p.starts_with(mp) {
                    let l = mp.as_os_str().len();
                    if l >= best_len {
                        best_len = l;
                        dev_type = d.device_type.clone();
                    }
                }
            }
            dev_type
        };

        let src_type = source_paths
            .first()
            .map(|s| classify_path(Path::new(s)))
            .unwrap_or_else(|| "sd_card".to_string());

        let has_hdd_dest = resolved_destinations
            .iter()
            .any(|d| classify_path(d) == "hdd");
        let has_sd_dest = resolved_destinations
            .iter()
            .any(|d| classify_path(d) == "sd_card");
        let shadow_verify_concurrent = !has_hdd_dest && !has_sd_dest;

        let estimated_dest_verify_bps = if has_sd_dest {
            65.0 * 1024.0 * 1024.0
        } else if has_hdd_dest {
            145.0 * 1024.0 * 1024.0
        } else {
            1200.0 * 1024.0 * 1024.0
        };

        // 1. Source is Mechanical HDD: strictly 1 sequential reader thread so the read head never seeks
        if src_type == "hdd" {
            return Self {
                max_concurrent_files: 1,
                inline_file_max_bytes: 2 * 1024 * 1024, // 2 MiB
                stream_chunk_bytes: 2 * 1024 * 1024,    // 2 MiB
                pread_workers: 1,
                ring_buffer_slots: 32,
                estimated_dest_verify_bps,
                shadow_verify_concurrent,
            };
        }

        // 2. Source is SD Card / CFexpress (`fskit.exfat` + SD/UHS-II/CFexpress readers):
        // Strictly 1 file at a time and 1 sequential reader thread with `F_RDAHEAD = 1` and 4 MiB
        // chunks so UHS-II V60/V90 cards achieve full 200–260+ Mo/s DMA saturation without bus stalls.
        if src_type == "sd_card" {
            return Self {
                max_concurrent_files: 1,
                inline_file_max_bytes: 4 * 1024 * 1024, // 4 MiB
                stream_chunk_bytes: 4 * 1024 * 1024,    // 4 MiB sequential DMA blocks
                pread_workers: 1,
                ring_buffer_slots: 32,
                estimated_dest_verify_bps,
                shadow_verify_concurrent,
            };
        }

        // 3. Source is External USB / Thunderbolt SSD:
        if src_type == "ssd" {
            return Self {
                max_concurrent_files: if has_hdd_dest || has_sd_dest {
                    1
                } else if settings.turbo_io {
                    4
                } else {
                    2
                },
                inline_file_max_bytes: 4 * 1024 * 1024, // 4 MiB
                stream_chunk_bytes: 4 * 1024 * 1024,    // 4 MiB
                pread_workers: 1,
                ring_buffer_slots: 32,
                estimated_dest_verify_bps,
                shadow_verify_concurrent,
            };
        }

        // 4. Source is Internal NVMe SSD:
        Self {
            max_concurrent_files: if has_hdd_dest || has_sd_dest {
                1
            } else if settings.turbo_io {
                6
            } else {
                4
            },
            inline_file_max_bytes: 4 * 1024 * 1024, // 4 MiB
            stream_chunk_bytes: 4 * 1024 * 1024,    // 4 MiB
            pread_workers: 1,
            ring_buffer_slots: 32,
            estimated_dest_verify_bps,
            shadow_verify_concurrent,
        }
    }
}

/// Virtual metadata weight added per file (512 KiB) for progress % and ETA estimation.
/// Modeling file-open / FAT-allocation / close overhead prevents small files (.JPG, .XML, .SRT)
/// from causing artificial speed drops or ETA spikes.
const VIRTUAL_FILE_OVERHEAD_BYTES: u64 = 512 * 1024;

/// Professional phase-aware telemetry & ETA engine:
/// - Progress bar updates at 20 FPS (every 50 ms) for visual fluidity.
/// - Displayed speed (Mo/s) and ETA (Temps restant) update at ~1.1 Hz (every 850 ms)
///   using a 10s rolling window blended with cumulative phase speed.
/// - Phase 1 ETA accounts for remaining Copy time at current source speed + Phase 2 Verify time
///   at the destination drive's physical verification speed (so an SD->SSD transfer never doubles ETA).
struct SlidingSpeedMeter {
    phase_start: Instant,
    phase_initial_real_bytes: u64,
    phase_initial_virtual_work: f64,
    phase_total_virtual_bytes: f64,
    estimated_dest_verify_bps: f64,
    fast_inline_mode: bool,
    real_samples: VecDeque<(Instant, u64)>,
    virtual_samples: VecDeque<(Instant, f64)>,
    last_bar_emit: Instant,
    last_text_update: Instant,
    displayed_bps: f64,
    smoothed_eta_secs: Option<f64>,
    displayed_eta_secs: Option<u64>,
    phase_tag: u8,
}

impl SlidingSpeedMeter {
    fn new(
        initial_real_bytes: u64,
        initial_phase_virtual: f64,
        phase_total_virtual_bytes: f64,
        estimated_dest_verify_bps: f64,
        fast_inline_mode: bool,
        phase_tag: u8,
    ) -> Self {
        let now = Instant::now();
        let mut real_samples = VecDeque::with_capacity(256);
        real_samples.push_back((now, initial_real_bytes));
        let mut virtual_samples = VecDeque::with_capacity(256);
        virtual_samples.push_back((now, initial_phase_virtual));
        let past = now.checked_sub(Duration::from_millis(900)).unwrap_or(now);
        Self {
            phase_start: now,
            phase_initial_real_bytes: initial_real_bytes,
            phase_initial_virtual_work: initial_phase_virtual,
            phase_total_virtual_bytes: phase_total_virtual_bytes.max(1.0),
            estimated_dest_verify_bps,
            fast_inline_mode,
            real_samples,
            virtual_samples,
            last_bar_emit: past,
            last_text_update: past,
            displayed_bps: 0.0,
            smoothed_eta_secs: None,
            displayed_eta_secs: None,
            phase_tag,
        }
    }

    fn reset_for_phase(
        &mut self,
        initial_real_bytes: u64,
        initial_phase_virtual: f64,
        phase_tag: u8,
    ) {
        let now = Instant::now();
        self.phase_start = now;
        self.phase_initial_real_bytes = initial_real_bytes;
        self.phase_initial_virtual_work = initial_phase_virtual;
        self.real_samples.clear();
        self.real_samples.push_back((now, initial_real_bytes));
        self.virtual_samples.clear();
        self.virtual_samples.push_back((now, initial_phase_virtual));
        self.smoothed_eta_secs = None;
        self.phase_tag = phase_tag;
    }

    fn record_and_check_emit(
        &mut self,
        current_phase_real_bytes: u64,
        current_phase_virtual_work: f64,
    ) -> (bool, f64, Option<u64>) {
        let now = Instant::now();
        // 1. Throttle progress bar updates to 20 FPS (50 ms)
        if now.duration_since(self.last_bar_emit).as_secs_f64() < 0.05 {
            return (false, self.displayed_bps, self.displayed_eta_secs);
        }
        self.last_bar_emit = now;

        // 2. Record samples in 4.5s (real bytes) and 8s (virtual work) sliding windows
        self.real_samples.push_back((now, current_phase_real_bytes));
        while self.real_samples.len() > 2 {
            if let Some(&(front_t, _)) = self.real_samples.front() {
                if now.duration_since(front_t).as_secs_f64() > 4.5 {
                    self.real_samples.pop_front();
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        self.virtual_samples
            .push_back((now, current_phase_virtual_work));
        while self.virtual_samples.len() > 2 {
            if let Some(&(front_t, _)) = self.virtual_samples.front() {
                if now.duration_since(front_t).as_secs_f64() > 8.0 {
                    self.virtual_samples.pop_front();
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        // 3. Refresh displayed numbers (Mo/s & ETA) at ~1.1 Hz (every 850 ms), or once after 300ms warm-up
        let dt_text = now.duration_since(self.last_text_update).as_secs_f64();
        let phase_elapsed = now
            .duration_since(self.phase_start)
            .as_secs_f64()
            .max(0.10);
        let needs_initial = self.displayed_bps <= 1.0 && phase_elapsed >= 0.30;

        if dt_text >= 0.85 || needs_initial {
            self.last_text_update = now;

            // A. Compute real-time hardware speed over the recent 4.5s window
            // (Does not drag the cumulative average of the past 20 minutes so it doesn't decay slowly!)
            let cum_real_bps = (current_phase_real_bytes
                .saturating_sub(self.phase_initial_real_bytes)
                as f64)
                / phase_elapsed;

            let win_real_bps = if let Some(&(oldest_t, oldest_b)) = self.real_samples.front() {
                let dt = now.duration_since(oldest_t).as_secs_f64();
                if dt >= 0.20 {
                    (current_phase_real_bytes.saturating_sub(oldest_b) as f64) / dt
                } else {
                    cum_real_bps
                }
            } else {
                cum_real_bps
            };

            if win_real_bps > 1.0 {
                self.displayed_bps = if self.displayed_bps <= 1.0 {
                    win_real_bps
                } else {
                    0.35 * win_real_bps + 0.65 * self.displayed_bps
                };
            }

            // B. Compute Phase-Aware ETA (Phase 1 remaining + Phase 2 estimated on Destination)
            let cum_virt_bps = (current_phase_virtual_work - self.phase_initial_virtual_work)
                .max(0.0)
                / phase_elapsed;
            let win_virt_bps = if let Some(&(oldest_t, oldest_v)) = self.virtual_samples.front() {
                let dt = now.duration_since(oldest_t).as_secs_f64();
                if dt >= 0.10 {
                    (current_phase_virtual_work - oldest_v).max(0.0) / dt
                } else {
                    cum_virt_bps
                }
            } else {
                cum_virt_bps
            };

            let effective_virt_bps = 0.70 * cum_virt_bps + 0.30 * win_virt_bps;
            let remaining_phase_virt =
                (self.phase_total_virtual_bytes - current_phase_virtual_work).max(0.0);

            if effective_virt_bps > 1024.0 {
                let phase_eta = remaining_phase_virt / effective_virt_bps;
                let phase2_eta = if self.phase_tag == 1 && !self.fast_inline_mode {
                    self.phase_total_virtual_bytes
                        / self.estimated_dest_verify_bps.max(effective_virt_bps)
                } else {
                    0.0
                };
                let raw_eta = phase_eta + phase2_eta;

                let next_smoothed = match self.smoothed_eta_secs {
                    None => raw_eta,
                    Some(prev) => {
                        let natural = (prev - dt_text).max(0.0);
                        // 85% natural 1-second countdown + 15% convergence towards raw ETA
                        0.85 * natural + 0.15 * raw_eta
                    }
                };
                self.smoothed_eta_secs = Some(next_smoothed);
                self.displayed_eta_secs = Some(next_smoothed.round() as u64);
            }
        }

        (true, self.displayed_bps, self.displayed_eta_secs)
    }
}

fn should_skip_file(file_name: &str, settings: &AppSettings) -> bool {
    if file_name.ends_with(".hardback.part")
        || file_name.starts_with("Hardback_Report_")
        || (file_name.starts_with("Hardback_") && file_name.ends_with(".mhl"))
    {
        return true;
    }

    if settings.ignore_junk_files {
        let lower = file_name.to_ascii_lowercase();
        if file_name == ".DS_Store"
            || file_name.starts_with("._")
            || lower == "thumbs.db"
            || lower == "desktop.ini"
            || file_name == ".Spotlight-V100"
            || file_name == ".Trashes"
            || file_name == ".fseventsd"
        {
            return true;
        }
    }

    if settings.ignore_camera_proxies {
        if let Some(ext) = Path::new(file_name).extension().and_then(|e| e.to_str()) {
            match ext.to_ascii_lowercase().as_str() {
                "lrv" | "thm" | "bim" | "cpi" => return true,
                _ => {}
            }
        }
    }

    false
}

fn media_category_folder(rel_path: &str) -> &'static str {
    if let Some(ext) = Path::new(rel_path).extension().and_then(|e| e.to_str()) {
        match ext.to_ascii_lowercase().as_str() {
            "mov" | "mp4" | "mxf" | "r3d" | "braw" | "ari" | "mkv" | "avi" | "mts" => "Videos",
            "jpg" | "jpeg" | "png" | "cr2" | "cr3" | "arw" | "nef" | "dng" | "raf" | "heic"
            | "tif" | "tiff" | "webp" => "Photos",
            "wav" | "mp3" | "aif" | "aiff" | "flac" | "m4a" => "Audio",
            _ => "Autres",
        }
    } else {
        "Autres"
    }
}

/// Pre-Flight Verification:
/// 1. Checks that each destination volume has enough free space for the new bytes to copy.
/// 2. Checks that no file > 4 GB is being sent to a FAT32 / MSDOS volume.
fn run_preflight_checks(
    files: &[SourceFileEntry],
    resolved_destinations: &[PathBuf],
) -> Result<(), String> {
    let disks = Disks::new_with_refreshed_list();
    const FAT32_MAX_FILE_SIZE: u64 = 4_294_967_295; // 4 GiB - 1 byte

    for dest_root in resolved_destinations {
        // Calculate net new bytes required on this specific destination
        let mut net_bytes_needed = 0u64;
        for f in files {
            let target = dest_root.join(&f.rel_path);
            let already_exists = target
                .metadata()
                .map(|m| m.is_file() && m.len() == f.size)
                .unwrap_or(false);
            if !already_exists {
                net_bytes_needed = net_bytes_needed.saturating_add(f.size);
            }
        }

        // Find matching mounted disk for dest_root
        let mut best_match_len = 0usize;
        let mut matched_avail = None;
        let mut matched_fs = String::new();
        let mut matched_name = dest_root.to_string_lossy().to_string();

        for disk in disks.list() {
            let mp = disk.mount_point();
            if dest_root.starts_with(mp) {
                let len = mp.as_os_str().len();
                if len >= best_match_len {
                    best_match_len = len;
                    matched_avail = Some(disk.available_space());
                    matched_fs = disk.file_system().to_string_lossy().to_uppercase();
                    let dname = disk.name().to_string_lossy().to_string();
                    if !dname.is_empty() {
                        matched_name = dname;
                    }
                }
            }
        }

        // Check 1: FAT32 4 GB single-file limit
        if matched_fs.contains("FAT32")
            || matched_fs.contains("MSDOS")
            || (matched_fs.contains("FAT") && !matched_fs.contains("EXFAT"))
        {
            if let Some(oversized) = files.iter().find(|f| f.size > FAT32_MAX_FILE_SIZE) {
                return Err(format!(
                    "Impossible de copier '{}' ({}) vers '{}' : ce disque est formaté en FAT32 (limite maximale de 4 Go par fichier).",
                    oversized.rel_path,
                    format_bytes(oversized.size),
                    matched_name
                ));
            }
        }

        // Check 2: Available disk space (with 32 MB safety margin for filesystem metadata)
        if let Some(avail) = matched_avail {
            let required_with_margin = net_bytes_needed.saturating_add(32 * 1024 * 1024);
            if avail < required_with_margin && net_bytes_needed > 0 {
                let missing = required_with_margin.saturating_sub(avail);
                return Err(format!(
                    "Espace disque insuffisant sur '{}' : il manque {} (Requis : {}, Disponible : {}).",
                    matched_name,
                    format_bytes(missing),
                    format_bytes(net_bytes_needed),
                    format_bytes(avail)
                ));
            }
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn start_ingest_job(
    app: AppHandle,
    manager: Arc<EngineManager>,
    source_paths: Vec<String>,
    destination_paths: Vec<String>,
    algorithm: String,
    create_subfolder: bool,
    custom_folder_name: Option<String>,
    existing_job_id: Option<String>,
) -> Result<TransferJobState, String> {
    if source_paths.is_empty() {
        return Err("Veuillez sélectionner au moins une source.".to_string());
    }
    for sp in &source_paths {
        if !Path::new(sp).exists() {
            return Err(format!("La source n'existe pas : {}", sp));
        }
    }
    if destination_paths.is_empty() {
        return Err("Veuillez sélectionner au moins une destination.".to_string());
    }

    let first_src = PathBuf::from(&source_paths[0]);
    let is_multi_package = source_paths.len() > 1;
    let default_source_name = if is_multi_package {
        let parent_name = first_src
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Médias".to_string());
        format!("Package_{}_{}_fichiers", parent_name, source_paths.len())
    } else {
        first_src
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Source".to_string())
    };

    let folder_title = custom_folder_name
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_source_name.clone());

    let resolved_destinations: Vec<PathBuf> = destination_paths
        .iter()
        .map(|d| {
            let base = PathBuf::from(d);
            if create_subfolder
                && (first_src.is_dir() || is_multi_package || custom_folder_name.is_some())
            {
                base.join(&folder_title)
            } else {
                base
            }
        })
        .collect();

    if source_paths.len() == 1 && first_src.is_dir() {
        for dest in &resolved_destinations {
            if dest.starts_with(&first_src) && dest != &first_src {
                return Err(format!(
                    "La destination ({}) ne peut pas être un sous-dossier de la source ({}).",
                    dest.display(),
                    first_src.display()
                ));
            }
        }
    }

    // Anti-Crash & Collision Prevention:
    // If a job targeting this destination is already active or paused, handle it safely
    {
        let jobs = manager.jobs.lock().unwrap_or_else(|p| p.into_inner());
        for existing in jobs.values() {
            if existing_job_id.as_deref() == Some(&existing.id) {
                continue;
            }

            let has_collision = resolved_destinations.iter().any(|new_dest| {
                existing.destination_paths.iter().any(|d| {
                    let d_path = PathBuf::from(d);
                    d_path == *new_dest || new_dest.starts_with(&d_path) || d_path.starts_with(new_dest)
                })
            });

            if has_collision {
                if existing.status == "copying" || existing.status == "verifying" || existing.status == "scanning" {
                    return Err(format!(
                        "Un transfert vers cette destination est déjà en cours d'exécution ('{}'). Veuillez attendre sa fin ou le mettre en pause.",
                        existing.source_name
                    ));
                }
                if existing.status == "paused" {
                    if existing.source_paths == source_paths {
                        let resume_id = existing.id.clone();
                        drop(jobs);
                        return resume_existing_job(app, manager, &resume_id);
                    } else {
                        return Err(format!(
                            "Un transfert vers cette destination est actuellement en pause ('{}'). Reprenez-le ou annulez-le avant de démarrer un nouveau transfert au même endroit.",
                            existing.source_name
                        ));
                    }
                }
            }
        }
    }

    let job_id = existing_job_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let started_at_utc = Utc::now();

    let ctrl_flag = Arc::new(AtomicU8::new(CTRL_RUNNING));
    let checkpoint = {
        let mut cps = manager.checkpoints.lock().unwrap();
        let entry = cps
            .entry(job_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(JobCheckpoint::default())))
            .clone();
        {
            let mut cp_guard = entry.lock().unwrap();
            if cp_guard.resolved_destinations.is_empty() {
                cp_guard.resolved_destinations = resolved_destinations.clone();
            }
            // Record any destination subfolder that does not exist yet so we can remove it completely if cancelled
            if create_subfolder && cp_guard.created_dest_roots.is_empty() {
                for dest_root in &resolved_destinations {
                    if !dest_root.exists() {
                        cp_guard.created_dest_roots.push(dest_root.clone());
                    }
                }
            }
        }
        entry
    };

    let initial_state = {
        let mut jobs = manager.jobs.lock().unwrap();
        let state = if let Some(existing) = jobs.get_mut(&job_id) {
            existing.status = "copying".to_string();
            existing.phase_label = "Reprise du transfert…".to_string();
            existing.error_message = None;
            existing.clone()
        } else {
            let st = TransferJobState {
                id: job_id.clone(),
                source_name: folder_title.clone(),
                source_path: source_paths[0].clone(),
                source_paths: source_paths.clone(),
                destination_paths: destination_paths.clone(),
                create_subfolder,
                custom_folder_name: custom_folder_name.clone(),
                algorithm: algorithm.clone(),
                status: "scanning".to_string(),
                phase_label: "Pré-vérification de l'espace disque & des fichiers…".to_string(),
                current_file: String::new(),
                total_files: 0,
                processed_files: 0,
                verified_files: 0,
                resumed_files: 0,
                total_bytes: 0,
                copied_bytes: 0,
                verified_bytes: 0,
                progress_percent: 0.0,
                speed_bps: 0.0,
                eta_seconds: None,
                elapsed_seconds: 0.0,
                error_message: None,
                report_paths: Vec::new(),
                started_at: started_at_utc.to_rfc3339(),
                corrupted_videos: Vec::new(),
            };
            jobs.insert(job_id.clone(), st.clone());
            st
        };
        let mut flags = manager.control_flags.lock().unwrap();
        flags.insert(job_id.clone(), ctrl_flag.clone());
        state
    };

    manager.persist_to_disk();
    let _ = app.emit("transfer-progress", &initial_state);

    let job_id_clone = job_id.clone();
    tauri::async_runtime::spawn(async move {
        run_ingest_pipeline(
            app,
            manager,
            job_id_clone,
            source_paths,
            folder_title,
            destination_paths,
            resolved_destinations,
            algorithm,
            started_at_utc,
            ctrl_flag,
            checkpoint,
        )
        .await;
    });

    Ok(initial_state)
}

pub fn resume_existing_job(
    app: AppHandle,
    manager: Arc<EngineManager>,
    job_id: &str,
) -> Result<TransferJobState, String> {
    let existing = {
        let jobs = manager.jobs.lock().unwrap();
        jobs.get(job_id).cloned()
    };

    let job = existing.ok_or_else(|| "Transfert introuvable pour la reprise.".to_string())?;
    let src_paths = if job.source_paths.is_empty() {
        vec![job.source_path.clone()]
    } else {
        job.source_paths.clone()
    };

    start_ingest_job(
        app,
        manager,
        src_paths,
        job.destination_paths,
        job.algorithm,
        job.create_subfolder,
        job.custom_folder_name,
        Some(job.id),
    )
}

#[allow(clippy::too_many_arguments)]
async fn run_ingest_pipeline(
    app: AppHandle,
    manager: Arc<EngineManager>,
    job_id: String,
    source_paths: Vec<String>,
    source_name: String,
    raw_destination_paths: Vec<String>,
    resolved_destinations: Vec<PathBuf>,
    algorithm: String,
    started_at_utc: chrono::DateTime<Utc>,
    ctrl_flag: Arc<AtomicU8>,
    checkpoint: Arc<Mutex<JobCheckpoint>>,
) {
    // 1. Acquire macOS anti-sleep lock for CPU + external USB/Thunderbolt drives
    let _sleep_guard = SleepInhibitor::acquire();

    let start_instant = Instant::now();
    let primary_source_path = source_paths.first().cloned().unwrap_or_default();
    let settings = load_settings();

    // 2. Scan all source paths & capture original camera timestamps (`mtime`)
    let scan_paths = source_paths.clone();
    let settings_for_scan = settings.clone();
    let files_result = tauri::async_runtime::spawn_blocking(
        move || -> Result<Vec<SourceFileEntry>, String> {
            let mut entries = Vec::new();
            let mut seen_rel = HashSet::new();

            // When multiple subfolders are selected (e.g., cherry-picking subfolders or sub-subfolders),
            // find their common ancestor directory so relative folder structure (`2 soir/rush/...`) is preserved.
            let multi_dirs: Vec<PathBuf> = scan_paths
                .iter()
                .map(PathBuf::from)
                .filter(|p| p.is_dir())
                .collect();

            let common_dir_ancestor: Option<PathBuf> = if multi_dirs.len() > 1 {
                let mut candidate = multi_dirs[0]
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| multi_dirs[0].clone());
                while !multi_dirs.iter().all(|d| d.starts_with(&candidate)) {
                    if let Some(p) = candidate.parent() {
                        candidate = p.to_path_buf();
                    } else {
                        break;
                    }
                }
                if candidate.as_os_str().len() > 1 && candidate != Path::new("/Volumes") {
                    Some(candidate)
                } else {
                    None
                }
            } else {
                None
            };

            for raw in &scan_paths {
                let root = PathBuf::from(raw);
                if !root.exists() {
                    continue;
                }
                if root.is_file() {
                    let fname = root.file_name().unwrap_or_default().to_string_lossy();
                    if should_skip_file(&fname, &settings_for_scan) {
                        continue;
                    }
                    let meta = root
                        .metadata()
                        .map_err(|e| format!("Impossible de lire {} : {}", root.display(), e))?;
                    let mut rel = fname.to_string();
                    if settings_for_scan.sort_by_media_type {
                        let cat = media_category_folder(&rel);
                        rel = format!("{}/{}", cat, rel);
                    }
                    if seen_rel.contains(&rel) {
                        rel = format!("{}_{}", entries.len() + 1, rel);
                    }
                    seen_rel.insert(rel.clone());
                    entries.push(SourceFileEntry {
                        abs_path: root,
                        rel_path: rel,
                        size: meta.len(),
                        mtime: meta.modified().ok(),
                    });
                } else {
                    let strip_base = common_dir_ancestor
                        .as_deref()
                        .unwrap_or_else(|| {
                            if scan_paths.len() > 1 {
                                root.parent().unwrap_or(&root)
                            } else {
                                &root
                            }
                        });

                    for entry in WalkDir::new(&root)
                        .follow_links(false)
                        .into_iter()
                        .filter_map(|e| e.ok())
                    {
                        if entry.file_type().is_file() {
                            let fname = entry.file_name().to_string_lossy();
                            if should_skip_file(&fname, &settings_for_scan) {
                                continue;
                            }
                            let meta = entry
                                .metadata()
                                .map_err(|e| format!("Erreur métadonnées : {}", e))?;
                            let mut rel = entry
                                .path()
                                .strip_prefix(strip_base)
                                .unwrap_or_else(|_| {
                                    entry.path().strip_prefix(&root).unwrap_or(entry.path())
                                })
                                .to_string_lossy()
                                .replace('\\', "/");
                            if settings_for_scan.sort_by_media_type {
                                let file_only = entry.file_name().to_string_lossy();
                                let cat = media_category_folder(&file_only);
                                rel = format!("{}/{}", cat, file_only);
                            }
                            if seen_rel.contains(&rel) {
                                continue;
                            }
                            seen_rel.insert(rel.clone());
                            entries.push(SourceFileEntry {
                                abs_path: entry.path().to_path_buf(),
                                rel_path: rel,
                                size: meta.len(),
                                mtime: meta.modified().ok(),
                            });
                        }
                    }
                }
            }
            Ok(entries)
        },
    )
    .await
    .unwrap_or_else(|e| Err(format!("Erreur interne de scan : {}", e)));

    let files = match files_result {
        Ok(f) => f,
        Err(err) => {
            finalize_job_non_complete(
                &app,
                &manager,
                &job_id,
                &source_name,
                &primary_source_path,
                &source_paths,
                &raw_destination_paths,
                &algorithm,
                start_instant,
                "failed",
                err,
            );
            return;
        }
    };

    // 3. Pre-Flight Check: Free Disk Space & FAT32 4 GB limit
    if let Err(preflight_err) = run_preflight_checks(&files, &resolved_destinations) {
        finalize_job_non_complete(
            &app,
            &manager,
            &job_id,
            &source_name,
            &primary_source_path,
            &source_paths,
            &raw_destination_paths,
            &algorithm,
            start_instant,
            "failed",
            preflight_err,
        );
        return;
    }

    // 4. Pre-create all unique destination directories in a single fast pass
    {
        let mut parent_dirs: HashSet<PathBuf> = HashSet::new();
        for dest_root in &resolved_destinations {
            parent_dirs.insert(dest_root.clone());
            for f in &files {
                if let Some(parent) = dest_root.join(&f.rel_path).parent() {
                    parent_dirs.insert(parent.to_path_buf());
                }
            }
        }
        let _ = tauri::async_runtime::spawn_blocking(move || {
            for dir in parent_dirs {
                let _ = fs::create_dir_all(dir);
            }
        })
        .await;
    }

    let total_files = files.len();
    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let fast_inline = settings.fast_inline_verify_only;
    let phase_virtual_bytes = total_bytes
        .saturating_add((total_files as u64).saturating_mul(VIRTUAL_FILE_OVERHEAD_BYTES));
    let total_work_units = (phase_virtual_bytes as f64 * 2.0).max(1.0);

    let (already_bytes, already_count) = {
        let cp = checkpoint.lock().unwrap();
        let b: u64 = cp.verified_map.values().map(|r| r.size_bytes).sum();
        (b, cp.verified_map.len())
    };
    let initial_phase_virtual = already_bytes
        .saturating_add((already_count as u64).saturating_mul(VIRTUAL_FILE_OVERHEAD_BYTES))
        as f64;

    let copied_bytes_acc = Arc::new(AtomicU64::new(already_bytes));
    let verified_bytes_acc = Arc::new(AtomicU64::new(already_bytes));
    let processed_files_acc = Arc::new(AtomicUsize::new(already_count));
    let verified_files_acc = Arc::new(AtomicUsize::new(already_count));
    let resumed_files_acc = Arc::new(AtomicUsize::new(already_count));

    // Detect Hardware-Adaptive I/O Profile (SD V30/V60/V90, HDD, USB SSD, or NVMe)
    let io_profile = HardwareIoProfile::detect(&source_paths, &resolved_destinations, &settings);
    let use_shadow_pipeline = io_profile.shadow_verify_concurrent && !fast_inline;
    let initial_phase_label = if use_shadow_pipeline {
        "Copie & Vérification physique simultanées…".to_string()
    } else {
        "Phase 1/2 — Copie séquentielle haute stabilité…".to_string()
    };

    // =========================================================================
    // SMART QUEUE: Prevent disk head thrashing on Mechanical HDDs
    // If any destination or source drive is a rotational HDD, acquire that drive's
    // lock. If another job is currently writing/reading to it, transition to "queued".
    // =========================================================================
    let hdd_mounts: Vec<String> = {
        let devices = crate::volumes::list_storage_devices();
        let mut mounts = Vec::new();
        let classify = |p: &Path| -> (String, String) {
            let p_str = p.to_string_lossy();
            let mut best_len = 0;
            let mut dev_type = "internal_ssd".to_string();
            let mut mount = "/".to_string();
            for d in &devices {
                let mp = Path::new(&d.mount_point);
                if mp == Path::new("/") && p_str.starts_with("/Volumes/") {
                    continue;
                }
                if p.starts_with(mp) && mp.as_os_str().len() >= best_len {
                    best_len = mp.as_os_str().len();
                    dev_type = d.device_type.clone();
                    mount = d.mount_point.clone();
                }
            }
            (dev_type, mount)
        };

        for p_str in &source_paths {
            let (dtype, mount) = classify(Path::new(p_str));
            if dtype == "hdd" && !mounts.contains(&mount) {
                mounts.push(mount);
            }
        }
        for d_root in &resolved_destinations {
            let (dtype, mount) = classify(d_root);
            if dtype == "hdd" && !mounts.contains(&mount) {
                mounts.push(mount);
            }
        }
        mounts.sort();
        mounts
    };

    let mut _hdd_guards = Vec::new();
    if !hdd_mounts.is_empty() {
        let hdd_locks: Vec<(String, Arc<tokio::sync::Mutex<()>>)> = {
            let mut locks_map = manager.drive_locks.lock().unwrap();
            hdd_mounts
                .iter()
                .map(|m| {
                    let lock = locks_map
                        .entry(m.clone())
                        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                        .clone();
                    (m.clone(), lock)
                })
                .collect()
        };

        let mut queued_state_set = false;
        for (mount_str, lock_arc) in hdd_locks {
            loop {
                if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
                    let is_paused = ctrl_flag.load(Ordering::Relaxed) == CTRL_PAUSED;
                    finalize_job_non_complete(
                        &app,
                        &manager,
                        &job_id,
                        &source_name,
                        &primary_source_path,
                        &source_paths,
                        &raw_destination_paths,
                        &algorithm,
                        start_instant,
                        if is_paused { "paused" } else { "failed" },
                        "Transfert interrompu pendant l'attente en file.".to_string(),
                    );
                    return;
                }

                match lock_arc.clone().try_lock_owned() {
                    Ok(guard) => {
                        _hdd_guards.push(guard);
                        break;
                    }
                    Err(_) => {
                        if !queued_state_set {
                            queued_state_set = true;
                            let disk_name = Path::new(&mount_str)
                                .file_name()
                                .map(|f| f.to_string_lossy().to_string())
                                .unwrap_or_else(|| mount_str.clone());
                            update_job_state(&app, &manager, &job_id, |st| {
                                st.status = "queued".to_string();
                                st.phase_label = format!(
                                    "En file d'attente — attente de disponibilité du disque ({})…",
                                    disk_name
                                );
                                st.speed_bps = 0.0;
                                st.eta_seconds = None;
                            });
                        }
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                }
            }
        }
    }

    if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
        return;
    }

    update_job_state(&app, &manager, &job_id, |st| {
        st.status = "copying".to_string();
        st.phase_label = initial_phase_label.clone();
        st.total_files = total_files;
        st.total_bytes = total_bytes;
        st.copied_bytes = already_bytes;
        st.verified_bytes = already_bytes;
        st.processed_files = already_count;
        st.verified_files = already_count;
    });

    let speed_meter = Arc::new(Mutex::new(SlidingSpeedMeter::new(
        already_bytes,
        initial_phase_virtual,
        phase_virtual_bytes as f64,
        io_profile.estimated_dest_verify_bps,
        fast_inline || use_shadow_pipeline,
        1,
    )));

    let all_files_for_cleanup = files.clone();
    let remaining_files: Vec<SourceFileEntry> = {
        let cp = checkpoint.lock().unwrap();
        files
            .into_iter()
            .filter(|f| !cp.verified_map.contains_key(&f.rel_path))
            .collect()
    };

    let use_cascading = settings.smart_cascading && resolved_destinations.len() > 1;
    let first_pass_destinations = if use_cascading {
        vec![resolved_destinations[0].clone()]
    } else {
        resolved_destinations.clone()
    };

    // =========================================================================
    // PHASE 1: Continuous Hardware-Adapted Copy & Source Hashing
    // When destination is an SSD (`use_shadow_pipeline == true`), completed files
    // are immediately streamed to the background Shadow Verifier on the SSD so
    // the SD card / source never stops reading and `verified_files` updates live!
    // =========================================================================
    let max_permits = io_profile.max_concurrent_files.max(1);
    let semaphore = Arc::new(Semaphore::new(max_permits));
    let mut copy_handles = Vec::with_capacity(remaining_files.len());
    let first_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let copied_manifests: Arc<Mutex<Vec<(SourceFileEntry, String, bool)>>> =
        Arc::new(Mutex::new(Vec::with_capacity(remaining_files.len())));

    let copy_phase_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (shadow_tx_opt, shadow_verifier_handle) = if use_shadow_pipeline {
        let (tx, mut rx) = mpsc::unbounded_channel::<(SourceFileEntry, String, bool)>();
        let app_v = app.clone();
        let manager_v = manager.clone();
        let job_id_v = job_id.clone();
        let dest_roots_v = first_pass_destinations.clone();
        let algo_v = algorithm.clone();
        let ctrl_v = ctrl_flag.clone();
        let cp_v = checkpoint.clone();
        let meter_v = speed_meter.clone();
        let copied_v = copied_bytes_acc.clone();
        let verified_v = verified_bytes_acc.clone();
        let proc_v = processed_files_acc.clone();
        let ver_v = verified_files_acc.clone();
        let res_v = resumed_files_acc.clone();
        let err_v = first_error.clone();
        let profile_v = io_profile.clone();
        let copy_done_v = copy_phase_done.clone();

        let handle = tauri::async_runtime::spawn(async move {
            while let Some((file_entry, mut expected_src_hash, was_existing_candidate)) =
                rx.recv().await
            {
                if ctrl_v.load(Ordering::Relaxed) != CTRL_RUNNING {
                    break;
                }
                if err_v.lock().unwrap().is_some() {
                    break;
                }

                let mut verify_err = String::new();
                let mut verified_rec: Option<VerifiedFileRecord> = None;

                for attempt in 1..=3 {
                    if ctrl_v.load(Ordering::Relaxed) != CTRL_RUNNING {
                        verify_err = "INTERRUPTED".to_string();
                        break;
                    }

                    if attempt > 1 {
                        for d_root in &dest_roots_v {
                            let _ = fs::remove_file(d_root.join(&file_entry.rel_path));
                            let _ = fs::remove_file(
                                d_root.join(format!("{}.hardback.part", file_entry.rel_path)),
                            );
                        }
                        {
                            let mut cp = cp_v.lock().unwrap();
                            cp.written_rel_paths.insert(file_entry.rel_path.clone());
                        }
                        match copy_single_file_phase1(
                            &app_v,
                            &manager_v,
                            &job_id_v,
                            &file_entry,
                            &dest_roots_v,
                            &algo_v,
                            &ctrl_v,
                            &meter_v,
                            &copied_v,
                            &verified_v,
                            &proc_v,
                            &ver_v,
                            &res_v,
                            total_work_units,
                            start_instant,
                            false,
                            &profile_v,
                            false,
                        )
                        .await
                        {
                            Ok((new_hash, _)) => {
                                expected_src_hash = new_hash;
                            }
                            Err(e) => {
                                verify_err = e;
                                continue;
                            }
                        }
                    }

                    let emit_chunks = copy_done_v.load(Ordering::Relaxed);
                    match verify_single_file_phase2(
                        &app_v,
                        &manager_v,
                        &job_id_v,
                        &file_entry,
                        &expected_src_hash,
                        was_existing_candidate && attempt == 1,
                        &dest_roots_v,
                        &algo_v,
                        &ctrl_v,
                        &meter_v,
                        &copied_v,
                        &verified_v,
                        &proc_v,
                        &ver_v,
                        &res_v,
                        total_work_units,
                        start_instant,
                        attempt == 1,
                        emit_chunks,
                    )
                    .await
                    {
                        Ok(rec) => {
                            verified_rec = Some(rec);
                            break;
                        }
                        Err(e) => {
                            verify_err = e.clone();
                            if e == "INTERRUPTED" {
                                break;
                            }
                            tokio::time::sleep(Duration::from_millis(150 * attempt as u64)).await;
                        }
                    }
                }

                match verified_rec {
                    Some(record) => {
                        let count = {
                            let mut cp = cp_v.lock().unwrap();
                            if record.status == "resumed_verified" {
                                cp.written_rel_paths.remove(&record.relative_path);
                            }
                            cp.verified_map.insert(record.relative_path.clone(), record);
                            cp.verified_map.len()
                        };
                        if count % 25 == 0 {
                            manager_v.persist_to_disk();
                        }
                    }
                    None => {
                        if verify_err != "INTERRUPTED" {
                            let mut guard = err_v.lock().unwrap();
                            if guard.is_none() {
                                *guard = Some(verify_err);
                            }
                            ctrl_v.store(CTRL_PAUSED, Ordering::Relaxed);
                        }
                        break;
                    }
                }
            }
        });

        (Some(tx), Some(handle))
    } else {
        (None, None)
    };

    for file_entry in remaining_files {
        if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
            break;
        }
        if first_error.lock().unwrap().is_some() {
            break;
        }

        let is_large = file_entry.size > io_profile.inline_file_max_bytes;
        let permits_needed = if is_large { max_permits as u32 } else { 1 };
        let permit = match semaphore.clone().acquire_many_owned(permits_needed).await {
            Ok(p) => p,
            Err(_) => break,
        };

        if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
            drop(permit);
            break;
        }

        let app_c = app.clone();
        let manager_c = manager.clone();
        let job_id_c = job_id.clone();
        let dest_roots_c = first_pass_destinations.clone();
        let algo_c = algorithm.clone();
        let ctrl_c = ctrl_flag.clone();
        let cp_c = checkpoint.clone();
        let meter_c = speed_meter.clone();
        let copied_acc = copied_bytes_acc.clone();
        let verified_acc = verified_bytes_acc.clone();
        let proc_acc = processed_files_acc.clone();
        let ver_acc = verified_files_acc.clone();
        let res_acc = resumed_files_acc.clone();
        let err_holder = first_error.clone();
        let manifests_c = copied_manifests.clone();
        let profile_c = io_profile.clone();
        let shadow_tx_c = shadow_tx_opt.clone();

        let task_handle = tauri::async_runtime::spawn(async move {
            let _permit = permit;
            if ctrl_c.load(Ordering::Relaxed) != CTRL_RUNNING {
                return;
            }

            let mut last_err = String::new();
            let mut copy_outcome: Option<(String, bool)> = None;

            for attempt in 1..=3 {
                if ctrl_c.load(Ordering::Relaxed) != CTRL_RUNNING {
                    last_err = "INTERRUPTED".to_string();
                    break;
                }
                {
                    let mut cp = cp_c.lock().unwrap();
                    cp.written_rel_paths.insert(file_entry.rel_path.clone());
                }
                match copy_single_file_phase1(
                    &app_c,
                    &manager_c,
                    &job_id_c,
                    &file_entry,
                    &dest_roots_c,
                    &algo_c,
                    &ctrl_c,
                    &meter_c,
                    &copied_acc,
                    &verified_acc,
                    &proc_acc,
                    &ver_acc,
                    &res_acc,
                    total_work_units,
                    start_instant,
                    fast_inline,
                    &profile_c,
                    attempt == 1,
                )
                .await
                {
                    Ok(res) => {
                        copy_outcome = Some(res);
                        break;
                    }
                    Err(e) => {
                        last_err = e.clone();
                        for d_root in &dest_roots_c {
                            let _ = fs::remove_file(d_root.join(&file_entry.rel_path));
                            let _ = fs::remove_file(
                                d_root.join(format!("{}.hardback.part", file_entry.rel_path)),
                            );
                        }
                        if e == "INTERRUPTED" {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(150 * attempt as u64)).await;
                    }
                }
            }

            match copy_outcome {
                Some((src_hash, was_existing_candidate)) => {
                    if fast_inline {
                        let d_hashes = vec![src_hash.clone(); dest_roots_c.len()];
                        let status_str = if was_existing_candidate {
                            "resumed_verified"
                        } else {
                            "verified"
                        };
                        let v_health = match check_video_container_health(&file_entry.abs_path) {
                            VideoHealth::CorruptedMissingMoov => Some("corrupted_moov".to_string()),
                            VideoHealth::TruncatedHeader => Some("truncated".to_string()),
                            VideoHealth::Ok => Some("ok".to_string()),
                            VideoHealth::NotVideo => None,
                        };
                        let rec = VerifiedFileRecord {
                            relative_path: file_entry.rel_path.clone(),
                            size_bytes: file_entry.size,
                            source_hash: src_hash,
                            dest_hashes: d_hashes,
                            algorithm: algo_c,
                            status: status_str.to_string(),
                            video_health: v_health.clone(),
                        };
                        if let Some(ref vh) = v_health {
                            if vh != "ok" {
                                let warn_msg = if vh == "corrupted_moov" {
                                    format!("{} (atome MOOV manquant — enregistrement non finalisé)", file_entry.rel_path)
                                } else {
                                    format!("{} (en-tête de conteneur vidéo corrompu ou tronqué)", file_entry.rel_path)
                                };
                                update_job_state(&app_c, &manager_c, &job_id_c, |st| {
                                    if !st.corrupted_videos.contains(&warn_msg) {
                                        st.corrupted_videos.push(warn_msg.clone());
                                    }
                                });
                                let mut cp = cp_c.lock().unwrap();
                                if !cp.corrupted_videos.contains(&warn_msg) {
                                    cp.corrupted_videos.push(warn_msg);
                                }
                            }
                        }
                        let count = {
                            let mut cp = cp_c.lock().unwrap();
                            if status_str == "resumed_verified" {
                                cp.written_rel_paths.remove(&rec.relative_path);
                            }
                            cp.verified_map.insert(rec.relative_path.clone(), rec);
                            cp.verified_map.len()
                        };
                        if count % 25 == 0 {
                            manager_c.persist_to_disk();
                        }
                    } else if let Some(tx) = shadow_tx_c {
                        let _ = tx.send((file_entry, src_hash, was_existing_candidate));
                    } else {
                        manifests_c.lock().unwrap().push((
                            file_entry,
                            src_hash,
                            was_existing_candidate,
                        ));
                    }
                }
                None => {
                    if last_err != "INTERRUPTED" {
                        let mut guard = err_holder.lock().unwrap();
                        if guard.is_none() {
                            *guard = Some(last_err);
                        }
                        ctrl_c.store(CTRL_PAUSED, Ordering::Relaxed);
                    }
                }
            }
        });

        copy_handles.push(task_handle);
    }

    for h in copy_handles {
        let _ = h.await;
    }

    // Close shadow channel and await final background file verification on SSD destinations
    drop(shadow_tx_opt);
    copy_phase_done.store(true, Ordering::Relaxed);
    if let Some(shadow_handle) = shadow_verifier_handle {
        let _ = shadow_handle.await;
    }

    // =========================================================================
    // PHASE 2: Sequential Physical Verification with F_NOCACHE (HDD / SD targets)
    // Used when destination is a mechanical HDD or SD card where concurrent read+write
    // would cause head seeking.
    // =========================================================================
    if !fast_inline
        && !use_shadow_pipeline
        && ctrl_flag.load(Ordering::Relaxed) == CTRL_RUNNING
        && first_error.lock().unwrap().is_none()
    {
        // Reset speed meter for Phase 2 so it cleanly measures physical verification throughput
        {
            let v_bytes_init = verified_bytes_acc.load(Ordering::Relaxed);
            let v_files_init = verified_files_acc.load(Ordering::Relaxed);
            let v_virt_init = v_bytes_init.saturating_add(
                (v_files_init as u64).saturating_mul(VIRTUAL_FILE_OVERHEAD_BYTES),
            ) as f64;
            let mut meter = speed_meter.lock().unwrap();
            meter.reset_for_phase(v_bytes_init, v_virt_init, 2);
        }

        update_job_state(&app, &manager, &job_id, |st| {
            st.status = "verifying".to_string();
            st.phase_label =
                "Phase 2/2 — Vérification physique directe (hors cache RAM)…".to_string();
        });

        let mut to_verify = {
            let mut guard = copied_manifests.lock().unwrap();
            std::mem::take(&mut *guard)
        };
        // Verify in deterministic relative path order for sequential disk read locality
        to_verify.sort_by(|a, b| a.0.rel_path.cmp(&b.0.rel_path));

        for (file_entry, mut expected_src_hash, was_existing_candidate) in to_verify {
            if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
                break;
            }
            if first_error.lock().unwrap().is_some() {
                break;
            }

            let mut verify_err = String::new();
            let mut verified_rec: Option<VerifiedFileRecord> = None;

            for attempt in 1..=3 {
                if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
                    verify_err = "INTERRUPTED".to_string();
                    break;
                }

                // If this is a retry (or if an existing file on destination mismatched), re-copy it cleanly first
                if attempt > 1 {
                    for d_root in &first_pass_destinations {
                        let _ = fs::remove_file(d_root.join(&file_entry.rel_path));
                        let _ = fs::remove_file(
                            d_root.join(format!("{}.hardback.part", file_entry.rel_path)),
                        );
                    }
                    {
                        let mut cp = checkpoint.lock().unwrap();
                        cp.written_rel_paths.insert(file_entry.rel_path.clone());
                    }
                    match copy_single_file_phase1(
                        &app,
                        &manager,
                        &job_id,
                        &file_entry,
                        &first_pass_destinations,
                        &algorithm,
                        &ctrl_flag,
                        &speed_meter,
                        &copied_bytes_acc,
                        &verified_bytes_acc,
                        &processed_files_acc,
                        &verified_files_acc,
                        &resumed_files_acc,
                        total_work_units,
                        start_instant,
                        false,
                        &io_profile,
                        false,
                    )
                    .await
                    {
                        Ok((new_hash, _)) => {
                            expected_src_hash = new_hash;
                        }
                        Err(e) => {
                            verify_err = e;
                            continue;
                        }
                    }
                }

                match verify_single_file_phase2(
                    &app,
                    &manager,
                    &job_id,
                    &file_entry,
                    &expected_src_hash,
                    was_existing_candidate && attempt == 1,
                    &first_pass_destinations,
                    &algorithm,
                    &ctrl_flag,
                    &speed_meter,
                    &copied_bytes_acc,
                    &verified_bytes_acc,
                    &processed_files_acc,
                    &verified_files_acc,
                    &resumed_files_acc,
                    total_work_units,
                    start_instant,
                    attempt == 1,
                    true,
                )
                .await
                {
                    Ok(rec) => {
                        verified_rec = Some(rec);
                        break;
                    }
                    Err(e) => {
                        verify_err = e.clone();
                        if e == "INTERRUPTED" {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(150 * attempt as u64)).await;
                    }
                }
            }

            match verified_rec {
                Some(record) => {
                    let count = {
                        let mut cp = checkpoint.lock().unwrap();
                        if record.status == "resumed_verified" {
                            cp.written_rel_paths.remove(&record.relative_path);
                        }
                        cp.verified_map.insert(record.relative_path.clone(), record);
                        cp.verified_map.len()
                    };
                    if count % 25 == 0 {
                        manager.persist_to_disk();
                    }
                }
                None => {
                    if verify_err != "INTERRUPTED" {
                        let mut guard = first_error.lock().unwrap();
                        if guard.is_none() {
                            *guard = Some(verify_err);
                        }
                        ctrl_flag.store(CTRL_PAUSED, Ordering::Relaxed);
                    }
                    break;
                }
            }
        }
    }

    // 5. Verified Smart Cascading: copy from Primary SSD [0] -> Secondary Drives [1..N]
    // and verify every secondary drive with `F_NOCACHE` against the original camera `source_hash`!
    if use_cascading
        && ctrl_flag.load(Ordering::Relaxed) == CTRL_RUNNING
        && first_error.lock().unwrap().is_none()
    {
        let primary_dest = resolved_destinations[0].clone();
        let secondary_dests = resolved_destinations[1..].to_vec();

        update_job_state(&app, &manager, &job_id, |st| {
            st.status = "verifying".to_string();
            st.phase_label =
                "Cascade sécurisée (SSD rapide → Disques secondaires + Vérification)…".to_string();
        });

        for f in &all_files_for_cleanup {
            if ctrl_flag.load(Ordering::Relaxed) != CTRL_RUNNING {
                break;
            }
            let expected_hash = {
                let cp = checkpoint.lock().unwrap();
                cp.verified_map
                    .get(&f.rel_path)
                    .map(|r| r.source_hash.clone())
            };
            let Some(expected_src_hash) = expected_hash else {
                continue;
            };

            let src_on_fast_ssd = primary_dest.join(&f.rel_path);
            let mtime = f.mtime;
            let rel_p = f.rel_path.clone();
            let algo_c = algorithm.clone();
            let ctrl_c = ctrl_flag.clone();
            let sec_dests_c = secondary_dests.clone();
            let fast_inline = settings.fast_inline_verify_only;

            update_job_state(&app, &manager, &job_id, |st| {
                st.current_file = rel_p.clone();
            });

            let cascade_res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                for sec_dest in &sec_dests_c {
                    if ctrl_c.load(Ordering::Relaxed) != CTRL_RUNNING {
                        return Err("INTERRUPTED".to_string());
                    }
                    let target = sec_dest.join(&rel_p);
                    fs::copy(&src_on_fast_ssd, &target).map_err(|e| {
                        format!(
                            "Erreur d'écriture en cascade sur {} : {}",
                            target.display(),
                            e
                        )
                    })?;
                    if let Ok(tf) = OpenOptions::new().write(true).open(&target) {
                        preserve_camera_mtime(&tf, mtime);
                    }
                    if !fast_inline {
                        let sec_hash =
                            compute_file_hash_nocache(&target, &algo_c, &ctrl_c, |_| {})?;
                        if sec_hash != expected_src_hash {
                            return Err(format!(
                                "Discordance de hash en cascade sur {} ({} != {})",
                                target.display(),
                                sec_hash,
                                expected_src_hash
                            ));
                        }
                    }
                }
                Ok(())
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string()));

            if let Err(err) = cascade_res {
                if err != "INTERRUPTED" {
                    let mut guard = first_error.lock().unwrap();
                    if guard.is_none() {
                        *guard = Some(err);
                    }
                    ctrl_flag.store(CTRL_PAUSED, Ordering::Relaxed);
                }
                break;
            }
        }
    }

    let ctrl_state = ctrl_flag.load(Ordering::Relaxed);
    let maybe_err = first_error.lock().unwrap().clone();

    if let Some(err_msg) = maybe_err {
        finalize_job_non_complete(
            &app,
            &manager,
            &job_id,
            &source_name,
            &primary_source_path,
            &source_paths,
            &raw_destination_paths,
            &algorithm,
            start_instant,
            "failed",
            err_msg,
        );
        return;
    }

    if ctrl_state == CTRL_PAUSED {
        finalize_job_non_complete(
            &app,
            &manager,
            &job_id,
            &source_name,
            &primary_source_path,
            &source_paths,
            &raw_destination_paths,
            &algorithm,
            start_instant,
            "paused",
            "Transfert en pause.".to_string(),
        );
        return;
    }

    if ctrl_state == CTRL_CANCELLED {
        let cp_snapshot = checkpoint.lock().unwrap_or_else(|p| p.into_inner()).clone();
        purge_cancelled_job(&cp_snapshot);
        {
            let mut jobs = manager.jobs.lock().unwrap_or_else(|p| p.into_inner());
            jobs.remove(&job_id);
        }
        {
            let mut cps = manager.checkpoints.lock().unwrap_or_else(|p| p.into_inner());
            cps.remove(&job_id);
        }
        manager.persist_to_disk();
        refresh_tray_status(&app, &manager);
        let _ = app.emit("transfer-cancelled", &job_id);
        return;
    }

    let verified_records: Vec<VerifiedFileRecord> = {
        let cp = checkpoint.lock().unwrap();
        let mut list: Vec<VerifiedFileRecord> = cp.verified_map.values().cloned().collect();
        list.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        list
    };

    if settings.move_mode_delete_source && verified_records.len() == total_files {
        for f in &all_files_for_cleanup {
            let _ = fs::remove_file(&f.abs_path);
        }
    }

    let corrupted_videos_snapshot = {
        let jobs = manager.jobs.lock().unwrap();
        jobs.get(&job_id).map(|j| j.corrupted_videos.clone()).unwrap_or_default()
    };

    let completed_at_utc = Utc::now();
    let report_paths = write_transfer_reports(
        &job_id,
        &primary_source_path,
        &resolved_destinations,
        started_at_utc,
        completed_at_utc,
        &algorithm,
        &verified_records,
        &corrupted_videos_snapshot,
        settings.write_reports_on_disk,
    );

    let elapsed_secs = start_instant.elapsed().as_secs_f64().max(0.05);
    let avg_speed_bps = (total_bytes as f64) / elapsed_secs;
    let final_resumed = resumed_files_acc.load(Ordering::Relaxed);

    update_job_state(&app, &manager, &job_id, |st| {
        st.status = "completed".to_string();
        st.phase_label = if corrupted_videos_snapshot.is_empty() {
            "Transfert 100% certifié & intégrité vidéo validée".to_string()
        } else {
            format!("Transfert certifié — ⚠️ {} rush(s) vidéo non finalisé(s) détecté(s)", corrupted_videos_snapshot.len())
        };
        st.current_file = String::new();
        st.processed_files = total_files;
        st.verified_files = verified_records.len();
        st.resumed_files = final_resumed;
        st.copied_bytes = total_bytes;
        st.verified_bytes = total_bytes;
        st.progress_percent = 100.0;
        st.speed_bps = avg_speed_bps;
        st.eta_seconds = Some(0);
        st.elapsed_seconds = elapsed_secs;
        st.error_message = None;
        st.report_paths = report_paths.clone();
    });

    manager.persist_to_disk();

    if settings.sound_notification {
        #[cfg(target_os = "macos")]
        {
            let _ = Command::new("afplay")
                .arg("/System/Library/Sounds/Glass.aiff")
                .spawn();

            let clean_title = source_name.replace(['"', '\''], "");
            let notif_script = format!(
                "display notification \"{} fichiers certifiés ({}) à {:.0} Mo/s\" with title \"Hardback — Transfert Terminé\" subtitle \"{}\"",
                verified_records.len(),
                format_bytes(total_bytes),
                avg_speed_bps / (1024.0 * 1024.0),
                clean_title
            );
            let _ = Command::new("osascript")
                .args(["-e", &notif_script])
                .spawn();
        }
    }

    if settings.auto_eject_source
        && primary_source_path.starts_with("/Volumes/")
        && crate::volumes::eject_storage_volume(&primary_source_path).is_ok()
    {
        let _ = app.emit("devices-changed", ());
    }

    if !settings.webhook_url.trim().is_empty() {
        let url = settings.webhook_url.trim().to_string();
        let msg = format!(
            "{{\"content\":\"✅ Hardback : Transfert '{}' terminé ({} fichiers vérifiés, {:.1} Mo/s)\",\"text\":\"✅ Hardback : Transfert '{}' terminé ({} fichiers vérifiés, {:.1} Mo/s)\"}}",
            source_name,
            verified_records.len(),
            avg_speed_bps / (1024.0 * 1024.0),
            source_name,
            verified_records.len(),
            avg_speed_bps / (1024.0 * 1024.0)
        );
        let _ = Command::new("curl")
            .args([
                "-s",
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-d",
                &msg,
                &url,
            ])
            .spawn();
    }

    let history_entry = IngestHistoryEntry {
        id: job_id,
        source_name,
        source_path: primary_source_path,
        source_paths,
        destination_paths: raw_destination_paths,
        total_files,
        verified_files: verified_records.len(),
        resumed_files: final_resumed,
        total_bytes,
        duration_secs: elapsed_secs,
        average_speed_bps: avg_speed_bps,
        status: "completed".to_string(),
        error_message: None,
        algorithm,
        report_paths,
        created_at: completed_at_utc.to_rfc3339(),
    };
    let updated_history = save_or_update_history_entry(history_entry);
    let _ = app.emit("history-updated", &updated_history);
}

#[allow(clippy::too_many_arguments)]
async fn copy_single_file_phase1(
    app: &AppHandle,
    manager: &Arc<EngineManager>,
    job_id: &str,
    file_entry: &SourceFileEntry,
    resolved_destinations: &[PathBuf],
    algorithm: &str,
    ctrl_flag: &Arc<AtomicU8>,
    speed_meter: &Arc<Mutex<SlidingSpeedMeter>>,
    copied_acc: &Arc<AtomicU64>,
    verified_acc: &Arc<AtomicU64>,
    proc_acc: &Arc<AtomicUsize>,
    ver_acc: &Arc<AtomicUsize>,
    res_acc: &Arc<AtomicUsize>,
    total_work_units: f64,
    start_instant: Instant,
    fast_inline_verify_only: bool,
    io_profile: &HardwareIoProfile,
    count_bytes_on_attempt: bool,
) -> Result<(String, bool), String> {
    let rel_path = file_entry.rel_path.clone();
    let file_size = file_entry.size;
    let mtime = file_entry.mtime;
    let copy_label = if io_profile.shadow_verify_concurrent && !fast_inline_verify_only {
        "Copie & Vérification physique simultanées…"
    } else {
        "Phase 1/2 — Copie séquentielle haute stabilité…"
    };

    // 1. Check Delta Resume candidate (if file already exists on all destinations with exact byte size)
    let all_dest_exist_same_size = resolved_destinations.iter().all(|dest_root| {
        dest_root
            .join(&rel_path)
            .metadata()
            .map(|m| m.is_file() && m.len() == file_size)
            .unwrap_or(false)
    });

    if all_dest_exist_same_size && file_size > 0 && count_bytes_on_attempt {
        let src_p = file_entry.abs_path.clone();
        let algo_c = algorithm.to_string();
        let ctrl_c = ctrl_flag.clone();
        let app_c = app.clone();
        let manager_c = manager.clone();
        let job_id_c = job_id.to_string();
        let meter_c = speed_meter.clone();
        let copied_c = copied_acc.clone();
        let verified_c = verified_acc.clone();
        let proc_c = proc_acc.clone();
        let ver_c = ver_acc.clone();
        let res_c = res_acc.clone();
        let rel_c = rel_path.clone();

        let src_hash = tauri::async_runtime::spawn_blocking(move || {
            compute_file_hash_source_readahead(&src_p, &algo_c, &ctrl_c, |chunk_len| {
                let c_bytes = copied_c.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len;
                let v_bytes = if fast_inline_verify_only {
                    verified_c.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len
                } else {
                    verified_c.load(Ordering::Relaxed)
                };
                emit_throttled_metrics(
                    &app_c,
                    &manager_c,
                    &job_id_c,
                    &meter_c,
                    c_bytes,
                    v_bytes,
                    total_work_units,
                    start_instant,
                    proc_c.load(Ordering::Relaxed),
                    ver_c.load(Ordering::Relaxed),
                    res_c.load(Ordering::Relaxed),
                    &rel_c,
                    "Analyse delta de l'existant…",
                );
            })
        })
        .await
        .map_err(|e| e.to_string())??;

        let p_files = proc_acc.fetch_add(1, Ordering::Relaxed) + 1;
        let v_files = if fast_inline_verify_only {
            ver_acc.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            ver_acc.load(Ordering::Relaxed)
        };
        let r_files = if fast_inline_verify_only {
            res_acc.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            res_acc.load(Ordering::Relaxed)
        };

        emit_throttled_metrics(
            app,
            manager,
            job_id,
            speed_meter,
            copied_acc.load(Ordering::Relaxed),
            verified_acc.load(Ordering::Relaxed),
            total_work_units,
            start_instant,
            p_files,
            v_files,
            r_files,
            &rel_path,
            "Analyse delta de l'existant…",
        );

        return Ok((src_hash, true));
    }

    // 2. Small file inline copy (<= io_profile.inline_file_max_bytes: 2 MiB on SD/HDD, 4 MiB on SSD/NVMe)
    if file_size <= io_profile.inline_file_max_bytes {
        let src_p = file_entry.abs_path.clone();
        let rel_c = rel_path.clone();
        let algo_c = algorithm.to_string();
        let ctrl_c = ctrl_flag.clone();
        let dest_roots_c = resolved_destinations.to_vec();

        let src_hash = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
            if ctrl_c.load(Ordering::Relaxed) != CTRL_RUNNING {
                return Err("INTERRUPTED".to_string());
            }
            let data = fs::read(&src_p)
                .map_err(|e| format!("Erreur lecture {} : {}", src_p.display(), e))?;
            let s_hash = hash_slice_fast(&data, &algo_c);

            for dest_root in &dest_roots_c {
                if ctrl_c.load(Ordering::Relaxed) != CTRL_RUNNING {
                    return Err("INTERRUPTED".to_string());
                }
                let final_dest = dest_root.join(&rel_c);
                if let Some(parent) = final_dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let mut out_f = File::create(&final_dest).map_err(|e| {
                    format!("Erreur création {} : {}", final_dest.display(), e)
                })?;
                out_f
                    .write_all(&data)
                    .map_err(|e| format!("Erreur écriture {} : {}", final_dest.display(), e))?;
                preserve_camera_mtime(&out_f, mtime);
            }
            Ok(s_hash)
        })
        .await
        .map_err(|e| e.to_string())??;

        let c_bytes = if count_bytes_on_attempt {
            copied_acc.fetch_add(file_size, Ordering::Relaxed) + file_size
        } else {
            copied_acc.load(Ordering::Relaxed)
        };
        let v_bytes = if fast_inline_verify_only && count_bytes_on_attempt {
            verified_acc.fetch_add(file_size, Ordering::Relaxed) + file_size
        } else {
            verified_acc.load(Ordering::Relaxed)
        };
        let p_files = if count_bytes_on_attempt {
            proc_acc.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            proc_acc.load(Ordering::Relaxed)
        };
        let v_files = if fast_inline_verify_only && count_bytes_on_attempt {
            ver_acc.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            ver_acc.load(Ordering::Relaxed)
        };

        emit_throttled_metrics(
            app,
            manager,
            job_id,
            speed_meter,
            c_bytes,
            v_bytes,
            total_work_units,
            start_instant,
            p_files,
            v_files,
            res_acc.load(Ordering::Relaxed),
            &rel_path,
            copy_label,
        );

        return Ok((src_hash, false));
    }

    // 3. Hardware-Adapted Ring-Buffer Streaming Pipeline for files > inline_file_max_bytes
    let app_for_copy = app.clone();
    let manager_for_copy = manager.clone();
    let job_id_for_copy = job_id.to_string();
    let meter_for_copy = speed_meter.clone();
    let copied_for_copy = copied_acc.clone();
    let verified_for_copy = verified_acc.clone();
    let proc_for_copy = proc_acc.clone();
    let ver_for_copy = ver_acc.clone();
    let res_for_copy = res_acc.clone();
    let rel_for_copy = rel_path.clone();

    let source_hash = copy_large_file_single_read_multi_write(
        &file_entry.abs_path,
        &rel_path,
        mtime,
        resolved_destinations,
        algorithm,
        ctrl_flag,
        io_profile.stream_chunk_bytes,
        io_profile.pread_workers,
        io_profile.ring_buffer_slots,
        move |chunk_len| {
            let c_bytes = if count_bytes_on_attempt {
                copied_for_copy.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len
            } else {
                copied_for_copy.load(Ordering::Relaxed)
            };
            let v_bytes = if fast_inline_verify_only && count_bytes_on_attempt {
                verified_for_copy.fetch_add(chunk_len, Ordering::Relaxed) + chunk_len
            } else {
                verified_for_copy.load(Ordering::Relaxed)
            };
            emit_throttled_metrics(
                &app_for_copy,
                &manager_for_copy,
                &job_id_for_copy,
                &meter_for_copy,
                c_bytes,
                v_bytes,
                total_work_units,
                start_instant,
                proc_for_copy.load(Ordering::Relaxed),
                ver_for_copy.load(Ordering::Relaxed),
                res_for_copy.load(Ordering::Relaxed),
                &rel_for_copy,
                copy_label,
            );
        },
    )
    .await?;

    let p_files = if count_bytes_on_attempt {
        proc_acc.fetch_add(1, Ordering::Relaxed) + 1
    } else {
        proc_acc.load(Ordering::Relaxed)
    };
    let v_files = if fast_inline_verify_only && count_bytes_on_attempt {
        ver_acc.fetch_add(1, Ordering::Relaxed) + 1
    } else {
        ver_acc.load(Ordering::Relaxed)
    };

    emit_throttled_metrics(
        app,
        manager,
        job_id,
        speed_meter,
        copied_acc.load(Ordering::Relaxed),
        verified_acc.load(Ordering::Relaxed),
        total_work_units,
        start_instant,
        p_files,
        v_files,
        res_acc.load(Ordering::Relaxed),
        &rel_path,
        copy_label,
    );

    Ok((source_hash, false))
}

#[allow(clippy::too_many_arguments)]
async fn verify_single_file_phase2(
    app: &AppHandle,
    manager: &Arc<EngineManager>,
    job_id: &str,
    file_entry: &SourceFileEntry,
    expected_src_hash: &str,
    was_existing_candidate: bool,
    resolved_destinations: &[PathBuf],
    algorithm: &str,
    ctrl_flag: &Arc<AtomicU8>,
    speed_meter: &Arc<Mutex<SlidingSpeedMeter>>,
    copied_acc: &Arc<AtomicU64>,
    verified_acc: &Arc<AtomicU64>,
    proc_acc: &Arc<AtomicUsize>,
    ver_acc: &Arc<AtomicUsize>,
    res_acc: &Arc<AtomicUsize>,
    total_work_units: f64,
    start_instant: Instant,
    count_bytes_on_attempt: bool,
    emit_ui_during_chunks: bool,
) -> Result<VerifiedFileRecord, String> {
    let rel_path = file_entry.rel_path.clone();
    let file_size = file_entry.size;
    let dest_count = resolved_destinations.len().max(1) as u64;
    let mut dest_hashes = Vec::with_capacity(resolved_destinations.len());

    for dest_root in resolved_destinations {
        let dest_file_path = dest_root.join(&rel_path);
        let algo_c = algorithm.to_string();
        let ctrl_c = ctrl_flag.clone();
        let app_c = app.clone();
        let manager_c = manager.clone();
        let job_id_c = job_id.to_string();
        let meter_c = speed_meter.clone();
        let copied_c = copied_acc.clone();
        let verified_c = verified_acc.clone();
        let proc_c = proc_acc.clone();
        let ver_c = ver_acc.clone();
        let res_c = res_acc.clone();
        let rel_c = rel_path.clone();

        let d_hash = tauri::async_runtime::spawn_blocking(move || {
            let mut remainder = 0u64;
            compute_file_hash_nocache(&dest_file_path, &algo_c, &ctrl_c, |chunk_len| {
                let total_chunk = chunk_len + remainder;
                let normalized = total_chunk / dest_count;
                remainder = total_chunk % dest_count;
                if normalized > 0 {
                    let v_bytes = if count_bytes_on_attempt {
                        verified_c.fetch_add(normalized, Ordering::Relaxed) + normalized
                    } else {
                        verified_c.load(Ordering::Relaxed)
                    };
                    if emit_ui_during_chunks {
                        let c_bytes = copied_c.load(Ordering::Relaxed);
                        emit_throttled_metrics(
                            &app_c,
                            &manager_c,
                            &job_id_c,
                            &meter_c,
                            c_bytes,
                            v_bytes,
                            total_work_units,
                            start_instant,
                            proc_c.load(Ordering::Relaxed),
                            ver_c.load(Ordering::Relaxed),
                            res_c.load(Ordering::Relaxed),
                            &rel_c,
                            "Phase 2/2 — Vérification physique directe (hors cache RAM)…",
                        );
                    }
                }
            })
        })
        .await
        .map_err(|e| e.to_string())??;

        if d_hash != expected_src_hash {
            return Err(format!(
                "DISCORDANCE DE CHECKSUM sur {} ! Source ({}) != Destination ({})",
                rel_path, expected_src_hash, d_hash
            ));
        }
        dest_hashes.push(d_hash);
    }

    let v_files = ver_acc.fetch_add(1, Ordering::Relaxed) + 1;
    let r_files = if was_existing_candidate {
        res_acc.fetch_add(1, Ordering::Relaxed) + 1
    } else {
        res_acc.load(Ordering::Relaxed)
    };

    if emit_ui_during_chunks {
        emit_throttled_metrics(
            app,
            manager,
            job_id,
            speed_meter,
            copied_acc.load(Ordering::Relaxed),
            verified_acc.load(Ordering::Relaxed),
            total_work_units,
            start_instant,
            proc_acc.load(Ordering::Relaxed),
            v_files,
            r_files,
            &rel_path,
            "Phase 2/2 — Vérification physique directe (hors cache RAM)…",
        );
    } else {
        // Shadow Verifier completed a file in the background while Copy is active:
        // Immediately reflect the new `verified_files` count in UI state without disturbing `current_file` or `speed_meter`!
        let v_bytes_now = verified_acc.load(Ordering::Relaxed);
        update_job_state(app, manager, job_id, |st| {
            if st.status == "paused" || st.status == "cancelled" || st.status == "failed" {
                return;
            }
            st.verified_files = v_files;
            st.resumed_files = r_files;
            st.verified_bytes = v_bytes_now.min(st.total_bytes);
        });
    }

    let v_health = match check_video_container_health(&file_entry.abs_path) {
        VideoHealth::CorruptedMissingMoov => Some("corrupted_moov".to_string()),
        VideoHealth::TruncatedHeader => Some("truncated".to_string()),
        VideoHealth::Ok => Some("ok".to_string()),
        VideoHealth::NotVideo => None,
    };

    if let Some(ref vh) = v_health {
        if vh != "ok" {
            let warn_msg = if vh == "corrupted_moov" {
                format!("{} (atome MOOV manquant — enregistrement non finalisé)", rel_path)
            } else {
                format!("{} (en-tête de conteneur vidéo corrompu ou tronqué)", rel_path)
            };
            update_job_state(app, manager, job_id, |st| {
                if !st.corrupted_videos.contains(&warn_msg) {
                    st.corrupted_videos.push(warn_msg);
                }
            });
        }
    }

    Ok(VerifiedFileRecord {
        relative_path: rel_path,
        size_bytes: file_size,
        source_hash: expected_src_hash.to_string(),
        dest_hashes,
        algorithm: algorithm.to_string(),
        status: if was_existing_candidate {
            "resumed_verified".to_string()
        } else {
            "verified".to_string()
        },
        video_health: v_health,
    })
}

#[cfg(unix)]
fn pread_exact_slice(file: &File, mut buf: &mut [u8], mut offset: u64) -> std::io::Result<usize> {
    use std::os::unix::fs::FileExt;
    let mut total_read = 0usize;
    while !buf.is_empty() {
        match file.read_at(buf, offset) {
            Ok(0) => break,
            Ok(n) => {
                total_read += n;
                offset += n as u64;
                buf = &mut buf[n..];
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(total_read)
}

#[allow(clippy::too_many_arguments)]
async fn copy_large_file_single_read_multi_write(
    src_file_path: &Path,
    rel_path: &str,
    mtime: Option<SystemTime>,
    resolved_destinations: &[PathBuf],
    algorithm: &str,
    ctrl_flag: &Arc<AtomicU8>,
    chunk_size: usize,
    pread_workers: usize,
    ring_buffer_slots: usize,
    on_chunk_copied: impl Fn(u64) + Send + Sync + 'static,
) -> Result<String, String> {
    let mut senders = Vec::with_capacity(resolved_destinations.len());
    let mut writer_handles = Vec::with_capacity(resolved_destinations.len());
    let on_chunk_cb = Arc::new(on_chunk_copied);

    for (idx, dest_root) in resolved_destinations.iter().enumerate() {
        let final_dest = dest_root.join(rel_path);
        let temp_dest = dest_root.join(format!("{}.hardback.part", rel_path));
        if let Some(parent) = temp_dest.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let (tx, mut rx) = mpsc::channel::<Bytes>(ring_buffer_slots.max(8));
        senders.push(tx);

        let cb_for_writer = if idx == 0 {
            Some(on_chunk_cb.clone())
        } else {
            None
        };

        let ctrl_for_writer = ctrl_flag.clone();
        let writer_handle = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let out_file = File::create(&temp_dest).map_err(|e| {
                format!(
                    "Impossible de créer le fichier temporaire {} : {}",
                    temp_dest.display(),
                    e
                )
            })?;
            // 4 MiB sequential BufWriter prevents small unaligned writes on both SSDs and HDDs
            let mut buffered_writer = BufWriter::with_capacity(4 * 1024 * 1024, out_file);

            while let Some(chunk) = rx.blocking_recv() {
                if ctrl_for_writer.load(Ordering::Relaxed) != CTRL_RUNNING {
                    let _ = fs::remove_file(&temp_dest);
                    return Err("INTERRUPTED".to_string());
                }
                buffered_writer.write_all(&chunk).map_err(|e| {
                    let _ = fs::remove_file(&temp_dest);
                    format!(
                        "Erreur d'écriture disque sur {} : {}",
                        temp_dest.display(),
                        e
                    )
                })?;
                if let Some(ref cb) = cb_for_writer {
                    cb(chunk.len() as u64);
                }
            }

            if ctrl_for_writer.load(Ordering::Relaxed) != CTRL_RUNNING {
                let _ = fs::remove_file(&temp_dest);
                return Err("INTERRUPTED".to_string());
            }

            buffered_writer.flush().map_err(|e| {
                let _ = fs::remove_file(&temp_dest);
                format!(
                    "Erreur de finalisation tampon sur {} : {}",
                    temp_dest.display(),
                    e
                )
            })?;
            let out_file = buffered_writer.into_inner().map_err(|e| {
                let _ = fs::remove_file(&temp_dest);
                format!(
                    "Erreur de fermeture tampon sur {} : {}",
                    temp_dest.display(),
                    e.error()
                )
            })?;

            preserve_camera_mtime(&out_file, mtime);
            drop(out_file);

            fs::rename(&temp_dest, &final_dest).map_err(|e| {
                format!(
                    "Impossible de finaliser le fichier {} : {}",
                    final_dest.display(),
                    e
                )
            })?;

            Ok(())
        });

        writer_handles.push(writer_handle);
    }

    let src_owned = src_file_path.to_path_buf();
    let algo_owned = algorithm.to_string();
    let ctrl_owned = ctrl_flag.clone();
    let read_chunk_size = chunk_size.max(256 * 1024);
    let workers_count = pread_workers.max(1);

    let reader_res = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let mut src_file = File::open(&src_owned)
            .map_err(|e| format!("Impossible d'ouvrir la source {} : {}", src_owned.display(), e))?;
        enable_os_readahead(&src_file);
        let file_len = src_file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut hasher = StreamHasher::new(&algo_owned);

        #[cfg(unix)]
        if workers_count > 1 && file_len > (read_chunk_size as u64 * 2) {
            let src_arc = Arc::new(src_file);
            let total_chunks = file_len.div_ceil(read_chunk_size as u64);
            let max_in_flight = (workers_count as u64 * 2).max(16);
            let next_dispatch = Arc::new(AtomicU64::new(0));
            let window_pair = Arc::new((Mutex::new(max_in_flight), std::sync::Condvar::new()));
            let (res_tx, res_rx) =
                std::sync::mpsc::sync_channel::<Result<(u64, Bytes), String>>((max_in_flight as usize) + 4);

            let copy_res = std::thread::scope(|s| -> Result<(), String> {
                for _ in 0..workers_count {
                    let f_ref = src_arc.clone();
                    let disp_ref = next_dispatch.clone();
                    let win_ref = window_pair.clone();
                    let ctrl_ref = ctrl_owned.clone();
                    let tx_ref = res_tx.clone();
                    let src_disp = src_owned.display().to_string();

                    s.spawn(move || {
                        let mut local_buf = vec![0u8; read_chunk_size];
                        loop {
                            if ctrl_ref.load(Ordering::Relaxed) != CTRL_RUNNING {
                                let _ = tx_ref.send(Err("INTERRUPTED".to_string()));
                                break;
                            }
                            let idx = disp_ref.fetch_add(1, Ordering::Relaxed);
                            if idx >= total_chunks {
                                break;
                            }

                            // Wait until `idx` is inside the active sliding window
                            {
                                let (lock, cvar) = &*win_ref;
                                let mut limit = lock.lock().unwrap_or_else(|p| p.into_inner());
                                while idx >= *limit {
                                    if ctrl_ref.load(Ordering::Relaxed) != CTRL_RUNNING {
                                        let _ = tx_ref.send(Err("INTERRUPTED".to_string()));
                                        return;
                                    }
                                    match cvar.wait_timeout(limit, Duration::from_millis(100)) {
                                        Ok(res) => limit = res.0,
                                        Err(poisoned) => limit = poisoned.into_inner().0,
                                    }
                                }
                            }

                            let offset = idx * (read_chunk_size as u64);
                            let expected_len =
                                ((file_len - offset) as usize).min(read_chunk_size);
                            match pread_exact_slice(
                                &f_ref,
                                &mut local_buf[..expected_len],
                                offset,
                            ) {
                                Ok(n) => {
                                    let chunk_bytes = Bytes::copy_from_slice(&local_buf[..n]);
                                    if tx_ref.send(Ok((idx, chunk_bytes))).is_err() {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    let _ = tx_ref.send(Err(format!(
                                        "Erreur lecture parallèle {} : {}",
                                        src_disp, e
                                    )));
                                    break;
                                }
                            }
                        }
                    });
                }
                drop(res_tx);

                let mut pending: BTreeMap<u64, Bytes> = BTreeMap::new();
                let mut next_expected = 0u64;

                while next_expected < total_chunks {
                    if ctrl_owned.load(Ordering::Relaxed) != CTRL_RUNNING {
                        let (lock, cvar) = &*window_pair;
                        *lock.lock().unwrap_or_else(|p| p.into_inner()) = u64::MAX;
                        cvar.notify_all();
                        return Err("INTERRUPTED".to_string());
                    }

                    let (idx, chunk_bytes) = loop {
                        if ctrl_owned.load(Ordering::Relaxed) != CTRL_RUNNING {
                            let (lock, cvar) = &*window_pair;
                            *lock.lock().unwrap_or_else(|p| p.into_inner()) = u64::MAX;
                            cvar.notify_all();
                            return Err("INTERRUPTED".to_string());
                        }
                        match res_rx.recv_timeout(Duration::from_millis(100)) {
                            Ok(Ok(pair)) => break pair,
                            Ok(Err(e)) => {
                                let (lock, cvar) = &*window_pair;
                                *lock.lock().unwrap_or_else(|p| p.into_inner()) = u64::MAX;
                                cvar.notify_all();
                                return Err(e);
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                return Err("INTERRUPTED".to_string());
                            }
                        }
                    };

                    pending.insert(idx, chunk_bytes);

                    while let Some(ordered_chunk) = pending.remove(&next_expected) {
                        hasher.update(&ordered_chunk);
                        for tx in &senders {
                            loop {
                                if ctrl_owned.load(Ordering::Relaxed) != CTRL_RUNNING {
                                    let (lock, cvar) = &*window_pair;
                                    *lock.lock().unwrap_or_else(|p| p.into_inner()) = u64::MAX;
                                    cvar.notify_all();
                                    return Err("INTERRUPTED".to_string());
                                }
                                match tx.try_send(ordered_chunk.clone()) {
                                    Ok(()) => break,
                                    Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                                        std::thread::sleep(Duration::from_millis(15));
                                    }
                                    Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                                        let (lock, cvar) = &*window_pair;
                                        *lock.lock().unwrap_or_else(|p| p.into_inner()) = u64::MAX;
                                        cvar.notify_all();
                                        return Err("INTERRUPTED".to_string());
                                    }
                                }
                            }
                        }
                        next_expected += 1;
                    }

                    // Advance window limit so `pread` workers stay fed
                    {
                        let (lock, cvar) = &*window_pair;
                        let mut limit = lock.lock().unwrap_or_else(|p| p.into_inner());
                        let new_limit = next_expected + max_in_flight;
                        if new_limit > *limit {
                            *limit = new_limit;
                            cvar.notify_all();
                        }
                    }
                }

                Ok(())
            });

            copy_res?;
            drop(senders);
            return Ok(hasher.digest_hex());
        }

        // Single-reader sequential fallback (for rotational HDD sources or small files)
        let mut buf = vec![0u8; read_chunk_size];
        loop {
            if ctrl_owned.load(Ordering::Relaxed) != CTRL_RUNNING {
                return Err("INTERRUPTED".to_string());
            }

            let n = src_file
                .read(&mut buf)
                .map_err(|e| format!("Erreur lecture source {} : {}", src_owned.display(), e))?;
            if n == 0 {
                break;
            }

            hasher.update(&buf[..n]);
            let shared_chunk = Bytes::copy_from_slice(&buf[..n]);

            for tx in &senders {
                loop {
                    if ctrl_owned.load(Ordering::Relaxed) != CTRL_RUNNING {
                        return Err("INTERRUPTED".to_string());
                    }
                    match tx.try_send(shared_chunk.clone()) {
                        Ok(()) => break,
                        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                            std::thread::sleep(Duration::from_millis(20));
                        }
                        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                            return Err("INTERRUPTED".to_string());
                        }
                    }
                }
            }
        }

        drop(senders);
        Ok(hasher.digest_hex())
    })
    .await
    .map_err(|e| format!("Erreur thread de lecture : {}", e))?;

    let source_hash = match reader_res {
        Ok(h) => {
            for handle in writer_handles {
                handle
                    .await
                    .map_err(|e| format!("Erreur tâche d'écriture : {}", e))??;
            }
            h
        }
        Err(e) => {
            for handle in writer_handles {
                let _ = handle.await;
            }
            for dest_root in resolved_destinations {
                let temp_dest = dest_root.join(format!("{}.hardback.part", rel_path));
                let _ = fs::remove_file(temp_dest);
            }
            return Err(e);
        }
    };

    Ok(source_hash)
}

/// Removes all files and newly created destination directories written by a cancelled transfer
/// so no incomplete or unwanted files remain on the target drive.
pub fn purge_cancelled_job(cp: &JobCheckpoint) {
    // 1. Delete every file written during this job across all destinations

    // 1. Delete every file written during this job across all destinations
    for dest_root in &cp.resolved_destinations {
        if !dest_root.exists() {
            continue;
        }
        for rel in &cp.written_rel_paths {
            let _ = fs::remove_file(dest_root.join(rel));
            let _ = fs::remove_file(dest_root.join(format!("{}.hardback.part", rel)));
        }
        for (rel, rec) in &cp.verified_map {
            if rec.status == "verified" {
                let _ = fs::remove_file(dest_root.join(rel));
            }
        }
    }

    // 2. Only remove created destination root directories if they are now empty
    // (Never remove non-empty folders which may contain files from a concurrent/new transfer!)
    for created_root in &cp.created_dest_roots {
        if created_root.exists() && created_root.as_os_str().len() > 4 {
            let _ = fs::remove_dir(created_root);
        }
    }

    // 3. Clean up any remaining empty subdirectories inside resolved_destinations
    for dest_root in &cp.resolved_destinations {
        if !dest_root.exists() {
            continue;
        }
        let mut subdirs: Vec<PathBuf> = WalkDir::new(dest_root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_dir())
            .map(|e| e.path().to_path_buf())
            .collect();
        // Sort deepest first so empty child directories are removed before their parents
        subdirs.sort_by_key(|b| std::cmp::Reverse(b.components().count()));
        for dir in subdirs {
            let _ = fs::remove_dir(&dir); // fs::remove_dir only removes if empty
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn emit_throttled_metrics(
    app: &AppHandle,
    manager: &Arc<EngineManager>,
    job_id: &str,
    speed_meter: &Arc<Mutex<SlidingSpeedMeter>>,
    copied_bytes: u64,
    verified_bytes: u64,
    total_work_units: f64,
    start_instant: Instant,
    processed_files: usize,
    verified_files: usize,
    resumed_files: usize,
    current_file: &str,
    phase_label: &str,
) {
    let copy_virtual = copied_bytes
        .saturating_add((processed_files as u64).saturating_mul(VIRTUAL_FILE_OVERHEAD_BYTES));
    let verify_virtual = verified_bytes
        .saturating_add((verified_files as u64).saturating_mul(VIRTUAL_FILE_OVERHEAD_BYTES));
    let current_virtual_work = copy_virtual.saturating_add(verify_virtual) as f64;

    let (should_emit, displayed_bps, eta_seconds, phase_tag, single_pass_mode, phase_total_virt) = {
        let mut meter = speed_meter.lock().unwrap();
        let (active_phase_real_bytes, active_phase_virtual_work) = if meter.phase_tag == 2 {
            (verified_bytes, verify_virtual as f64)
        } else {
            (copied_bytes, copy_virtual as f64)
        };
        let (emit, bps, eta) =
            meter.record_and_check_emit(active_phase_real_bytes, active_phase_virtual_work);
        (
            emit,
            bps,
            eta,
            meter.phase_tag,
            meter.fast_inline_mode,
            meter.phase_total_virtual_bytes,
        )
    };

    if !should_emit {
        return;
    }

    // Abort metrics emission if job was paused, cancelled, or failed
    {
        let flags = manager.control_flags.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(flag) = flags.get(job_id) {
            if flag.load(Ordering::Relaxed) != CTRL_RUNNING {
                return;
            }
        }
    }

    let progress_pct = if single_pass_mode {
        let copy_frac = (copy_virtual as f64) / phase_total_virt.max(1.0);
        let ver_frac = (verify_virtual as f64) / phase_total_virt.max(1.0);
        ((0.85 * copy_frac + 0.15 * ver_frac) * 100.0).clamp(0.0, 99.9)
    } else {
        ((current_virtual_work / total_work_units) * 100.0).clamp(0.0, 99.9)
    };

    update_job_state(app, manager, job_id, |st| {
        if st.status == "paused" || st.status == "cancelled" || st.status == "failed" {
            return;
        }
        st.status = if phase_tag == 2 {
            "verifying".to_string()
        } else {
            "copying".to_string()
        };
        st.copied_bytes = copied_bytes.min(st.total_bytes);
        st.verified_bytes = verified_bytes.min(st.total_bytes);
        st.processed_files = processed_files;
        st.verified_files = verified_files;
        st.resumed_files = resumed_files;
        st.current_file = current_file.to_string();
        st.phase_label = phase_label.to_string();
        st.progress_percent = progress_pct;
        st.speed_bps = displayed_bps;
        st.eta_seconds = eta_seconds;
        st.elapsed_seconds = start_instant.elapsed().as_secs_f64();
    });

    // Gentle non-blocking tray status update at ~1s interval, never blocking the I/O worker
    static LAST_TRAY_TICK: AtomicU64 = AtomicU64::new(0);
    let now_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let last_ms = LAST_TRAY_TICK.load(Ordering::Relaxed);
    if now_ms.saturating_sub(last_ms) >= 1000 {
        LAST_TRAY_TICK.store(now_ms, Ordering::Relaxed);
        refresh_tray_status(app, manager);
    }
}

fn update_job_state(
    app: &AppHandle,
    manager: &Arc<EngineManager>,
    job_id: &str,
    mutate: impl FnOnce(&mut TransferJobState),
) {
    let updated = {
        let mut jobs = manager.jobs.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(st) = jobs.get_mut(job_id) {
            mutate(st);
            Some(st.clone())
        } else {
            None
        }
    };
    if let Some(state) = updated {
        let _ = app.emit("transfer-progress", &state);
    }
}

#[cfg(target_os = "macos")]
pub fn refresh_tray_status(app: &AppHandle, manager: &EngineManager) {
    let title_to_set = {
        let jobs = match manager.jobs.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };

        // 1. Prioritize active transfer: copying or verifying
        let active_job = jobs.values().find(|j| j.status == "copying" || j.status == "verifying");
        if let Some(state) = active_job {
            let speed_mb = state.speed_bps / (1024.0 * 1024.0);
            let title = if speed_mb >= 1024.0 {
                format!(" {:.0}% • {:.2} Go/s", state.progress_percent, speed_mb / 1024.0)
            } else if speed_mb > 0.0 {
                format!(" {:.0}% • {:.0} Mo/s", state.progress_percent, speed_mb)
            } else {
                format!(" {:.0}%", state.progress_percent)
            };
            Some(title)
        } else if jobs.values().any(|j| j.status == "paused") {
            Some(" En pause".to_string())
        } else if jobs.values().any(|j| j.status == "queued") {
            Some(" En file…".to_string())
        } else {
            None
        }
    };

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = app_handle.tray_by_id("hardback-tray") {
            let _ = tray.set_title(title_to_set);
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn refresh_tray_status(_app: &AppHandle, _manager: &EngineManager) {}

#[allow(clippy::too_many_arguments)]
fn finalize_job_non_complete(
    app: &AppHandle,
    manager: &Arc<EngineManager>,
    job_id: &str,
    source_name: &str,
    source_path: &str,
    source_paths: &[String],
    raw_destination_paths: &[String],
    algorithm: &str,
    start_instant: Instant,
    status: &str,
    msg: String,
) {
    let elapsed = start_instant.elapsed().as_secs_f64();
    let mut snapshot = None;
    update_job_state(app, manager, job_id, |st| {
        st.status = status.to_string();
        st.phase_label = if status == "paused" {
            "En pause — Prêt pour reprise immédiate".to_string()
        } else {
            "Erreur lors du transfert".to_string()
        };
        st.error_message = if status == "paused" {
            None
        } else {
            Some(msg.clone())
        };
        st.speed_bps = 0.0;
        st.eta_seconds = None;
        st.elapsed_seconds = elapsed;
        snapshot = Some(st.clone());
    });

    manager.persist_to_disk();

    if let Some(st) = snapshot {
        let history_entry = IngestHistoryEntry {
            id: job_id.to_string(),
            source_name: source_name.to_string(),
            source_path: source_path.to_string(),
            source_paths: source_paths.to_vec(),
            destination_paths: raw_destination_paths.to_vec(),
            total_files: st.total_files,
            verified_files: st.verified_files,
            resumed_files: st.resumed_files,
            total_bytes: st.total_bytes,
            duration_secs: elapsed,
            average_speed_bps: 0.0,
            status: if status == "paused" {
                "interrupted".to_string()
            } else {
                "failed".to_string()
            },
            error_message: if status == "paused" { None } else { Some(msg) },
            algorithm: algorithm.to_string(),
            report_paths: Vec::new(),
            created_at: Utc::now().to_rfc3339(),
        };
        let updated_history = save_or_update_history_entry(history_entry);
        let _ = app.emit("history-updated", &updated_history);
    }
}
