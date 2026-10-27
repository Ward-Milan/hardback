pub mod engine;
pub mod history;
pub mod report;
pub mod settings;
pub mod volumes;

use engine::{
    purge_cancelled_job, resume_existing_job, start_ingest_job, EngineManager, TransferJobState,
    CTRL_CANCELLED, CTRL_PAUSED,
};
use history::{delete_history_entry, load_history, IngestHistoryEntry};
use report::{export_certificate_pdf, load_visual_certificate, VisualCertificateData};
use settings::{load_settings, save_settings, AppSettings};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use volumes::{
    eject_storage_volume, inspect_multiple_paths, inspect_path_details, list_storage_devices,
    list_subdirectories, open_in_file_manager, PathInspection, StorageDevice, SubfolderEntry,
};

#[tauri::command]
async fn get_storage_devices() -> Vec<StorageDevice> {
    list_storage_devices()
}

#[tauri::command]
async fn inspect_path(path: String) -> Result<PathInspection, String> {
    inspect_path_details(&path)
}

#[tauri::command]
async fn inspect_paths(paths: Vec<String>) -> Result<PathInspection, String> {
    inspect_multiple_paths(&paths)
}

#[tauri::command]
async fn list_subfolders(path: String) -> Result<Vec<SubfolderEntry>, String> {
    list_subdirectories(&path)
}

#[tauri::command]
async fn eject_volume(app: AppHandle, mount_point: String) -> Result<String, String> {
    let res = eject_storage_volume(&mount_point)?;
    let _ = app.emit("devices-changed", ());
    Ok(res)
}

#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    open_in_file_manager(&path)
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> AppSettings {
    let mut s = load_settings();
    if let Ok(enabled) = app.autolaunch().is_enabled() {
        s.launch_at_startup = enabled;
    }
    s
}

#[tauri::command]
fn update_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let autolaunch = app.autolaunch();
    if settings.launch_at_startup {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }
    save_settings(&settings)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn start_transfer(
    app: AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    source_path: Option<String>,
    source_paths: Option<Vec<String>>,
    destination_paths: Vec<String>,
    algorithm: Option<String>,
    create_subfolder: Option<bool>,
    custom_folder_name: Option<String>,
    existing_job_id: Option<String>,
) -> Result<TransferJobState, String> {
    let resolved_sources = match source_paths {
        Some(list) if !list.is_empty() => list,
        _ => match source_path {
            Some(single) if !single.is_empty() => vec![single],
            _ => return Err("Veuillez sélectionner une source.".to_string()),
        },
    };
    let algo = algorithm.unwrap_or_else(|| "xxh64".to_string());
    let subfolder = create_subfolder.unwrap_or(true);
    start_ingest_job(
        app,
        manager.inner().clone(),
        resolved_sources,
        destination_paths,
        algo,
        subfolder,
        custom_folder_name,
        existing_job_id,
    )
}

#[tauri::command]
async fn pause_transfer(
    app: AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    job_id: String,
) -> Result<TransferJobState, String> {
    {
        let flags = manager.control_flags.lock().unwrap();
        if let Some(flag) = flags.get(&job_id) {
            flag.store(CTRL_PAUSED, Ordering::Relaxed);
        } else {
            return Err("Transfert introuvable".to_string());
        }
    }

    let updated_job = {
        let mut jobs = manager.jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            job.status = "paused".to_string();
            job.phase_label = "En pause — Prêt pour reprise immédiate".to_string();
            job.speed_bps = 0.0;
            job.eta_seconds = None;
            Some(job.clone())
        } else {
            None
        }
    };

    if let Some(state) = updated_job {
        manager.persist_to_disk();
        crate::engine::refresh_tray_status(&app, &manager);
        let _ = app.emit("transfer-progress", &state);
        Ok(state)
    } else {
        Err("Transfert introuvable".to_string())
    }
}

#[tauri::command]
async fn resume_transfer(
    app: AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    job_id: String,
) -> Result<TransferJobState, String> {
    let res = resume_existing_job(app.clone(), manager.inner().clone(), &job_id);
    crate::engine::refresh_tray_status(&app, &manager);
    res
}

