import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Folder,
  ArrowDown,
  Play,
  Pause,
  X,
  CheckCircle2,
  AlertTriangle,
  Maximize2,
  FolderOpen,
  Zap,
  HardDrive,
} from "lucide-react";
import {
  StorageDevice,
  PathInspection,
  TransferJobState,
  AppSettings,
} from "./types";
import { HardbackCascadeLogo } from "./Logo";

function SdCardLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 3H14.8L19 7.2V19C19 20.1 18.1 21 17 21H6C4.9 21 4 20.1 4 19V5C4 3.9 4.9 3 6 3Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 6.5V9.5M10 6.5V9.5M12.5 6.5V9.5M15 7.5V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="7"
        y="13"
        width="9"
        height="4.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function SsdLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M13 8.5L9.5 12.5H12.5L11 15.5L14.5 11.5H11.5L13 8.5Z"
        fill="currentColor"
      />
      <circle cx="6.5" cy="8.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="15.5" r="1" fill="currentColor" />
    </svg>
  );
}

function HddLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect
        x="4"
        y="3"
        width="16"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="12" cy="10.5" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="10.5" r="1.2" fill="currentColor" />
      <path
        d="M15.5 16.5L13.2 12.8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="8" cy="17.5" r="1" fill="currentColor" />
    </svg>
  );
}

function DeviceIcon({ deviceType, className }: { deviceType: string; className?: string }) {
  if (deviceType === "sd_card") return <SdCardLogo className={className} />;
  if (deviceType === "hdd") return <HddLogo className={className} />;
  return <SsdLogo className={className} />;
}

function EjectIcon({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 5L4.5 14H19.5L12 5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 18.5H19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 o";
  const k = 1024;
  const sizes = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i >= 3 ? 2 : 1)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "0.0 Mo/s";
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} Go/s`;
  }
  return `${mb.toFixed(1)} Mo/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return "Calcul…";
  if (seconds <= 0) return "Terminé";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

