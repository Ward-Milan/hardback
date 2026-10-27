import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Play,
  RotateCcw,
  FileText,
  Trash2,
  Plus,
  ShieldCheck,
  Sparkles,
  Clock,
  X,
  Pause,
  Layers,
  Film,
  Package,
  Settings,
  Zap,
  HardDrive,
  FolderTree,
  Printer,
  Search,
  Bell,
} from "lucide-react";
import {
  StorageDevice,
  PathInspection,
  TransferJobState,
  IngestHistoryEntry,
  AppSettings,
  SubfolderEntry,
  VisualCertificateData,
} from "./types";
import { HardbackCascadeLogo } from "./Logo";

/* ================= CUSTOM VISUAL STORAGE LOGOS (SD CARD, SSD, HDD, EJECT) ================= */

function SdCardLogo({ className = "w-5 h-5" }: { className?: string }) {
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

function SsdLogo({ className = "w-5 h-5" }: { className?: string }) {
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

function HddLogo({ className = "w-5 h-5" }: { className?: string }) {
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

function EjectIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 5L4.5 14H19.5L12 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 18.5H19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeviceVisualIcon({
  deviceType,
  className = "w-5 h-5",
}: {
  deviceType: string;
  className?: string;
}) {
  if (deviceType === "sd_card") return <SdCardLogo className={className} />;
  if (deviceType === "hdd") return <HddLogo className={className} />;
  if (deviceType === "package") return <Package className={className} />;
  if (deviceType === "single_file") return <Film className={className} />;
  if (deviceType === "folder") return <FolderOpen className={className} />;
  return <SsdLogo className={className} />;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 o";
  const k = 1024;
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return "0.0 Mo/s";
  const mbps = bps / (1024 * 1024);
  if (mbps >= 1024) {
    return `${(mbps / 1024).toFixed(2)} Go/s`;
  }
  return `${mbps.toFixed(1)} Mo/s`;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "Calcul…";
  if (seconds <= 0) return "Terminé";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export default function App() {
  const [devices, setDevices] = useState<StorageDevice[]>([]);
  const [selectedSources, setSelectedSources] = useState<PathInspection[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<PathInspection[]>([]);
  const [customFolderName, setCustomFolderName] = useState<string>("");

  const [transfers, setTransfers] = useState<TransferJobState[]>([]);
  const [history, setHistory] = useState<IngestHistoryEntry[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const [settings, setSettings] = useState<AppSettings>({
    smartCascading: true,
    fastInlineVerifyOnly: false,
    turboIo: true,
    ignoreJunkFiles: true,
    ignoreCameraProxies: false,
    writeReportsOnDisk: false,
    sortByMediaType: false,
    moveModeDeleteSource: false,
    autoEjectSource: false,
    soundNotification: true,
    webhookUrl: "",
    hashAlgorithm: "xxh64",
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const [subfolderModal, setSubfolderModal] = useState<{
    sourceIndex: number;
    rootPath: string;
    parentName: string;
    childrenByParent: Record<string, SubfolderEntry[]>;
    expandedPaths: string[];
    uncheckedPaths: string[];
  } | null>(null);

  const [dragHoverZone, setDragHoverZone] = useState<"source" | "destination" | null>(null);
  const [pointerDraggingDevice, setPointerDraggingDevice] = useState<{
    device: StorageDevice;
    x: number;
    y: number;
  } | null>(null);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Visual Certificate Modal state
  const [certificateModal, setCertificateModal] = useState<VisualCertificateData | null>(null);
  const [certViewMode, setCertViewMode] = useState<"visual" | "raw">("visual");
  const [certSearchQuery, setCertSearchQuery] = useState<string>("");

  const [isRefreshingDevices, setIsRefreshingDevices] = useState<boolean>(false);

  const windowWidthRef = useRef<number>(window.innerWidth);
  const internalDraggedDevicePathRef = useRef<string | null>(null);

  useEffect(() => {
    const onResize = () => {
      windowWidthRef.current = window.innerWidth;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const showToast = useCallback((msg: string) => {
    setStatusToast(msg);
    setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const refreshDevices = useCallback(async () => {
    setIsRefreshingDevices(true);
    try {
      const list = await invoke<StorageDevice[]>("get_storage_devices");
      setDevices(list);
    } catch (err) {
      console.error("Failed to list storage devices:", err);
    } finally {
      setTimeout(() => setIsRefreshingDevices(false), 250);
    }
  }, []);

  const assignSourceByPaths = useCallback(
    async (
      paths: string[],
      replaceIndex?: number,
      rootOverride?: { rootFolderPath: string; rootFolderName: string }
    ) => {
      if (!paths || paths.length === 0) return;
      setErrorBanner(null);
      try {
        const info = await invoke<PathInspection>("inspect_paths", { paths });
        if (rootOverride) {
          info.rootFolderPath = rootOverride.rootFolderPath;
          info.rootFolderName = rootOverride.rootFolderName;
          info.name = `${rootOverride.rootFolderName} (${paths.length} dossier(s))`;
          info.isDir = true;
        }
        setSelectedSources((prev) => {
          if (typeof replaceIndex === "number" && replaceIndex >= 0 && replaceIndex < prev.length) {
            const copy = [...prev];
            copy[replaceIndex] = info;
            return copy;
          }
          const key = info.rootFolderPath || info.path;
          if (prev.some((s) => (s.rootFolderPath || s.path) === key)) {
            return prev;
          }
          return [...prev, info];
        });
      } catch (err) {
        setErrorBanner(String(err));
      }
    },
    []
  );

  const addDestinationByPath = useCallback(async (path: string) => {
    if (!path) return;
    setErrorBanner(null);
    try {
      const info = await invoke<PathInspection>("inspect_path", { path });
      setSelectedDestinations((prev) => {
        if (prev.some((d) => d.path === info.path)) return prev;
        return [...prev, info];
      });
    } catch (err) {
      setErrorBanner(String(err));
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    invoke<TransferJobState[]>("get_active_transfers")
      .then(setTransfers)
      .catch(console.error);
    invoke<IngestHistoryEntry[]>("get_ingest_history")
      .then(setHistory)
      .catch(console.error);
    invoke<AppSettings>("get_app_settings")
      .then(setSettings)
      .catch(console.error);

    // Refresh immediately whenever the window regains focus
    const onFocus = () => {
      refreshDevices();
    };
    window.addEventListener("focus", onFocus);

    // Gentle 10s poll ONLY when the window is actively focused and visible to the user
    const interval = setInterval(() => {
      if (document.hasFocus() && document.visibilityState === "visible") {
        refreshDevices();
      }
    }, 10000);

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [refreshDevices]);

  useEffect(() => {
    const unlistenProgress = listen<TransferJobState>("transfer-progress", (event) => {
      const updated = event.payload;
      setTransfers((prev) => {
        const exists = prev.some((j) => j.id === updated.id);
        if (exists) {
          return prev.map((j) => (j.id === updated.id ? updated : j));
        }
        return [updated, ...prev];
      });
    });

    const unlistenHistory = listen<IngestHistoryEntry[]>("history-updated", (event) => {
      setHistory(event.payload);
    });

    const unlistenDevices = listen("devices-changed", () => {
      refreshDevices();
      showToast("Carte SD éjectée automatiquement après vérification.");
    });

    const unlistenCancelled = listen<string>("transfer-cancelled", (event) => {
      const cancelledId = event.payload;
      setTransfers((prev) => prev.filter((t) => t.id !== cancelledId));
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenHistory.then((fn) => fn());
      unlistenDevices.then((fn) => fn());
      unlistenCancelled.then((fn) => fn());
    };
  }, [refreshDevices, showToast]);

  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlistenPromise = webview.onDragDropEvent((event) => {
      const w = windowWidthRef.current || 1200;
      if (event.payload.type === "over" || event.payload.type === "enter") {
        const x = event.payload.position.x;
        if (x < w * 0.36) {
          setDragHoverZone("source");
        } else if (x > w * 0.64) {
          setDragHoverZone("destination");
        } else {
          setDragHoverZone(null);
        }
      } else if (event.payload.type === "leave") {
        setDragHoverZone(null);
      } else if (event.payload.type === "drop") {
        const x = event.payload.position.x;
        const paths = event.payload.paths;
        setDragHoverZone(null);

        if ((!paths || paths.length === 0) && internalDraggedDevicePathRef.current) {
          const internalPath = internalDraggedDevicePathRef.current;
          internalDraggedDevicePathRef.current = null;
          if (x < w * 0.45) {
            assignSourceByPaths([internalPath]);
          } else if (x > w * 0.55) {
            addDestinationByPath(internalPath);
          }
          return;
        }

        if (!paths || paths.length === 0) return;

        if (x < w * 0.48) {
          assignSourceByPaths(paths);
        } else {
          paths.forEach((p) => addDestinationByPath(p));
        }
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [assignSourceByPaths, addDestinationByPath]);

  useEffect(() => {
    if (!pointerDraggingDevice) return;

    const handlePointerMove = (e: PointerEvent) => {
      setPointerDraggingDevice((prev) =>
        prev ? { ...prev, x: e.clientX, y: e.clientY } : null
      );
      const w = window.innerWidth;
      if (e.clientX < w * 0.35) {
        setDragHoverZone("source");
      } else if (e.clientX > w * 0.65) {
        setDragHoverZone("destination");
      } else {
        setDragHoverZone(null);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      const w = window.innerWidth;
      const mountPoint = pointerDraggingDevice.device.mountPoint;
      setPointerDraggingDevice(null);
      setDragHoverZone(null);
      internalDraggedDevicePathRef.current = null;

      if (e.clientX < w * 0.35) {
        assignSourceByPaths([mountPoint]);
      } else if (e.clientX > w * 0.65) {
        addDestinationByPath(mountPoint);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [pointerDraggingDevice, assignSourceByPaths, addDestinationByPath]);

  const handleUpdateSetting = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    try {
      await invoke("update_app_settings", { settings: next });
    } catch (err) {
      console.error(err);
    }
  };

  const handleEjectDevice = async (e: React.MouseEvent, dev: StorageDevice) => {
    e.stopPropagation();
    setErrorBanner(null);
    try {
      const msg = await invoke<string>("eject_volume", { mountPoint: dev.mountPoint });
      setSelectedSources((prev) =>
        prev.filter((s) => !s.path.startsWith(dev.mountPoint))
      );
      setSelectedDestinations((prev) =>
        prev.filter((d) => !d.path.startsWith(dev.mountPoint))
      );
      await refreshDevices();
      showToast(msg);
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleRevealInFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handlePickSourceFolder = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Choisir une ou plusieurs cartes / dossiers Sources",
        defaultPath: selectedSources[0]?.path || "/Volumes",
      });
      if (Array.isArray(selected) && selected.length > 0) {
        for (const p of selected) {
          await assignSourceByPaths([p]);
        }
      } else if (typeof selected === "string" && selected) {
        await assignSourceByPaths([selected]);
      }
    } catch (err) {
      console.error("Dialog error:", err);
    }
  };

  const handlePickSourceFilesPackage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: "Sélectionner une vidéo ou plusieurs photos/fichiers (Mode Package)",
        defaultPath: selectedSources[0]?.path || "/Volumes",
      });
      if (Array.isArray(selected) && selected.length > 0) {
        await assignSourceByPaths(selected);
      } else if (typeof selected === "string" && selected) {
        await assignSourceByPaths([selected]);
      }
    } catch (err) {
      console.error("Dialog error:", err);
    }
  };

  const handleOpenIngestBrowser = async (e: React.MouseEvent, sourceIndex: number) => {
    e.stopPropagation();
    const targetSrc = selectedSources[sourceIndex];
    if (!targetSrc) return;
    const rootPath = targetSrc.rootFolderPath || targetSrc.path;
    const parentName = targetSrc.rootFolderName || targetSrc.name;
    try {
      const subs = await invoke<SubfolderEntry[]>("list_subfolders", {
        path: rootPath,
      });
      if (subs.length === 0) {
        setErrorBanner("Ce dossier ne contient aucun sous-dossier à cocher.");
        return;
      }
      setSubfolderModal({
        sourceIndex,
        rootPath,
        parentName,
        childrenByParent: { [rootPath]: subs },
        expandedPaths: [],
        uncheckedPaths: [],
      });
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleToggleExpandSubfolder = async (folderPath: string) => {
    if (!subfolderModal) return;
    const isExpanded = subfolderModal.expandedPaths.includes(folderPath);
    if (isExpanded) {
      setSubfolderModal((prev) =>
        prev
          ? {
              ...prev,
              expandedPaths: prev.expandedPaths.filter((p) => p !== folderPath),
            }
          : null
      );
      return;
    }

    let loadedChildren = subfolderModal.childrenByParent[folderPath];
    if (!loadedChildren) {
      try {
        loadedChildren = await invoke<SubfolderEntry[]>("list_subfolders", {
          path: folderPath,
        });
      } catch (err) {
        console.error(err);
        loadedChildren = [];
      }
    }

    setSubfolderModal((prev) =>
      prev
        ? {
            ...prev,
            childrenByParent: {
              ...prev.childrenByParent,
              [folderPath]: loadedChildren || [],
            },
            expandedPaths: [...prev.expandedPaths, folderPath],
          }
        : null
    );
  };

  const isSubfolderNodeChecked = (folderPath: string, uncheckedPaths: string[]): boolean => {
    return !uncheckedPaths.some(
      (u) => folderPath === u || folderPath.startsWith(u + "/")
    );
  };

  const hasUncheckedSubfolderDescendant = (
    folderPath: string,
    uncheckedPaths: string[]
  ): boolean => {
    return uncheckedPaths.some((u) => u.startsWith(folderPath + "/"));
  };

  const handleToggleCheckSubfolder = (folderPath: string, nextChecked: boolean) => {
    setSubfolderModal((prev) => {
      if (!prev) return null;
      if (!nextChecked) {
        // Uncheck this folder and clear any deeper redundant unchecked entries
        const filtered = prev.uncheckedPaths.filter(
          (u) => u !== folderPath && !u.startsWith(folderPath + "/")
        );
        return { ...prev, uncheckedPaths: [...filtered, folderPath] };
      } else {
        // Re-check this folder (and if a parent was unchecked, convert parent to partial)
        let nextUnchecked = prev.uncheckedPaths.filter(
          (u) => u !== folderPath && !u.startsWith(folderPath + "/")
        );
        // Check if an ancestor was unchecked
        const uncheckedAncestor = nextUnchecked.find((u) =>
          folderPath.startsWith(u + "/")
        );
        if (uncheckedAncestor) {
          nextUnchecked = nextUnchecked.filter((u) => u !== uncheckedAncestor);
          const siblings = prev.childrenByParent[uncheckedAncestor] || [];
          for (const sib of siblings) {
            if (sib.path !== folderPath && !folderPath.startsWith(sib.path + "/")) {
              nextUnchecked.push(sib.path);
            }
          }
        }
        return { ...prev, uncheckedPaths: nextUnchecked };
      }
    });
  };

  const computeResolvedSubfolderPaths = (
    modal: NonNullable<typeof subfolderModal>
  ): string[] => {
    const walk = (parentPath: string): string[] => {
      const children = modal.childrenByParent[parentPath] || [];
      const out: string[] = [];
      for (const child of children) {
        if (modal.uncheckedPaths.includes(child.path)) {
          continue;
        }
        const hasPartial = modal.uncheckedPaths.some((u) =>
          u.startsWith(child.path + "/")
        );
        if (hasPartial && modal.childrenByParent[child.path]) {
          out.push(...walk(child.path));
        } else {
          out.push(child.path);
        }
      }
      return out;
    };
    return walk(modal.rootPath);
  };

  const handlePickDestinationFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Choisir un ou plusieurs dossiers de Destination",
        defaultPath: "/Volumes",
      });
      if (Array.isArray(selected)) {
        for (const p of selected) {
          await addDestinationByPath(p);
        }
      } else if (typeof selected === "string" && selected) {
        await addDestinationByPath(selected);
      }
    } catch (err) {
      console.error("Dialog error:", err);
    }
  };

  const handleLaunchTransfer = async (
    customSourcePaths?: string[],
    customDestinations?: string[],
    existingJobId?: string
  ) => {
    setErrorBanner(null);
    const destPaths = customDestinations || selectedDestinations.map((d) => d.path);

    if (destPaths.length === 0) {
      setErrorBanner("Glissez ou sélectionnez au moins une destination à droite.");
      return;
    }

    // Direct re-run from History or single custom call
    if (customSourcePaths && customSourcePaths.length > 0) {
      try {
        const startedJob = await invoke<TransferJobState>("start_transfer", {
          sourcePaths: customSourcePaths,
          destinationPaths: destPaths,
          algorithm: settings.hashAlgorithm || "xxh64",
          createSubfolder: true,
          customFolderName: customFolderName.trim() ? customFolderName.trim() : null,
          existingJobId: existingJobId || null,
        });
        setTransfers((prev) => {
          const exists = prev.some((j) => j.id === startedJob.id);
          if (exists) {
            return prev.map((j) => (j.id === startedJob.id ? startedJob : j));
          }
          return [startedJob, ...prev];
        });
        setIsDrawerOpen(true);
      } catch (err) {
        setErrorBanner(String(err));
      }
      return;
    }

    if (selectedSources.length === 0) {
      setErrorBanner("Glissez ou sélectionnez au moins une source à gauche.");
      return;
    }

    try {
      for (const srcItem of selectedSources) {
        const srcPaths =
          srcItem.paths && srcItem.paths.length > 0 ? srcItem.paths : [srcItem.path];
        const folderNameForJob =
          selectedSources.length === 1 && customFolderName.trim()
            ? customFolderName.trim()
            : srcItem.rootFolderName || null;

        const startedJob = await invoke<TransferJobState>("start_transfer", {
          sourcePaths: srcPaths,
          destinationPaths: destPaths,
          algorithm: settings.hashAlgorithm || "xxh64",
          createSubfolder: true,
          customFolderName: folderNameForJob,
          existingJobId: null,
        });
        setTransfers((prev) => {
          const exists = prev.some((j) => j.id === startedJob.id);
          if (exists) {
            return prev.map((j) => (j.id === startedJob.id ? startedJob : j));
          }
          return [startedJob, ...prev];
        });
      }
      setIsDrawerOpen(true);
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handlePauseTransfer = async (jobId: string) => {
    try {
      setTransfers((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "paused",
                phaseLabel: "En pause — Prêt pour reprise immédiate",
                speedBps: 0,
                etaSeconds: null,
              }
            : j
        )
      );
      const paused = await invoke<TransferJobState>("pause_transfer", { jobId });
      setTransfers((prev) => prev.map((j) => (j.id === jobId ? paused : j)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleResumeTransferInPlace = async (jobId: string) => {
    try {
      setTransfers((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "copying",
                phaseLabel: "Reprise du transfert…",
                speedBps: 0,
                etaSeconds: null,
              }
            : j
        )
      );
      const resumed = await invoke<TransferJobState>("resume_transfer", { jobId });
      setTransfers((prev) => prev.map((j) => (j.id === jobId ? resumed : j)));
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleDismissTransfer = async (jobId: string) => {
    try {
      const remaining = await invoke<TransferJobState[]>("dismiss_transfer", { jobId });
      setTransfers(remaining);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelAndRemoveTransfer = async (jobId: string) => {
    try {
      const remaining = await invoke<TransferJobState[]>("cancel_transfer", { jobId });
      setTransfers(remaining);
      const updatedHist = await invoke<IngestHistoryEntry[]>("get_ingest_history");
      setHistory(updatedHist);
      showToast("Transfert annulé — fichiers incomplets supprimés de la destination.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCertificate = async (reportPath: string) => {
    try {
      const cert = await invoke<VisualCertificateData>("read_visual_certificate", {
        path: reportPath,
      });
      setCertViewMode("visual");
      setCertSearchQuery("");
      setCertificateModal(cert);
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleExportCertificatePdf = async () => {
    if (!certificateModal) return;
    try {
      const defaultName = `Certificat_Hardback_${certificateModal.jobId.slice(0, 8)}.pdf`;
      const savePath = await save({
        title: "Exporter le Certificat d'Intégrité en PDF",
        defaultPath: defaultName,
        filters: [{ name: "Document PDF", extensions: ["pdf"] }],
      });
      if (!savePath) return;
      await invoke<string>("export_certificate_to_pdf", {
        cert: certificateModal,
        outputPath: savePath,
      });
      showToast("Certificat PDF exporté et ouvert dans Aperçu !");
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      const updated = await invoke<IngestHistoryEntry[]>("remove_history_item", { id });
      setHistory(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLoadDemoEnvironment = async () => {
    setErrorBanner(null);
    try {
      const [demoSrc, demoDst] = await invoke<[PathInspection, PathInspection]>(
        "create_demo_environment"
      );
      setSelectedSources([demoSrc]);
      setSelectedDestinations([demoDst]);
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const activeRunningJobs = transfers.filter(
    (t) => t.status === "scanning" || t.status === "copying" || t.status === "verifying"
  );
  const activeRunningCount = activeRunningJobs.length;
  const primaryActiveJob = activeRunningJobs[0] || transfers[0] || null;

  const filteredCertRecords = certificateModal
    ? certificateModal.records.filter(
        (r) =>
          !certSearchQuery.trim() ||
          r.relativePath.toLowerCase().includes(certSearchQuery.toLowerCase()) ||
          r.sourceHash.toLowerCase().includes(certSearchQuery.toLowerCase())
      )
    : [];

  return (
    <div className="relative h-screen w-screen flex flex-col bg-[#191919] text-[#EDEDEC] overflow-hidden select-none">
      {/* Floating Ghost Card during Pointer Drag of a Storage Device */}
      {pointerDraggingDevice && (
        <div
          style={{
            left: pointerDraggingDevice.x + 14,
            top: pointerDraggingDevice.y - 20,
          }}
          className="fixed z-50 pointer-events-none bg-[#252525] border border-[#3B82F6] text-[#EDEDEC] px-3.5 py-2 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-medium"
        >
          <DeviceVisualIcon
            deviceType={pointerDraggingDevice.device.deviceType}
            className="w-4 h-4 text-[#3B82F6]"
          />
          <span>{pointerDraggingDevice.device.name}</span>
          <span className="text-[10px] text-[#9B9A97] font-mono">
            ({pointerDraggingDevice.device.protocolLabel})
          </span>
        </div>
      )}

      {/* Top Toast Notification */}
      {statusToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#10B981] text-[#191919] font-semibold text-xs shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{statusToast}</span>
        </div>
      )}

      {/* Top Minimalist Header */}
      <header className="h-13 px-6 border-b border-[#2A2A2A] flex items-center justify-between bg-[#191919] shrink-0 z-10 py-3">
        <div className="flex items-center gap-3">
          <HardbackCascadeLogo className="w-8 h-8 drop-shadow-md transition-transform hover:scale-105" />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-[#EDEDEC]">
              Hardback
            </span>
            <span className="text-xs text-[#888888] hidden sm:inline flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#10B981]"></span>
              Double Flux Certifié
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadDemoEnvironment}
            className="flex items-center gap-1.5 text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] px-3 py-1.5 rounded-lg transition-colors"
            title="Générer une carte SD virtuelle de test avec des rushes"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#3B82F6]" />
            <span>Carte SD Démo</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] px-3 py-1.5 rounded-lg transition-colors"
            title="Ouvrir les paramètres de vitesse et de stockage"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Paramètres</span>
          </button>
        </div>
      </header>

      {/* Error Notification Banner */}
      {errorBanner && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#EF4444]" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="hover:bg-[#EF4444]/20 p-1 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace: 3-Column Offload Studio + Bottom History */}
      <main className="flex-1 flex flex-col min-h-0 px-6 pt-4 pb-14 gap-4 overflow-hidden">
        <div className="flex-1 grid grid-cols-12 gap-5 min-h-0">
          {/* ================= LEFT COLUMN: SOURCE DROPZONE(S) ================= */}
          <section className="col-span-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B] shadow-sm shadow-[#F59E0B]/50" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#FBBF24]">
                  Source(s) ({selectedSources.length})
                </h2>
              </div>
              {selectedSources.length > 0 && (
                <button
                  onClick={() => setSelectedSources([])}
                  className="text-[11px] text-[#9B9A97] hover:text-[#EF4444] transition-colors"
                >
                  Tout vider
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragHoverZone("source");
              }}
              onDragLeave={() => setDragHoverZone(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragHoverZone(null);
                const internalPath =
                  e.dataTransfer.getData("text/hardback-path") ||
                  internalDraggedDevicePathRef.current;
                internalDraggedDevicePathRef.current = null;
                if (internalPath) {
                  assignSourceByPaths([internalPath]);
                }
              }}
              onClick={handlePickSourceFolder}
              className={`flex-1 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between p-5 relative group overflow-hidden ${
                dragHoverZone === "source"
                  ? "border-2 border-[#3B82F6] bg-[#3B82F6]/10 shadow-[0_0_25px_rgba(59,130,246,0.15)]"
                  : selectedSources.length > 0
                  ? "border-[#2F2F2F] bg-[#202020] hover:border-[#3E3E3E]"
                  : "border-dashed border-[#333333] bg-[#202020]/60 hover:bg-[#222222] hover:border-[#4A4A4A]"
              }`}
            >
              {selectedSources.length === 0 ? (
                <div className="my-auto flex flex-col items-center text-center px-3">
                  <div className="w-13 h-13 p-3.5 rounded-2xl bg-[#262626] border border-[#333333] shadow-sm flex items-center justify-center mb-3.5 group-hover:scale-105 transition-transform text-[#EDEDEC]">
                    <SdCardLogo className="w-6 h-6 text-[#3B82F6]" />
                  </div>
                  <p className="text-sm font-medium text-[#EDEDEC] mb-1">
                    Glissez une ou plusieurs sources ici
                  </p>
                  <p className="text-xs text-[#9B9A97] max-w-[250px] leading-relaxed mb-4">
                    Déposez vos cartes SD depuis le centre, des dossiers du Finder, ou sélectionnez :
                  </p>

                  <div className="flex items-center gap-2 w-full justify-center">
                    <button
                      type="button"
                      onClick={handlePickSourceFolder}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] border border-[#383838] text-xs font-medium text-[#EDEDEC] transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-[#3B82F6]" />
                      <span>Dossier / Carte</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePickSourceFilesPackage}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] border border-[#383838] text-xs font-medium text-[#EDEDEC] transition-colors"
                    >
                      <Package className="w-3.5 h-3.5 text-[#F59E0B]" />
                      <span>Photos / Vidéo</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-full justify-between min-h-0">
                  <div className="space-y-2.5 overflow-y-auto pr-1">
                    {selectedSources.map((src, srcIdx) => (
                      <div
                        key={src.rootFolderPath || src.path}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[#191919] border border-[#2F2F2F] rounded-xl p-3 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                                src.isPackage && !src.rootFolderPath
                                  ? "bg-[#F59E0B]/15 border-[#F59E0B]/30 text-[#F59E0B]"
                                  : "bg-[#3B82F6]/15 border-[#3B82F6]/30 text-[#3B82F6]"
                              }`}
                            >
                              <DeviceVisualIcon
                                deviceType={src.deviceType}
                                className="w-4 h-4"
                              />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-semibold text-xs text-[#EDEDEC] truncate">
                                {src.name}
                              </h3>
                              <p className="text-[11px] text-[#9B9A97] truncate max-w-[195px]">
                                <span className="font-mono text-[#EDEDEC]">
                                  {formatBytes(src.totalBytes)}
                                </span>{" "}
                                • {src.summaryLabel || `${src.fileCount} fichier(s)`}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setSelectedSources((prev) =>
                                prev.filter((_, idx) => idx !== srcIdx)
                              )
                            }
                            className="p-1 text-[#6B6B68] hover:text-[#EF4444] rounded transition-colors shrink-0"
                            title="Retirer cette source"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {(src.isDir || src.rootFolderPath) && (
                          <button
                            type="button"
                            onClick={(e) => handleOpenIngestBrowser(e, srcIdx)}
                            className="w-full py-1.5 px-2.5 rounded-lg bg-[#222222] hover:bg-[#2A2A2A] border border-[#2F2F2F] text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <FolderTree className="w-3.5 h-3.5 text-[#60A5FA]" />
                            <span>Choisir les sous-dossiers…</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-3 border-t border-[#2F2F2F] flex items-center justify-between gap-2 text-xs shrink-0"
                  >
                    <button
                      type="button"
                      onClick={handlePickSourceFolder}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#262626] hover:bg-[#2F2F2F] border border-[#333333] text-[#EDEDEC] font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#3B82F6]" />
                      <span>Dossier / Carte</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePickSourceFilesPackage}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#262626] hover:bg-[#2F2F2F] border border-[#333333] text-[#EDEDEC] font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Package className="w-3.5 h-3.5 text-[#F59E0B]" />
                      <span>Photos / Vidéo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ================= CENTER COLUMN: DETECTED DEVICES & LAUNCHER ================= */}
          <section className="col-span-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
                Supports Détectés
              </h2>
              <button
                onClick={refreshDevices}
                className="text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1 transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isRefreshingDevices ? "animate-spin" : ""}`}
                />
                <span>Actualiser</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0">
              {devices.map((dev) => {
                const usedRatio =
                  dev.totalBytes > 0
                    ? Math.min(100, Math.round((dev.usedBytes / dev.totalBytes) * 100))
                    : 0;
                const isCard = dev.deviceType === "sd_card";
                const isHdd = dev.deviceType === "hdd";
                const isExternalSsd = dev.deviceType === "ssd";
                const canEject = dev.mountPoint !== "/" && dev.mountPoint.startsWith("/Volumes/");

                return (
                  <div
                    key={dev.id}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      internalDraggedDevicePathRef.current = dev.mountPoint;
                      setPointerDraggingDevice({
                        device: dev,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    className="group bg-[#202020] hover:bg-[#262626] border border-[#2F2F2F] hover:border-[#3E3E3E] rounded-xl p-3.5 transition-all cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                            isCard
                              ? "bg-[#F59E0B]/15 border-[#F59E0B]/30 text-[#F59E0B]"
                              : isExternalSsd
                              ? "bg-[#3B82F6]/15 border-[#3B82F6]/30 text-[#60A5FA]"
                              : isHdd
                              ? "bg-[#10B981]/15 border-[#10B981]/30 text-[#34D399]"
                              : "bg-[#2A2A2A] border-[#383838] text-[#EDEDEC]"
                          }`}
                          title={dev.protocolLabel}
                        >
                          <DeviceVisualIcon deviceType={dev.deviceType} className="w-5 h-5" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs text-[#EDEDEC] truncate">
                              {dev.name}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.2 rounded border ${
                                isCard
                                  ? "bg-[#F59E0B]/10 border-[#F59E0B]/25 text-[#FBBF24]"
                                  : isExternalSsd
                                  ? "bg-[#3B82F6]/10 border-[#3B82F6]/25 text-[#93C5FD]"
                                  : isHdd
                                  ? "bg-[#10B981]/10 border-[#10B981]/25 text-[#6EE7B7]"
                                  : "bg-[#2A2A2A] border-[#383838] text-[#9B9A97]"
                              }`}
                            >
                              {dev.protocolLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#9B9A97] truncate mt-0.5">
                            {formatBytes(dev.availableBytes)} libres sur{" "}
                            {formatBytes(dev.totalBytes)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => assignSourceByPaths([dev.mountPoint])}
                          className="text-[11px] px-2 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#F59E0B] hover:text-black border border-[#383838] text-[#FBBF24] transition-colors font-medium"
                        >
                          ← Source
                        </button>
                        <button
                          type="button"
                          onClick={() => addDestinationByPath(dev.mountPoint)}
                          className="text-[11px] px-2 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#10B981] hover:text-black border border-[#383838] text-[#34D399] transition-colors font-medium"
                        >
                          Dest →
                        </button>
                        {canEject && (
                          <button
                            type="button"
                            onClick={(e) => handleEjectDevice(e, dev)}
                            className="p-1.5 rounded-lg bg-[#2A2A2A] hover:bg-[#F59E0B]/20 hover:text-[#FBBF24] border border-[#383838] text-[#9B9A97] transition-colors"
                            title={`Éjecter ${dev.name} en toute sécurité`}
                          >
                            <EjectIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5 h-1.5 w-full bg-[#141414] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          usedRatio > 90
                            ? "bg-[#EF4444]"
                            : isCard
                            ? "bg-[#F59E0B]"
                            : isExternalSsd
                            ? "bg-[#3B82F6]"
                            : "bg-[#9B9A97]"
                        }`}
                        style={{ width: `${usedRatio}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 pt-3 border-t border-[#2A2A2A] flex flex-col gap-2">
              <input
                type="text"
                value={customFolderName}
                onChange={(e) => setCustomFolderName(e.target.value)}
                placeholder="Nom du dossier créé (optionnel, ex: Shooting_CamA)"
                className="w-full px-3 py-2 rounded-xl bg-[#202020] border border-[#2F2F2F] focus:border-[#3B82F6] focus:outline-none text-xs text-[#EDEDEC] placeholder-[#6B6B68]"
              />

              <button
                onClick={() => handleLaunchTransfer()}
                disabled={selectedSources.length === 0 || selectedDestinations.length === 0}
                className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md ${
                  selectedSources.length > 0 && selectedDestinations.length > 0
                    ? "bg-gradient-to-r from-[#F59E0B] via-[#EAB308] to-[#10B981] hover:from-[#D97706] hover:to-[#059669] text-black shadow-lg shadow-[#F59E0B]/20 cursor-pointer active:scale-[0.99]"
                    : "bg-[#222222] text-[#5A5A58] border border-[#2F2F2F] cursor-not-allowed"
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  Lancer le Transfert
                  {selectedSources.length > 1 ? ` (${selectedSources.length} sources)` : ""}
                </span>
                {selectedDestinations.length > 1 && (
                  <span className="text-[11px] bg-black/20 text-black px-1.5 py-0.5 rounded font-mono font-bold">
                    ×{selectedDestinations.length}
                  </span>
                )}
              </button>
            </div>
          </section>

          {/* ================= RIGHT COLUMN: DESTINATION DROPZONE(S) ================= */}
          <section className="col-span-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
                  Destination(s) ({selectedDestinations.length})
                </h2>
              </div>
              {selectedDestinations.length > 0 && (
                <button
                  onClick={() => setSelectedDestinations([])}
                  className="text-[11px] text-[#9B9A97] hover:text-[#EF4444] transition-colors"
                >
                  Tout vider
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragHoverZone("destination");
              }}
              onDragLeave={() => setDragHoverZone(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragHoverZone(null);
                const internalPath =
                  e.dataTransfer.getData("text/hardback-path") ||
                  internalDraggedDevicePathRef.current;
                internalDraggedDevicePathRef.current = null;
                if (internalPath) {
                  addDestinationByPath(internalPath);
                }
              }}
              onClick={handlePickDestinationFolder}
              className={`flex-1 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between p-5 relative group overflow-hidden ${
                dragHoverZone === "destination"
                  ? "border-2 border-[#10B981] bg-[#10B981]/10 shadow-[0_0_25px_rgba(16,185,129,0.15)]"
                  : selectedDestinations.length > 0
                  ? "border-[#2F2F2F] bg-[#202020] hover:border-[#3E3E3E]"
                  : "border-dashed border-[#333333] bg-[#202020]/60 hover:bg-[#222222] hover:border-[#4A4A4A]"
              }`}
            >
              {selectedDestinations.length === 0 ? (
                <div className="my-auto flex flex-col items-center text-center px-4">
                  <div className="w-13 h-13 p-3.5 rounded-2xl bg-[#262626] border border-[#333333] shadow-sm flex items-center justify-center mb-3.5 group-hover:scale-105 transition-transform">
                    <SsdLogo className="w-6 h-6 text-[#10B981]" />
                  </div>
                  <p className="text-sm font-medium text-[#EDEDEC] mb-1">
                    Glissez une destination ici ou cliquez
                  </p>
                  <p className="text-xs text-[#9B9A97] max-w-[240px] leading-relaxed">
                    Ajoutez un ou plusieurs disques pour sauvegarder vos fichiers simultanément.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col h-full justify-between min-h-0">
                  <div className="space-y-2 overflow-y-auto pr-1">
                    {selectedDestinations.map((dest, idx) => {
                      const totalSourcesBytes = selectedSources.reduce(
                        (sum, s) => sum + s.totalBytes,
                        0
                      );
                      const enoughSpace =
                        selectedSources.length === 0 || dest.availableBytes >= totalSourcesBytes;
                      return (
                        <div
                          key={dest.path}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-[#191919] border border-[#2F2F2F] rounded-xl p-3 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-[#10B981]/15 border border-[#10B981]/30 text-[#34D399] flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                              D{idx + 1}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#EDEDEC] truncate">
                                {dest.name}
                              </p>
                              <p className="text-[11px] font-mono text-[#9B9A97] truncate max-w-[190px]">
                                {dest.path}
                              </p>
                              <p
                                className={`text-[10px] mt-0.5 ${
                                  enoughSpace ? "text-[#34D399]" : "text-[#EF4444] font-semibold"
                                }`}
                              >
                                {formatBytes(dest.availableBytes)} libres
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() =>
                              setSelectedDestinations((prev) =>
                                prev.filter((d) => d.path !== dest.path)
                              )
                            }
                            className="p-1.5 text-[#9B9A97] hover:text-[#EF4444] rounded-lg hover:bg-[#262626]"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-[#2F2F2F] flex items-center justify-between text-xs text-[#9B9A97] shrink-0">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[#10B981]" />
                      Sauvegarde sécurisée active
                    </span>
                    <span className="font-medium text-[#34D399] flex items-center gap-1 group-hover:underline">
                      <Plus className="w-3.5 h-3.5" /> Ajouter un disque
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ================= BOTTOM SECTION: INGEST HISTORY & 1-CLICK RE-RUN ================= */}
        <section className="h-44 shrink-0 border border-[#2F2F2F] rounded-2xl bg-[#202020] flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#2F2F2F] bg-[#242424] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-[#9B9A97]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
                Historique des Transferts
              </h3>
              <span className="text-[11px] text-[#6B6B68] font-mono">({history.length})</span>
            </div>
            <span className="text-[11px] text-[#9B9A97]">
              Relancez un transfert récent avec les mêmes sources & destinations en un clic
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#2A2A2A]">
            {history.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[#6B6B68]">
                Aucun transfert dans l'historique pour le moment.
              </div>
            ) : (
              history.map((item) => {
                const isCompleted = item.status === "completed";
                return (
                  <div
                    key={item.id}
                    className="px-4 py-2.5 hover:bg-[#262626] transition-colors flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
                      )}

                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-[#EDEDEC] truncate max-w-[170px]">
                          {item.sourceName}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#6B6B68] shrink-0" />
                        <span className="text-[#9B9A97] truncate max-w-[260px] font-mono text-[11px]">
                          {item.destinationPaths.join(" + ")}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-[#9B9A97] font-mono">
                        {formatBytes(item.totalBytes)} • {item.verifiedFiles}/{item.totalFiles} fichiers
                      </span>

                      {item.destinationPaths.length > 0 && (
                        <button
                          onClick={() => handleRevealInFinder(item.destinationPaths[0])}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#383838] bg-[#262626] hover:bg-[#323232] text-[#EDEDEC] font-medium transition-colors"
                          title="Ouvrir le dossier de destination dans le Finder"
                        >
                          <FolderOpen className="w-3 h-3 text-[#34D399]" />
                          <span>Finder</span>
                        </button>
                      )}

                      {item.reportPaths && item.reportPaths.length > 0 && (
                        <button
                          onClick={() => handleOpenCertificate(item.reportPaths[0])}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#383838] bg-[#262626] hover:bg-[#323232] text-[#EDEDEC] font-medium transition-colors"
                        >
                          <FileText className="w-3 h-3 text-[#60A5FA]" />
                          <span>Certificat</span>
                        </button>
                      )}

                      <button
                        onClick={async () => {
                          const srcList =
                            item.sourcePaths && item.sourcePaths.length > 0
                              ? item.sourcePaths
                              : [item.sourcePath];
                          await assignSourceByPaths(srcList);
                          setSelectedDestinations([]);
                          for (const d of item.destinationPaths) {
                            await addDestinationByPath(d);
                          }
                          await handleLaunchTransfer(
                            srcList,
                            item.destinationPaths,
                            item.status !== "completed" ? item.id : undefined
                          );
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EDEDEC] text-[#191919] hover:bg-white font-semibold transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Relancer</span>
                      </button>

                      <button
                        onClick={() => handleDeleteHistory(item.id)}
                        className="p-1 text-[#6B6B68] hover:text-[#EF4444] rounded"
                        title="Supprimer de l'historique"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      {/* ================= BOTTOM-CENTER BUTTON TO OPEN TRANSFER DRAWER (WHEN CLOSED) ================= */}
      {!isDrawerOpen && (
        <button
          onClick={() => setIsDrawerOpen(true)}
          className={`fixed bottom-2.5 left-1/2 -translate-x-1/2 z-20 px-5 py-1.5 rounded-full border shadow-xl flex items-center gap-2 text-xs font-semibold transition-all hover:scale-105 active:scale-95 ${
            activeRunningCount > 0
              ? "bg-[#2383E2] text-white border-[#60A5FA]/40"
              : "bg-[#262626] hover:bg-[#303030] text-[#EDEDEC] border-[#383838]"
          }`}
          title="Ouvrir la page des transferts"
        >
          <ChevronUp className="w-4 h-4" />
          <span>Transferts ({transfers.length})</span>
          {primaryActiveJob && activeRunningCount > 0 && (
            <span className="font-mono text-[11px] bg-black/25 px-2 py-0.5 rounded-full">
              {primaryActiveJob.progressPercent.toFixed(0)}% •{" "}
              {formatSpeed(primaryActiveJob.speedBps)}
            </span>
          )}
        </button>
      )}

      {/* ================= SLIDING BOTTOM PAGE (TRANSFER DRAWER) ================= */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 bg-[#1C1C1C] border-t border-[#2F2F2F] shadow-[0_-16px_48px_rgba(0,0,0,0.65)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col ${
          isDrawerOpen ? "translate-y-0 h-[88vh]" : "translate-y-full h-[88vh]"
        }`}
      >
        <div className="pt-3 pb-2.5 px-6 border-b border-[#2A2A2A] flex items-center justify-between relative bg-[#222222]">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#10B981]" />
            <span className="font-semibold text-sm text-[#EDEDEC]">
              Transferts en cours
            </span>
          </div>

          <button
            onClick={() => setIsDrawerOpen(false)}
            className="absolute left-1/2 -translate-x-1/2 top-2 px-5 py-1.5 rounded-full bg-[#2A2A2A] hover:bg-[#333333] border border-[#3E3E3E] shadow-sm flex items-center gap-1.5 text-xs font-semibold text-[#EDEDEC] transition-all hover:scale-105 active:scale-95"
          >
            <ChevronDown className="w-4 h-4 text-[#EDEDEC]" />
            <span>Réduire</span>
          </button>

          <div className="text-xs text-[#9B9A97]">
            {activeRunningCount > 0
              ? `${activeRunningCount} transfert(s) actif(s)`
              : `${transfers.length} transfert(s)`}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#191919]">
          {transfers.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-[#6B6B68] text-sm">
              Aucun transfert actif dans cette session.
            </div>
          ) : (
            transfers.map((job) => {
              const isQueued = job.status === "queued";
              const isRunning =
                job.status === "scanning" ||
                job.status === "copying" ||
                job.status === "verifying";
              const isPaused = job.status === "paused";
              const isDone = job.status === "completed";
              const isFailed = job.status === "failed";

              return (
                <div
                  key={job.id}
                  className="border border-[#2F2F2F] rounded-2xl p-5 bg-[#202020] shadow-sm space-y-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide ${
                            isDone
                              ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                              : isPaused
                              ? "bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30"
                              : isQueued
                              ? "bg-[#8B5CF6]/15 text-[#A78BFA] border border-[#8B5CF6]/30 animate-pulse-subtle"
                              : isFailed
                              ? "bg-[#EF4444]/15 text-[#F87171] border border-[#EF4444]/30"
                              : "bg-[#3B82F6]/15 text-[#60A5FA] border border-[#3B82F6]/30 animate-pulse-subtle"
                          }`}
                        >
                          {job.status === "copying"
                            ? "Copie en cours"
                            : job.status === "verifying"
                            ? "Vérification"
                            : job.status === "completed"
                            ? "Terminé & Vérifié"
                            : job.status === "paused"
                            ? "En Pause"
                            : job.status === "queued"
                            ? "En file d'attente (Disque occupé)"
                            : job.status === "scanning"
                            ? "Préparation"
                            : "Erreur"}
                        </span>
                        <h3 className="font-semibold text-base text-[#EDEDEC] truncate">
                          {job.sourceName}
                        </h3>
                        <ArrowRight className="w-4 h-4 text-[#6B6B68] shrink-0" />
                        <span className="text-xs font-mono text-[#9B9A97] truncate">
                          {job.destinationPaths.join(" , ")}
                        </span>
                      </div>
                      <p className="text-xs text-[#9B9A97] truncate">
                        {job.phaseLabel}
                        {job.currentFile ? ` — ${job.currentFile}` : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isRunning && (
                        <button
                          onClick={() => handlePauseTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#F59E0B]/15 hover:text-[#FBBF24] hover:border-[#F59E0B]/40 text-xs font-medium text-[#EDEDEC] transition-colors"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </button>
                      )}

                      {(isPaused || isFailed) && (
                        <button
                          onClick={() => handleResumeTransferInPlace(job.id)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold transition-colors shadow-sm"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Reprendre</span>
                        </button>
                      )}

                      {isDone && job.destinationPaths.length > 0 && (
                        <button
                          onClick={() => handleRevealInFinder(job.destinationPaths[0])}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC]"
                          title="Ouvrir le dossier dans le Finder macOS"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#34D399]" />
                          <span>Ouvrir dans le Finder</span>
                        </button>
                      )}

                      {isDone && job.reportPaths.length > 0 && (
                        <button
                          onClick={() => handleOpenCertificate(job.reportPaths[0])}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC]"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#60A5FA]" />
                          <span>Certificat</span>
                        </button>
                      )}

                      {isDone ? (
                        <button
                          onClick={() => handleDismissTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#333333] hover:text-[#EDEDEC] text-xs font-medium text-[#9B9A97] transition-colors"
                          title="Fermer cette carte de la liste des transferts actifs"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Fermer</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCancelAndRemoveTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#EF4444]/20 hover:text-[#F87171] hover:border-[#EF4444]/40 text-xs font-medium text-[#9B9A97] transition-colors"
                          title="Annuler le transfert et nettoyer les fichiers incomplets sur la destination"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Annuler</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="h-3 w-full bg-[#141414] border border-[#2A2A2A] rounded-full overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${
                          isDone
                            ? "bg-[#10B981]"
                            : isPaused
                            ? "bg-[#F59E0B]"
                            : isFailed
                            ? "bg-[#EF4444]"
                            : "bg-gradient-to-r from-[#F59E0B] via-[#EAB308] to-[#10B981]"
                        }`}
                        style={{ width: `${Math.max(2, job.progressPercent)}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 pt-1">
                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">Progression</span>
                      <span className="text-lg font-semibold font-mono text-[#EDEDEC]">
                        {job.progressPercent.toFixed(1)}%
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">Vitesse</span>
                      <span className="text-lg font-semibold font-mono text-[#60A5FA]">
                        {isPaused ? "En pause" : isQueued ? "En attente" : formatSpeed(job.speedBps)}
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">Temps restant</span>
                      <span className="text-lg font-semibold font-mono text-[#EDEDEC]">
                        {isDone ? "0s" : isPaused ? "—" : isQueued ? "En file" : formatEta(job.etaSeconds)}
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">Fichiers vérifiés</span>
                      <span className="text-lg font-semibold font-mono text-[#34D399]">
                        {job.verifiedFiles} / {job.totalFiles}
                      </span>
                    </div>
                  </div>

                  {job.corruptedVideos && job.corruptedVideos.length > 0 && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#FBBF24]">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F59E0B]" />
                      <div className="space-y-1">
                        <span className="font-semibold text-white">
                          Alerte Intégrité Vidéo ({job.corruptedVideos.length} rush(s) non finalisé(s) ou endommagé(s) détecté(s)) :
                        </span>
                        <p className="text-[11px] text-[#D1D5DB]">
                          Attention : la caméra s'est éteinte ou a été coupée avant la finalisation du conteneur (atome MOOV manquant). Ne formatez pas la carte avant vérification en montage :
                        </p>
                        <ul className="list-disc list-inside space-y-0.5 text-[11px] font-mono text-[#FCD34D]">
                          {job.corruptedVideos.map((v, idx) => (
                            <li key={idx}>{v}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {job.errorMessage && (
                    <div className="text-xs text-[#FCA5A5] bg-[#EF4444]/15 border border-[#EF4444]/30 rounded-xl px-3.5 py-2.5">
                      {job.errorMessage}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= SIMPLE SETTINGS MODAL (SPEED, STORAGE & COMFORT) ================= */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#202020] border border-[#333333] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#2F2F2F] flex items-center justify-between bg-[#252525]">
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4 text-[#EDEDEC]" />
                <span className="font-semibold text-sm text-[#EDEDEC]">
                  Paramètres — Vitesse, Stockage & Confort
                </span>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-lg hover:bg-[#333333] text-[#9B9A97] hover:text-[#EDEDEC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* SPEED SECTION */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#60A5FA] font-semibold uppercase tracking-wider text-[11px]">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Options de Vitesse & Moteur de Vérification</span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] space-y-3">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>Moteur mathématique d'empreinte (Hash)</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#3B82F6]/15 text-[#60A5FA] font-medium uppercase tracking-wide">
                          {(settings.hashAlgorithm || "xxh64").toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <p className="text-[#9B9A97] mt-1 leading-relaxed">
                      Sélectionnez l'algorithme de certification bit-à-bit utilisé pour vérifier les copies et générer les manifestes MHL / ASC-MHL.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleUpdateSetting("hashAlgorithm", "xxh64")}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        (settings.hashAlgorithm || "xxh64") === "xxh64"
                          ? "bg-[#3B82F6]/15 border-[#3B82F6] text-white shadow-sm"
                          : "bg-[#222222] border-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] hover:border-[#444444]"
                      }`}
                      title="xxHash 64-bit : Algorithme ultra-rapide recommandé par défaut"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#EDEDEC]">XXH64</span>
                        {(settings.hashAlgorithm || "xxh64") === "xxh64" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                        )}
                      </div>
                      <div className="text-[10px] text-[#60A5FA] font-medium mt-0.5">Défaut (Rapide)</div>
                      <div className="text-[9px] text-[#888888] mt-1 leading-tight">Recommandé</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleUpdateSetting("hashAlgorithm", "xxh3")}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.hashAlgorithm === "xxh3"
                          ? "bg-[#3B82F6]/15 border-[#3B82F6] text-white shadow-sm"
                          : "bg-[#222222] border-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] hover:border-[#444444]"
                      }`}
                      title="xxHash 3 : Performance maximale avec instructions vectorisées SIMD"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#EDEDEC]">XXH3</span>
                        {settings.hashAlgorithm === "xxh3" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                        )}
                      </div>
                      <div className="text-[10px] text-[#34D399] font-medium mt-0.5">Turbo CPU</div>
                      <div className="text-[9px] text-[#888888] mt-1 leading-tight">Vectorisé Apple Sil.</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleUpdateSetting("hashAlgorithm", "md5")}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.hashAlgorithm === "md5"
                          ? "bg-[#3B82F6]/15 border-[#3B82F6] text-white shadow-sm"
                          : "bg-[#222222] border-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] hover:border-[#444444]"
                      }`}
                      title="MD5 : Standard contractuel exigé en régie broadcast, TV et PAD"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#EDEDEC]">MD5</span>
                        {settings.hashAlgorithm === "md5" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                        )}
                      </div>
                      <div className="text-[10px] text-[#F59E0B] font-medium mt-0.5">Broadcast</div>
                      <div className="text-[9px] text-[#888888] mt-1 leading-tight">Norme TV & PAD</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleUpdateSetting("hashAlgorithm", "sha256")}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.hashAlgorithm === "sha256"
                          ? "bg-[#3B82F6]/15 border-[#3B82F6] text-white shadow-sm"
                          : "bg-[#222222] border-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] hover:border-[#444444]"
                      }`}
                      title="SHA-256 : Standard cryptographique haute sécurité pour Netflix, longs-métrages et archives"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-[#EDEDEC]">SHA-256</span>
                        {settings.hashAlgorithm === "sha256" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                        )}
                      </div>
                      <div className="text-[10px] text-[#A78BFA] font-medium mt-0.5">Cinéma</div>
                      <div className="text-[9px] text-[#888888] mt-1 leading-tight">Norme Netflix / Longs</div>
                    </button>
                  </div>
                </div>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                      <span>Boost Thunderbolt / SSD</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/15 text-[#60A5FA]">
                        Recommandé
                      </span>
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Traite jusqu'à 16 fichiers simultanément en mémoire vive pour accélérer les
                      dossiers contenant des milliers de fichiers.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.turboIo}
                    onChange={(e) => handleUpdateSetting("turboIo", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                      <span>Priorité aux disques rapides (Cascade)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/15 text-[#60A5FA]">
                        +Vitesse Carte SD
                      </span>
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Si vous copiez vers plusieurs disques, copie d'abord à vitesse maximale sur le
                      premier disque pour libérer votre carte plus vite, puis vers les suivants.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.smartCascading}
                    onChange={(e) => handleUpdateSetting("smartCascading", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                      <span>Vérification rapide (Sans relecture du disque cible)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#FBBF24]">
                        Vitesse ×2
                      </span>
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Vérifie les fichiers pendant la lecture uniquement, sans relire le disque de
                      destination après écriture.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.fastInlineVerifyOnly}
                    onChange={(e) => handleUpdateSetting("fastInlineVerifyOnly", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                  />
                </label>
              </div>

              {/* COMFORT & AUTOMATION SECTION */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#FBBF24] font-semibold uppercase tracking-wider text-[11px]">
                  <Bell className="w-3.5 h-3.5" />
                  <span>Confort & Automatisation</span>
                </div>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC]">
                      Éjecter automatiquement la carte SD en fin de transfert
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Démonte proprement la carte SD dès que 100 % des fichiers sont copiés et
                      certifiés, pour que vous puissiez la retirer immédiatement.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoEjectSource}
                    onChange={(e) => handleUpdateSetting("autoEjectSource", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC]">
                      Notifications bannières macOS & alerte sonore en fin de transfert
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Affiche une bannière système macOS en haut à droite et joue un son discret
                      lorsqu'un transfert se termine en arrière-plan.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.soundNotification}
                    onChange={(e) => handleUpdateSetting("soundNotification", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                      <span>Lancer Hardback au démarrage du Mac</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#FBBF24]">
                        Barre des menus
                      </span>
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Démarre discrètement Hardback dans la barre des menus à l'ouverture de session, sans ouvrir la grande fenêtre.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.launchAtStartup)}
                    onChange={(e) => handleUpdateSetting("launchAtStartup", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                  />
                </label>
              </div>

              {/* STORAGE SECTION */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#34D399] font-semibold uppercase tracking-wider text-[11px]">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Options de Stockage & Organisation</span>
                </div>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC]">
                      Ignorer les fichiers cachés et système (.DS_Store, Thumbs.db)
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Évite de copier les fichiers système inutiles sur vos disques de sauvegarde.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.ignoreJunkFiles}
                    onChange={(e) => handleUpdateSetting("ignoreJunkFiles", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                      <span>Ignorer les miniatures caméra (.LRV, .THM)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#10B981]/15 text-[#34D399]">
                        +Espace Disque
                      </span>
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Ignore les fichiers d'aperçu basse résolution créés par certaines caméras.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.ignoreCameraProxies}
                    onChange={(e) => handleUpdateSetting("ignoreCameraProxies", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC]">
                      Ranger automatiquement par type (Vidéos / Photos / Audio)
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Trie les fichiers transférés dans des sous-dossiers propres selon leur format.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.sortByMediaType}
                    onChange={(e) => handleUpdateSetting("sortByMediaType", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                  <div>
                    <div className="font-semibold text-[#EDEDEC]">
                      Enregistrer aussi les fichiers de rapport (.txt / .mhl) sur le disque cible
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Par défaut désactivé pour garder vos disques propres (les certificats restent
                      toujours consultables dans Hardback).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.writeReportsOnDisk}
                    onChange={(e) => handleUpdateSetting("writeReportsOnDisk", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                  />
                </label>

                <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#EF4444]/30 cursor-pointer hover:border-[#EF4444]/50">
                  <div>
                    <div className="font-semibold text-[#FCA5A5]">
                      Mode Déplacement (Vider la source après vérification)
                    </div>
                    <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                      Supprime les fichiers de la source uniquement lorsque 100 % des copies sont
                      vérifiées sans erreur.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.moveModeDeleteSource}
                    onChange={(e) => handleUpdateSetting("moveModeDeleteSource", e.target.checked)}
                    className="mt-1 rounded border-[#383838] bg-[#262626] text-[#EF4444]"
                  />
                </label>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-[#2F2F2F] bg-[#252525] flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-[#EDEDEC] text-[#191919] font-semibold text-xs hover:bg-white transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= INGEST BROWSER MODAL (RECURSIVE SUBFOLDER TREE) ================= */}
      {subfolderModal && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#202020] border border-[#333333] rounded-2xl max-w-lg w-full max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2F2F2F] flex items-center justify-between bg-[#252525]">
              <div>
                <div className="flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-[#60A5FA]" />
                  <span className="font-semibold text-sm text-[#EDEDEC]">
                    Arborescence de {subfolderModal.parentName}
                  </span>
                </div>
                <p className="text-[11px] text-[#9B9A97] mt-0.5">
                  Cliquez sur la flèche ▶ d'un dossier pour déplier ses sous-dossiers.
                </p>
              </div>
              <button
                onClick={() => setSubfolderModal(null)}
                className="p-1 rounded hover:bg-[#333333] text-[#9B9A97]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-1.5 flex-1">
              {(() => {
                const renderBranch = (parentPath: string, depth: number): React.ReactNode => {
                  const items = subfolderModal.childrenByParent[parentPath] || [];
                  return items.map((sub) => {
                    const checked = isSubfolderNodeChecked(
                      sub.path,
                      subfolderModal.uncheckedPaths
                    );
                    const isPartial =
                      checked &&
                      hasUncheckedSubfolderDescendant(sub.path, subfolderModal.uncheckedPaths);
                    const isExpanded = subfolderModal.expandedPaths.includes(sub.path);

                    return (
                      <div key={sub.path} className="space-y-1">
                        <div
                          style={{ marginLeft: `${depth * 18}px` }}
                          className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#191919] border border-[#2F2F2F] hover:border-[#3E3E3E] text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {sub.hasChildren ? (
                              <button
                                type="button"
                                onClick={() => handleToggleExpandSubfolder(sub.path)}
                                className="p-1 rounded hover:bg-[#2A2A2A] text-[#9B9A97] hover:text-[#EDEDEC] shrink-0"
                                title={
                                  isExpanded
                                    ? "Replier les sous-dossiers"
                                    : "Déplier les sous-dossiers"
                                }
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-[#60A5FA]" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="w-5 shrink-0" />
                            )}

                            <label className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  handleToggleCheckSubfolder(sub.path, e.target.checked)
                                }
                                className="rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                              />
                              <FolderOpen className="w-4 h-4 text-[#3B82F6] shrink-0" />
                              <span className="text-[#EDEDEC] font-medium truncate">
                                {sub.name}
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isPartial && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#FBBF24] font-medium">
                                Partiel
                              </span>
                            )}
                            {sub.hasChildren && (
                              <button
                                type="button"
                                onClick={() => handleToggleExpandSubfolder(sub.path)}
                                className="text-[10px] px-2 py-0.5 rounded bg-[#252525] hover:bg-[#2F2F2F] text-[#9B9A97] hover:text-[#EDEDEC] border border-[#333333]"
                              >
                                {isExpanded ? "Masquer" : "Sous-dossiers"}
                              </button>
                            )}
                          </div>
                        </div>

                        {isExpanded && renderBranch(sub.path, depth + 1)}
                      </div>
                    );
                  });
                };

                return renderBranch(subfolderModal.rootPath, 0);
              })()}
            </div>

            <div className="px-5 py-3 border-t border-[#2F2F2F] bg-[#252525] flex items-center justify-between">
              {(() => {
                const resolved = computeResolvedSubfolderPaths(subfolderModal);
                return (
                  <>
                    <span className="text-xs text-[#9B9A97]">
                      {resolved.length} branche(s) sélectionnée(s)
                    </span>
                    <button
                      disabled={resolved.length === 0}
                      onClick={async () => {
                        const targetIdx = subfolderModal.sourceIndex;
                        const rootFolderPath = subfolderModal.rootPath;
                        const rootFolderName = subfolderModal.parentName;
                        setSubfolderModal(null);
                        await assignSourceByPaths(resolved, targetIdx, {
                          rootFolderPath,
                          rootFolderName,
                        });
                      }}
                      className="px-4 py-1.5 rounded-xl bg-[#EDEDEC] text-[#191919] font-semibold text-xs hover:bg-white disabled:opacity-40"
                    >
                      Valider la sélection
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ================= VISUAL CERTIFICATE MODAL ================= */}
      {certificateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Top Bar */}
            <div className="px-6 py-4 border-b border-[#2F2F2F] flex items-center justify-between bg-[#252525]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#34D399]">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-[#EDEDEC]">
                    Certificat d'Intégrité Hardback
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Généré le {certificateModal.dateLocal} • ID {certificateModal.jobId.slice(0, 8)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center bg-[#191919] border border-[#333333] rounded-lg p-0.5 text-xs">
                  <button
                    onClick={() => setCertViewMode("visual")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      certViewMode === "visual"
                        ? "bg-[#323232] text-[#EDEDEC]"
                        : "text-[#9B9A97] hover:text-[#EDEDEC]"
                    }`}
                  >
                    Vue Visuelle
                  </button>
                  <button
                    onClick={() => setCertViewMode("raw")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      certViewMode === "raw"
                        ? "bg-[#323232] text-[#EDEDEC]"
                        : "text-[#9B9A97] hover:text-[#EDEDEC]"
                    }`}
                  >
                    Log Brut
                  </button>
                </div>

                <button
                  onClick={handleExportCertificatePdf}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EDEDEC] text-[#191919] hover:bg-white text-xs font-semibold transition-colors cursor-pointer"
                  title="Exporter et ouvrir le certificat au format PDF"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Exporter PDF</span>
                </button>

                <button
                  onClick={() => setCertificateModal(null)}
                  className="p-1.5 rounded-lg hover:bg-[#333333] text-[#9B9A97] hover:text-[#EDEDEC]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {certViewMode === "raw" ? (
              <pre className="p-6 text-xs font-mono text-[#EDEDEC] overflow-auto flex-1 leading-relaxed select-text bg-[#161616]">
                {certificateModal.rawText}
              </pre>
            ) : (
              <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-[#191919]">
                {/* Verified Status Banner */}
                <div className="p-4 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-[#34D399] shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-[#EDEDEC]">
                        100 % des fichiers ont été vérifiés physiquement sans aucune erreur
                      </div>
                      <div className="text-xs text-[#9B9A97] mt-0.5">
                        Chaque bit relu sur le support de destination correspond exactement à la
                        source ({certificateModal.algorithm}).
                      </div>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#10B981]/20 text-[#34D399] font-mono text-xs font-semibold shrink-0">
                    CERTIFIÉ CONFORME
                  </span>
                </div>

                {/* Summary Metrics */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                    <span className="text-[11px] text-[#9B9A97] block">Volume Total</span>
                    <span className="text-base font-semibold font-mono text-[#EDEDEC] mt-0.5 block">
                      {formatBytes(certificateModal.totalBytes)}
                    </span>
                  </div>
                  <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                    <span className="text-[11px] text-[#9B9A97] block">Fichiers Certifiés</span>
                    <span className="text-base font-semibold font-mono text-[#34D399] mt-0.5 block">
                      {certificateModal.verifiedFiles} / {certificateModal.totalFiles}
                    </span>
                  </div>
                  <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                    <span className="text-[11px] text-[#9B9A97] block">Débit Moyen</span>
                    <span className="text-base font-semibold font-mono text-[#60A5FA] mt-0.5 block">
                      {certificateModal.avgSpeedMbS.toFixed(1)} Mo/s
                    </span>
                  </div>
                  <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                    <span className="text-[11px] text-[#9B9A97] block">Durée Totale</span>
                    <span className="text-base font-semibold font-mono text-[#EDEDEC] mt-0.5 block">
                      {certificateModal.durationSecs.toFixed(1)} s
                    </span>
                  </div>
                </div>

                {/* Source & Destination Paths */}
                <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-4 flex items-center justify-between gap-4 text-xs">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[#9B9A97] w-20 shrink-0">Source :</span>
                      <span className="font-mono text-[#EDEDEC] truncate">
                        {certificateModal.sourcePath}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#9B9A97] w-20 shrink-0">Destination :</span>
                      <span className="font-mono text-[#34D399] truncate">
                        {certificateModal.destinationPath}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevealInFinder(certificateModal.destinationPath)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] border border-[#383838] text-[#EDEDEC] font-medium shrink-0 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-[#34D399]" />
                    <span>Voir dans le Finder</span>
                  </button>
                </div>

                {/* Video Health Integrity Status */}
                {certificateModal.corruptedVideos && certificateModal.corruptedVideos.length > 0 ? (
                  <div className="p-4 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#FBBF24] space-y-1.5">
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
                      <span>Alerte Intégrité Vidéo ({certificateModal.corruptedVideos.length} rush(s) non finalisé(s))</span>
                    </div>
                    <p className="text-[11px] text-[#D1D5DB]">
                      Ces fichiers ont été transférés tels quels depuis la carte mais leur atome MOOV est manquant (enregistrement interrompu sur la caméra) :
                    </p>
                    <ul className="list-disc list-inside font-mono text-[11px] text-[#FCD34D] space-y-0.5">
                      {certificateModal.corruptedVideos.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/20 text-xs text-[#34D399] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0" />
                    <span>Intégrité des conteneurs vidéo : 100% Validé (Tous conteneurs finalisés avec atome MOOV)</span>
                  </div>
                )}

                {/* Files Manifest Table */}
                <div className="border border-[#2F2F2F] rounded-xl overflow-hidden bg-[#202020]">
                  <div className="px-4 py-2.5 border-b border-[#2F2F2F] bg-[#252525] flex items-center justify-between gap-4">
                    <span className="text-xs font-semibold text-[#9B9A97] uppercase tracking-wider">
                      Fichiers Vérifiés ({filteredCertRecords.length})
                    </span>
                    <div className="relative w-64">
                      <Search className="w-3.5 h-3.5 text-[#6B6B68] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={certSearchQuery}
                        onChange={(e) => setCertSearchQuery(e.target.value)}
                        placeholder="Rechercher un fichier ou hash…"
                        className="w-full pl-8 pr-3 py-1 rounded-lg bg-[#191919] border border-[#333333] text-xs text-[#EDEDEC] placeholder-[#6B6B68] focus:outline-none focus:border-[#3B82F6]"
                      />
                    </div>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-[#2A2A2A] text-xs">
                    {filteredCertRecords.map((rec, i) => (
                      <div
                        key={`${rec.relativePath}-${i}`}
                        className="px-4 py-2 flex items-center justify-between gap-4 hover:bg-[#262626]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                          <span className="font-mono text-[#EDEDEC] truncate">
                            {rec.relativePath}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-[#9B9A97] font-mono">
                            {formatBytes(rec.sizeBytes)}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#191919] border border-[#2F2F2F] font-mono text-[11px] text-[#60A5FA]">
                            {rec.sourceHash}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