#[tauri::command]
async fn cancel_transfer(
    app: AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    job_id: String,
) -> Result<Vec<TransferJobState>, String> {
    let was_completed = {
        let jobs = manager.jobs.lock().unwrap();
        jobs.get(&job_id)
            .map(|j| j.status == "completed")
            .unwrap_or(false)
    };

    // Safety guard: never delete destination files or history if the job was already completed!
    if was_completed {
        {
            let mut jobs = manager.jobs.lock().unwrap();
            jobs.remove(&job_id);
        }
        {
            let mut cps = manager.checkpoints.lock().unwrap();
            cps.remove(&job_id);
        }
        manager.persist_to_disk();
        crate::engine::refresh_tray_status(&app, &manager);
        let _ = app.emit("transfer-cancelled", &job_id);
        let jobs = manager.jobs.lock().unwrap();
        let mut list: Vec<TransferJobState> = jobs.values().cloned().collect();
        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        return Ok(list);
    }

    {
        let flags = manager.control_flags.lock().unwrap();
        if let Some(flag) = flags.get(&job_id) {
            flag.store(CTRL_CANCELLED, Ordering::Relaxed);
        }
    }

    let maybe_cp = {
        let mut cps = manager.checkpoints.lock().unwrap();
        cps.remove(&job_id).map(|arc_cp| arc_cp.lock().unwrap().clone())
    };

    {
        let mut jobs = manager.jobs.lock().unwrap();
        jobs.remove(&job_id);
    }

    manager.persist_to_disk();
    delete_history_entry(&job_id);

    if let Some(cp_snapshot) = maybe_cp {
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            purge_cancelled_job(&cp_snapshot);
        });
    }

    crate::engine::refresh_tray_status(&app, &manager);
    let _ = app.emit("transfer-cancelled", &job_id);

    let jobs = manager.jobs.lock().unwrap();
    let mut list: Vec<TransferJobState> = jobs.values().cloned().collect();
    list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(list)
}

#[tauri::command]
fn dismiss_transfer(
    app: AppHandle,
    manager: State<'_, Arc<EngineManager>>,
    job_id: String,
) -> Vec<TransferJobState> {
    {
        let mut jobs = manager.jobs.lock().unwrap();
        jobs.remove(&job_id);
    }
    {
        let mut cps = manager.checkpoints.lock().unwrap();
        cps.remove(&job_id);
    }
    manager.persist_to_disk();

    crate::engine::refresh_tray_status(&app, &manager);
    let _ = app.emit("transfer-cancelled", &job_id);

    let jobs = manager.jobs.lock().unwrap();
    let mut list: Vec<TransferJobState> = jobs.values().cloned().collect();
    list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    list
}

#[tauri::command]
fn get_active_transfers(manager: State<'_, Arc<EngineManager>>) -> Vec<TransferJobState> {
    let jobs = manager.jobs.lock().unwrap();
    let mut list: Vec<TransferJobState> = jobs.values().cloned().collect();
    list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    list
}

#[tauri::command]
fn get_ingest_history() -> Vec<IngestHistoryEntry> {
    load_history()
}

#[tauri::command]
fn remove_history_item(id: String) -> Vec<IngestHistoryEntry> {
    delete_history_entry(&id)
}

#[tauri::command]
fn read_report_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Impossible de lire le rapport {} : {}", path, e))
}

#[tauri::command]
fn read_visual_certificate(path: String) -> Result<VisualCertificateData, String> {
    load_visual_certificate(&path)
}

#[tauri::command]
async fn export_certificate_to_pdf(
    cert: VisualCertificateData,
    output_path: String,
) -> Result<String, String> {
    export_certificate_pdf(&cert, &output_path)
}