export default function Menulet() {
  const [devices, setDevices] = useState<StorageDevice[]>([]);
  const [sourceInspection, setSourceInspection] = useState<PathInspection | null>(null);
  const [destInspection, setDestInspection] = useState<PathInspection | null>(null);
  const [activeJobs, setActiveJobs] = useState<TransferJobState[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const notifyTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setNotification(msg);
    if (notifyTimer.current) window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(() => setNotification(null), 3000);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const devs = await invoke<StorageDevice[]>("get_storage_devices");
      setDevices(devs);
    } catch (err) {
      console.error("Erreur lecture disques:", err);
    }
  }, []);

  const refreshActiveJobs = useCallback(async () => {
    try {
      const jobs = await invoke<TransferJobState[]>("get_active_transfers");
      setActiveJobs(jobs);
    } catch (err) {
      console.error("Erreur lecture jobs:", err);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    refreshActiveJobs();
    invoke<AppSettings>("get_app_settings")
      .then(setSettings)
      .catch(console.error);

    const devInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshDevices();
      }
    }, 3000);
    return () => window.clearInterval(devInterval);
  }, [refreshDevices, refreshActiveJobs]);

  useEffect(() => {
    const unlistenProgress = listen<TransferJobState>("transfer-progress", (event) => {
      const updated = event.payload;
      setActiveJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [updated, ...prev];
      });
    });

    const unlistenCompleted = listen<TransferJobState>("transfer-completed", (event) => {
      const completed = event.payload;
      showToast(`Transfert terminé avec succès (${completed.verifiedFiles} fichiers vérifiés)`);
      refreshActiveJobs();
    });

    const unlistenCancelled = listen<string>("transfer-cancelled", (event) => {
      const cancelledId = event.payload;
      setActiveJobs((prev) => prev.filter((j) => j.id !== cancelledId));
    });

    const unlistenDevices = listen("devices-changed", () => {
      refreshDevices();
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenCompleted.then((fn) => fn());
      unlistenCancelled.then((fn) => fn());
      unlistenDevices.then((fn) => fn());
    };
  }, [refreshActiveJobs, refreshDevices, showToast]);

  // Robust Folder Picker: tries native Rust command first, falls back to plugin
  const selectDirectory = async (title: string): Promise<string | null> => {
    try {
      const chosen = await invoke<string | null>("pick_folder", { title });
      if (chosen) return chosen;
    } catch {
      // Fallback to plugin dialog
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      if (typeof selected === "string") return selected;
    } catch (err) {
      console.error("Erreur sélection dossier:", err);
      setErrorMsg("Impossible d'ouvrir l'explorateur : " + String(err));
    }
    return null;
  };

  const handlePickSource = async () => {
    const selected = await selectDirectory("Sélectionner la source (Carte SD ou dossier)");
    if (selected) {
      try {
        const insp = await invoke<PathInspection>("inspect_path", { path: selected });
        setSourceInspection(insp);
      } catch (err) {
        setErrorMsg(String(err));
      }
    }
  };

  const handlePickDest = async () => {
    const selected = await selectDirectory("Sélectionner la destination (Disque SSD ou dossier)");
    if (selected) {
      try {
        const insp = await invoke<PathInspection>("inspect_path", { path: selected });
        setDestInspection(insp);
      } catch (err) {
        setErrorMsg(String(err));
      }
    }
  };

  const handleSetDeviceAsSource = async (dev: StorageDevice) => {
    try {
      const insp = await invoke<PathInspection>("inspect_path", { path: dev.mountPoint });
      setSourceInspection(insp);
      showToast(`Source définie : ${dev.name}`);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleSetDeviceAsDest = async (dev: StorageDevice) => {
    try {
      const insp = await invoke<PathInspection>("inspect_path", { path: dev.mountPoint });
      setDestInspection(insp);
      showToast(`Destination définie : ${dev.name}`);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleEjectDevice = async (e: React.MouseEvent, dev: StorageDevice) => {
    e.stopPropagation();
    try {
      const msg = await invoke<string>("eject_volume", { mountPoint: dev.mountPoint });
      if (sourceInspection?.path.startsWith(dev.mountPoint)) {
        setSourceInspection(null);
      }
      if (destInspection?.path.startsWith(dev.mountPoint)) {
        setDestInspection(null);
      }
      await refreshDevices();
      showToast(msg || `Volume ${dev.name} éjecté`);
    } catch (err) {
      showToast(String(err));
    }
  };

  const handleStartTransfer = async () => {
    if (!sourceInspection || !destInspection) return;
    setIsStarting(true);
    setErrorMsg(null);
    try {
      await invoke("start_transfer", {
        sourcePath: sourceInspection.path,
        sourcePaths: [sourceInspection.path],
        destinationPaths: [destInspection.path],
        algorithm: settings?.hashAlgorithm || "xxh64",
        createSubfolder: true,
        customFolderName: null,
      });
      showToast("Transfert sécurisé démarré");
      setSourceInspection(null);
      setDestInspection(null);
      refreshActiveJobs();
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async (jobId: string) => {
    try {
      await invoke("pause_transfer", { jobId });
    } catch (err) {
      console.error(err);
    }
  };

  const handleResume = async (jobId: string) => {
    try {
      await invoke("resume_transfer", { jobId });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      setActiveJobs((prev) => prev.filter((j) => j.id !== jobId));
      const remaining = await invoke<TransferJobState[]>("cancel_transfer", { jobId });
      setActiveJobs(remaining || []);
    } catch (err) {
      console.error(err);
      refreshActiveJobs();
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenMain = async () => {
    try {
      await invoke("open_main_window");
    } catch (err) {
      console.error(err);
    }
  };

  const handleHideMenulet = async () => {
    try {
      await invoke("hide_menulet_window");
    } catch (err) {
      console.error(err);
    }
  };

  const primaryJob = activeJobs.find(
    (j) => j.status === "copying" || j.status === "verifying" || j.status === "paused" || j.status === "queued"
  );

  return (
    <div className="w-screen h-screen p-1.5 bg-transparent flex flex-col items-center justify-center font-sans select-none antialiased">
      {/* 2-COLUMN INNER CONTAINER WITH ROUNDED CORNERS */}
      <div className="w-full h-full bg-[#1A1A1A] border border-[#333333] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#EDEDEC]">
        {/* HEADER */}
        <div className="px-4 py-2.5 border-b border-[#2C2C2C] bg-[#222222] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <HardbackCascadeLogo className="w-6 h-6 drop-shadow-sm" />
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-xs text-[#EDEDEC] tracking-tight">Hardback Ingest</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  primaryJob
                    ? primaryJob.status === "paused"
                      ? "bg-[#F59E0B]"
                      : "bg-[#10B981] animate-pulse"
                    : "bg-[#10B981]"
                }`}
              />
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-[#9B9A97] font-mono ml-1">
              {(settings?.hashAlgorithm || "xxh64").toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleOpenMain}
              title="Ouvrir la fenêtre principale"
              className="p-1.5 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#2F2F2F] transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleHideMenulet}
              title="Fermer"
              className="p-1.5 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#2F2F2F] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* TOAST / ALERTS */}
        {notification && (
          <div className="px-3.5 py-1.5 bg-[#10B981]/15 border-b border-[#10B981]/30 text-[11px] text-[#34D399] flex items-center gap-1.5 animate-fadeIn shrink-0">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{notification}</span>
          </div>
        )}

        {errorMsg && (
          <div className="px-3.5 py-1.5 bg-[#EF4444]/15 border-b border-[#EF4444]/30 text-[11px] text-[#F87171] flex items-center justify-between gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="truncate">{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-[#F87171] hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* 2-COLUMN MAIN BODY */}
        <div className="flex-1 p-3 overflow-hidden grid grid-cols-2 gap-3 min-h-0">
          {/* LEFT COLUMN: ACTIVE TRANSFER OR SOURCE & DESTINATION CARDS */}
          <div className="flex flex-col justify-between space-y-2 min-h-0">
            {primaryJob ? (
              /* LIVE TRANSFER TELEMETRY */
              <div className="bg-[#222222] border border-[#333333] rounded-xl p-3 flex-1 flex flex-col justify-between space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                      primaryJob.status === "queued"
                        ? "bg-[#F59E0B]/20 text-[#FBBF24]"
                        : primaryJob.status === "paused"
                        ? "bg-[#6B7280]/20 text-[#9CA3AF]"
                        : "bg-[#10B981]/20 text-[#34D399]"
                    }`}
                  >
                    {primaryJob.status === "queued"
                      ? "En file d'attente HDD"
                      : primaryJob.status === "paused"
                      ? "En pause"
                      : primaryJob.status === "verifying"
                      ? "Vérification Bit-à-Bit"
                      : "Copie en cours"}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#EDEDEC]">
                    {primaryJob.progressPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="truncate text-[#EDEDEC] font-semibold flex items-center gap-1.5">
                    <span className="text-[#FBBF24] font-medium text-[11px]">Source :</span>
                    <span className="truncate">{primaryJob.sourceName}</span>
                  </div>
                  <div className="truncate text-[#9B9A97] text-[11px] flex items-center gap-1.5">
                    <span className="text-[#34D399] font-medium">Cible :</span>
                    <span className="truncate">{primaryJob.destinationPaths[0] || "Destination"}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-[#171717] p-2 rounded-lg border border-[#2B2B2B]">
                  <div>
                    <span className="text-[10px] text-[#9B9A97] block">Vitesse</span>
                    <span className="text-xs font-mono font-bold text-[#FBBF24]">
                      {formatSpeed(primaryJob.speedBps)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#9B9A97] block">Temps restant</span>
                    <span className="text-xs font-mono font-bold text-[#EDEDEC]">
                      {formatEta(primaryJob.etaSeconds)}
                    </span>
                  </div>
                </div>

                <div className="w-full bg-[#151515] h-2 rounded-full overflow-hidden border border-[#2B2B2B]">
                  <div
                    className="bg-gradient-to-r from-[#F59E0B] via-[#EAB308] to-[#10B981] h-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, primaryJob.progressPercent))}%` }}
                  />
                </div>

                <div className="flex items-center gap-1.5 pt-0.5">
                  {primaryJob.status === "paused" ? (
                    <button
                      onClick={() => handleResume(primaryJob.id)}
                      className="flex-1 py-1.5 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white font-semibold text-xs flex items-center justify-center gap-1 transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Reprendre</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePause(primaryJob.id)}
                      className="flex-1 py-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] border border-[#3A3A3A] text-[#EDEDEC] font-medium text-xs flex items-center justify-center gap-1 transition-colors"
                    >
                      <Pause className="w-3 h-3" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleReveal(primaryJob.destinationPaths[0])}
                    title="Afficher dans le Finder"
                    className="p-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#333333] border border-[#3A3A3A] text-[#34D399] transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleCancel(primaryJob.id)}
                    title="Annuler le transfert"
                    className="p-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#EF4444]/20 border border-[#3A3A3A] text-[#EF4444] transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              /* SOURCE & DESTINATION PICKERS */
              <div className="flex flex-col justify-between h-full space-y-2">
                {/* SOURCE CARD */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-[#FBBF24] uppercase tracking-wider">
                    <span>Source</span>
                    {sourceInspection && (
                      <button
                        onClick={() => setSourceInspection(null)}
                        className="text-[10px] text-[#888888] hover:text-[#EDEDEC] normal-case"
                      >
                        Effacer
                      </button>
                    )}
                  </div>

                  {sourceInspection ? (
                    <div
                      onClick={handlePickSource}
                      className="p-2.5 rounded-xl bg-[#202020] border border-[#F59E0B]/50 hover:border-[#F59E0B] flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors group"
                      title="Cliquer pour changer de dossier source"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-[#F59E0B]/15 text-[#FBBF24]">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#EDEDEC] truncate group-hover:text-[#FBBF24] transition-colors text-[11px]">
                            {sourceInspection.name}
                          </div>
                          <div className="text-[10px] text-[#9B9A97] font-mono">
                            {formatBytes(sourceInspection.totalBytes)} • {sourceInspection.fileCount} fichiers
                          </div>
                        </div>
                      </div>
                      <X
                        className="w-3.5 h-3.5 text-[#888888] hover:text-[#EDEDEC] shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourceInspection(null);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePickSource}
                      className="w-full p-2.5 rounded-xl border border-dashed border-[#383838] hover:border-[#F59E0B] bg-[#202020] hover:bg-[#252525] text-left transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[#282828] group-hover:bg-[#F59E0B]/20 text-[#FBBF24] transition-colors">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-[#EDEDEC] group-hover:text-[#FBBF24] transition-colors">
                            Choisir la source…
                          </div>
                          <div className="text-[10px] text-[#888888] truncate">
                            Carte SD ou dossier de rushs
                          </div>
                        </div>
                      </div>
                    </button>
                  )}
                </div>

                {/* DESTINATION CARD */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-[#34D399] uppercase tracking-wider">
                    <span>Destination</span>
                    {destInspection && (
                      <button
                        onClick={() => setDestInspection(null)}
                        className="text-[10px] text-[#888888] hover:text-[#EDEDEC] normal-case"
                      >
                        Effacer
                      </button>
                    )}
                  </div>

                  {destInspection ? (
                    <div
                      onClick={handlePickDest}
                      className="p-2.5 rounded-xl bg-[#202020] border border-[#10B981]/50 hover:border-[#10B981] flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors group"
                      title="Cliquer pour changer de dossier cible"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-[#10B981]/15 text-[#34D399]">
                          <HardDrive className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#EDEDEC] truncate group-hover:text-[#34D399] transition-colors text-[11px]">
                            {destInspection.name}
                          </div>
                          <div className="text-[10px] text-[#9B9A97] font-mono">
                            {formatBytes(destInspection.availableBytes)} disponibles
                          </div>
                        </div>
                      </div>
                      <X
                        className="w-3.5 h-3.5 text-[#888888] hover:text-[#EDEDEC] shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDestInspection(null);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePickDest}
                      className="w-full p-2.5 rounded-xl border border-dashed border-[#383838] hover:border-[#10B981] bg-[#202020] hover:bg-[#252525] text-left transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[#282828] group-hover:bg-[#10B981]/20 text-[#34D399] transition-colors">
                          <HardDrive className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold text-[#EDEDEC] group-hover:text-[#34D399] transition-colors">
                            Choisir la destination…
                          </div>
                          <div className="text-[10px] text-[#888888] truncate">
                            SSD ou disque externe
                          </div>
                        </div>
                      </div>
                    </button>
                  )}
                </div>

                {/* LAUNCH BUTTON */}
                <button
                  type="button"
                  disabled={!sourceInspection || !destInspection || isStarting}
                  onClick={handleStartTransfer}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all ${
                    sourceInspection && destInspection && !isStarting
                      ? "bg-gradient-to-r from-[#F59E0B] via-[#EAB308] to-[#10B981] hover:from-[#D97706] hover:to-[#059669] text-black shadow-lg shadow-[#F59E0B]/20 cursor-pointer active:scale-[0.99]"
                      : "bg-[#252525] text-[#555555] cursor-not-allowed border border-[#333333]"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>{isStarting ? "Démarrage…" : "Lancer le transfert vérifié"}</span>
                </button>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: DETECTED PERIPHERAL DEVICES */}
          <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-2.5 flex flex-col justify-between min-h-0">
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="text-[10px] font-semibold text-[#9B9A97] uppercase tracking-wider flex items-center justify-between shrink-0">
                <span>Supports Détectés</span>
                <span className="text-[#666666] font-normal">{devices.length}</span>
              </div>

              {devices.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center p-3 text-[11px] text-[#777777] italic">
                  Aucun support amovible branché
                </div>
              ) : (
                <div className="space-y-1.5 overflow-y-auto pr-1 flex-1 min-h-0">
                  {devices.map((dev) => {
                    const isCurrentSrc = sourceInspection?.path === dev.mountPoint;
                    const isCurrentDst = destInspection?.path === dev.mountPoint;
                    const canEject = dev.mountPoint !== "/" && dev.mountPoint.startsWith("/Volumes/");

                    return (
                      <div
                        key={dev.id}
                        className={`p-2 rounded-lg border transition-colors flex items-center justify-between gap-2 text-xs ${
                          isCurrentSrc
                            ? "bg-[#F59E0B]/15 border-[#F59E0B]/50"
                            : isCurrentDst
                            ? "bg-[#10B981]/15 border-[#10B981]/50"
                            : "bg-[#181818] border-[#2D2D2D] hover:border-[#383838]"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-[#9B9A97] shrink-0">
                            <DeviceIcon deviceType={dev.deviceType} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-[#EDEDEC] truncate text-[11px]">
                              {dev.name}
                            </div>
                            <div className="text-[9px] text-[#777777] font-mono">
                              {formatBytes(dev.availableBytes)} libres
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSetDeviceAsSource(dev)}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                              isCurrentSrc
                                ? "bg-[#F59E0B] text-black font-bold shadow-sm"
                                : "bg-[#252525] text-[#FBBF24] hover:bg-[#F59E0B]/20 border border-[#F59E0B]/30"
                            }`}
                            title="Assigner comme Source"
                          >
                            Source
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSetDeviceAsDest(dev)}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                              isCurrentDst
                                ? "bg-[#10B981] text-black font-bold shadow-sm"
                                : "bg-[#252525] text-[#34D399] hover:bg-[#10B981]/20 border border-[#10B981]/30"
                            }`}
                            title="Assigner comme Destination"
                          >
                            Dest
                          </button>

                          {canEject && (
                            <button
                              type="button"
                              onClick={(e) => handleEjectDevice(e, dev)}
                              className="p-1 rounded bg-[#252525] hover:bg-[#EF4444]/20 text-[#9B9A97] hover:text-[#F87171] border border-[#333333] hover:border-[#EF4444]/30 transition-colors"
                              title={`Éjecter ${dev.name} en toute sécurité`}
                            >
                              <EjectIcon className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[#292929] flex items-center justify-between text-[10px] text-[#777777] shrink-0">
              <span>Bit-à-Bit sécurisé</span>
              <button
                onClick={handleOpenMain}
                className="text-[#9B9A97] hover:text-[#EDEDEC] transition-colors"
              >
                Fenêtre complète →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