#[tauri::command]
async fn create_demo_environment() -> Result<(PathInspection, PathInspection), String> {
    let base = std::env::temp_dir().join("Hardback_Demo_Lab");
    let card_dir = base.join("SD_CAM_A001");
    let dest_dir = base.join("BACKUP_SSD_01");
    let reels_dir = card_dir.join("DCIM").join("100MEDIA");

    fs::create_dir_all(&reels_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let sample_clips = [
        ("A001_C001_20261022_RAW.MOV", 16 * 1024 * 1024usize),
        ("A001_C002_20261022_RAW.MOV", 16 * 1024 * 1024usize),
        ("A001_C003_20261022_RAW.MOV", 12 * 1024 * 1024usize),
        ("A001_METADATA.XML", 64 * 1024usize),
    ];

    let pattern: Vec<u8> = (0..65536).map(|i| ((i * 31 + 7) % 251) as u8).collect();
    for (filename, size) in sample_clips {
        let p: PathBuf = reels_dir.join(filename);
        if !p.exists() {
            let mut f = File::create(&p).map_err(|e| e.to_string())?;
            let mut written = 0usize;
            while written < size {
                let to_write = (size - written).min(pattern.len());
                f.write_all(&pattern[..to_write]).map_err(|e| e.to_string())?;
                written += to_write;
            }
        }
    }

    let src_inspect = inspect_path_details(&card_dir.to_string_lossy())?;
    let dst_inspect = inspect_path_details(&dest_dir.to_string_lossy())?;
    Ok((src_inspect, dst_inspect))
}

#[tauri::command]
async fn open_main_window(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_theme(Some(tauri::Theme::Dark));
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn hide_menulet_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("menulet") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app.dialog().file();
    if let Some(t) = title {
        builder = builder.set_title(t);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    builder.pick_folder(move |res| {
        let path = res.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let manager = Arc::new(EngineManager::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .manage(manager)
        .setup(|app| {
            let handle = app.handle().clone();

            // Right-click context menu for the tray bubble
            let tray_menu = MenuBuilder::new(app)
                .text("open_main", "Ouvrir Hardback")
                .separator()
                .text("quit", "Quitter Hardback")
                .build()?;

            let _tray = TrayIconBuilder::with_id("hardback-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Hardback Express — Ingest Rapide")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open_main" => {
                            #[cfg(target_os = "macos")]
                            let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        if let Some(menulet) = handle.get_webview_window("menulet") {
                            let is_vis = menulet.is_visible().unwrap_or(false);
                            if is_vis {
                                let _ = menulet.hide();
                            } else {
                                let win_w = 580.0;
                                let (pos_x, pos_y) = match rect.position {
                                    tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                                    tauri::Position::Logical(l) => (l.x, l.y),
                                };
                                let (size_w, size_h) = match rect.size {
                                    tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
                                    tauri::Size::Logical(l) => (l.width, l.height),
                                };
                                let tray_center_x = pos_x + (size_w / 2.0);
                                let x = (tray_center_x - (win_w / 2.0)).max(10.0);
                                let y = pos_y + size_h + 4.0;
                                let _ = menulet.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                                    x: x as i32,
                                    y: y as i32,
                                }));
                                let _ = menulet.show();
                                let _ = menulet.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // If started on boot (--autostart), stay discreet in accessory mode without opening main window
            let is_autostart = std::env::args().any(|arg| arg == "--autostart");
            if is_autostart {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.hide();
                }
            }

            // When main window close button (X) is clicked, hide into accessory mode instead of quitting,
            // keeping Hardback active in the macOS menu bar like CleanMyMac
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_theme(Some(tauri::Theme::Dark));
                let m_clone = main_win.clone();
                let a_handle = app.handle().clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let _ = m_clone.hide();
                        #[cfg(target_os = "macos")]
                        let _ = a_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        api.prevent_close();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_storage_devices,
            inspect_path,
            inspect_paths,
            list_subfolders,
            eject_volume,
            reveal_in_finder,
            get_app_settings,
            update_app_settings,
            start_transfer,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            dismiss_transfer,
            get_active_transfers,
            get_ingest_history,
            remove_history_item,
            read_report_content,
            read_visual_certificate,
            export_certificate_to_pdf,
            create_demo_environment,
            open_main_window,
            hide_menulet_window,
            pick_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building Hardback tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    // Prevent closing of background tray when main window exits or Cmd+Q is pressed
                    api.prevent_exit();
                    if let Some(main_win) = app_handle.get_webview_window("main") {
                        let _ = main_win.hide();
                    }
                    #[cfg(target_os = "macos")]
                    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
                tauri::RunEvent::Reopen { .. } => {
                    // Reopening from Finder, Spotlight or Launchpad restores the main window
                    #[cfg(target_os = "macos")]
                    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                _ => {}
            }
        });
}
