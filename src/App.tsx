import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  ArrowDownSquare,
  CheckCircle2,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import {
  AppSettings,
  IngestHistoryEntry,
  PathInspection,
  StorageDevice,
  SubfolderEntry,
  TransferJobState,
  UpdateCheckInfo,
  VisualCertificateData,
} from "./types";
import { HardbackCascadeLogo } from "./Logo";
import { DeviceVisualIcon } from "./components/StorageIcons";
import { UpdateModal } from "./components/UpdateModal";
import { SettingsModal } from "./components/SettingsModal";
import { SubfolderBrowserModal } from "./components/SubfolderBrowserModal";
import { CertificateModal } from "./components/CertificateModal";
import { TransferDrawer } from "./components/TransferDrawer";
import { HistorySection } from "./components/HistorySection";
import { IngestWorkspace } from "./views/IngestWorkspace";
import { SubfolderModalState } from "./utils/subfolderTree";

export default function App() {
  const [devices, setDevices] = useState<StorageDevice[]>([]);
  const [selectedSources, setSelectedSources] = useState<PathInspection[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<
    PathInspection[]
  >([]);
  const [customFolderName, setCustomFolderName] = useState<string>("");

  const [transfers, setTransfers] = useState<TransferJobState[]>([]);
  const [history, setHistory] = useState<IngestHistoryEntry[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const [settings, setSettings] = useState<AppSettings>({
    smartCascading: true,
    fastInlineVerifyOnly: false,
    turboIo: true,
    ignoreJunkFiles: false,
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
  const [confirmMoveModal, setConfirmMoveModal] = useState<boolean>(false);
  const [confirmMoveChecked, setConfirmMoveChecked] = useState<boolean>(false);
  const [subfolderModal, setSubfolderModal] =
    useState<SubfolderModalState | null>(null);

  const [dragHoverZone, setDragHoverZone] = useState<
    "source" | "destination" | null
  >(null);
  const [pointerDraggingDevice, setPointerDraggingDevice] = useState<{
    device: StorageDevice;
    x: number;
    y: number;
  } | null>(null);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [certificateModal, setCertificateModal] =
    useState<VisualCertificateData | null>(null);

  const [updateInfo, setUpdateInfo] = useState<UpdateCheckInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [installStatus, setInstallStatus] = useState<string>(
    "Téléchargement de la mise à jour…"
  );

  const [isRefreshingDevices, setIsRefreshingDevices] =
    useState<boolean>(false);

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
          if (
            typeof replaceIndex === "number" &&
            replaceIndex >= 0 &&
            replaceIndex < prev.length
          ) {
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

    invoke<UpdateCheckInfo>("check_for_updates")
      .then((info) => {
        if (info && info.updateAvailable) {
          setUpdateInfo(info);
        }
      })
      .catch((e) => console.log("Recherche silencieuse mise à jour:", e));

    const onFocus = () => {
      refreshDevices();
    };
    window.addEventListener("focus", onFocus);

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
    const unlistenProgress = listen<TransferJobState>(
      "transfer-progress",
      (event) => {
        const updated = event.payload;
        setTransfers((prev) => {
          const exists = prev.some((j) => j.id === updated.id);
          if (exists) {
            return prev.map((j) => (j.id === updated.id ? updated : j));
          }
          return [updated, ...prev];
        });
      }
    );

    const unlistenHistory = listen<IngestHistoryEntry[]>(
      "history-updated",
      (event) => {
        setHistory(event.payload);
      }
    );

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

        if (
          (!paths || paths.length === 0) &&
          internalDraggedDevicePathRef.current
        ) {
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

  const handleEjectDevice = async (
    e: React.MouseEvent,
    dev: StorageDevice
  ) => {
    e.stopPropagation();
    setErrorBanner(null);
    try {
      const msg = await invoke<string>("eject_volume", {
        mountPoint: dev.mountPoint,
      });
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
        title:
          "Sélectionner une vidéo ou plusieurs photos/fichiers (Mode Package)",
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

  const handleOpenIngestBrowser = async (
    e: React.MouseEvent,
    sourceIndex: number
  ) => {
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

  const handleToggleCheckSubfolder = (
    folderPath: string,
    nextChecked: boolean
  ) => {
    setSubfolderModal((prev) => {
      if (!prev) return null;
      if (!nextChecked) {
        const filtered = prev.uncheckedPaths.filter(
          (u) => u !== folderPath && !u.startsWith(folderPath + "/")
        );
        return { ...prev, uncheckedPaths: [...filtered, folderPath] };
      }
      let nextUnchecked = prev.uncheckedPaths.filter(
        (u) => u !== folderPath && !u.startsWith(folderPath + "/")
      );
      const uncheckedAncestor = nextUnchecked.find((u) =>
        folderPath.startsWith(u + "/")
      );
      if (uncheckedAncestor) {
        nextUnchecked = nextUnchecked.filter((u) => u !== uncheckedAncestor);
        const siblings = prev.childrenByParent[uncheckedAncestor] || [];
        for (const sib of siblings) {
          if (
            sib.path !== folderPath &&
            !folderPath.startsWith(sib.path + "/")
          ) {
            nextUnchecked.push(sib.path);
          }
        }
      }
      return { ...prev, uncheckedPaths: nextUnchecked };
    });
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
    const destPaths =
      customDestinations || selectedDestinations.map((d) => d.path);

    if (destPaths.length === 0) {
      setErrorBanner(
        "Glissez ou sélectionnez au moins une destination à droite."
      );
      return;
    }

    if (customSourcePaths && customSourcePaths.length > 0) {
      try {
        const startedJob = await invoke<TransferJobState>("start_transfer", {
          sourcePaths: customSourcePaths,
          destinationPaths: destPaths,
          algorithm: settings.hashAlgorithm || "xxh64",
          createSubfolder: true,
          customFolderName: customFolderName.trim()
            ? customFolderName.trim()
            : null,
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
          srcItem.paths && srcItem.paths.length > 0
            ? srcItem.paths
            : [srcItem.path];
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
      setSelectedSources([]);
      setCustomFolderName("");
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
      const paused = await invoke<TransferJobState>("pause_transfer", {
        jobId,
      });
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
      const resumed = await invoke<TransferJobState>("resume_transfer", {
        jobId,
      });
      setTransfers((prev) => prev.map((j) => (j.id === jobId ? resumed : j)));
    } catch (err) {
      setErrorBanner(String(err));
    }
  };

  const handleDismissTransfer = async (jobId: string) => {
    try {
      const remaining = await invoke<TransferJobState[]>("dismiss_transfer", {
        jobId,
      });
      setTransfers(remaining);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelAndRemoveTransfer = async (jobId: string) => {
    try {
      const remaining = await invoke<TransferJobState[]>("cancel_transfer", {
        jobId,
      });
      setTransfers(remaining);
      const updatedHist = await invoke<IngestHistoryEntry[]>(
        "get_ingest_history"
      );
      setHistory(updatedHist);
      showToast(
        "Transfert annulé — fichiers incomplets supprimés de la destination."
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCertificate = async (reportPath: string) => {
    try {
      const cert = await invoke<VisualCertificateData>(
        "read_visual_certificate",
        { path: reportPath }
      );
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

  const handleRerunHistory = async (item: IngestHistoryEntry) => {
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
  };

  const handleDeleteHistory = async (id: string) => {
    try {
      const updated = await invoke<IngestHistoryEntry[]>(
        "remove_history_item",
        { id }
      );
      setHistory(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCheckUpdateManual = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await invoke<UpdateCheckInfo>("check_for_updates");
      if (info.updateAvailable) {
        setUpdateInfo(info);
        setIsUpdateModalOpen(true);
      } else {
        setUpdateInfo(null);
        showToast(`Hardback est à jour (${info.currentVersion})`);
      }
    } catch {
      showToast(
        "Impossible de vérifier les mises à jour (vérifiez la connexion internet)"
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!updateInfo) return;
    setIsInstallingUpdate(true);
    setInstallStatus("Téléchargement de la mise à jour…");
    setDownloadProgress(0);

    const unlisten = await listen<number>(
      "update-download-progress",
      (event) => {
        const p = Math.round(event.payload);
        setDownloadProgress(p);
        if (p >= 100) {
          setInstallStatus("Installation et redémarrage automatique…");
        }
      }
    );

    try {
      await invoke("install_update", {
        downloadUrl: updateInfo.downloadUrl,
        assetSize: updateInfo.assetSize,
        assetUpdatedAt: updateInfo.assetUpdatedAt,
      });
    } catch (err) {
      unlisten();
      setIsInstallingUpdate(false);
      setErrorBanner(`Erreur mise à jour : ${err}`);
    }
  };

  return (
    <div className="relative h-screen w-screen flex flex-col bg-[#191919] text-[#EDEDEC] overflow-hidden select-none">
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

      {statusToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-[#10B981] text-[#191919] font-semibold text-xs shadow-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{statusToast}</span>
        </div>
      )}

      <header className="h-13 px-6 border-b border-[#2A2A2A] flex items-center justify-between bg-[#191919] shrink-0 z-10 py-3">
        <div className="flex items-center gap-3">
          <HardbackCascadeLogo className="w-8 h-8 drop-shadow-md transition-transform hover:scale-105" />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-[#EDEDEC]">
              Hardback
            </span>
            <span className="text-xs text-[#888888] hidden sm:inline flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#10B981]" />
              Double Flux Certifié
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {updateInfo?.updateAvailable ? (
            <button
              onClick={() => setIsUpdateModalOpen(true)}
              className="relative p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 border border-blue-400/50 transition-all active:scale-95 group cursor-pointer"
              title="Mise à jour disponible — Cliquez pour voir le résumé"
            >
              <ArrowDownSquare className="w-4 h-4" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-300 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-300 border border-[#191919]" />
              </span>
            </button>
          ) : (
            <button
              onClick={handleCheckUpdateManual}
              disabled={isCheckingUpdate}
              className="p-2 rounded-xl text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title={
                isCheckingUpdate
                  ? "Recherche de mise à jour…"
                  : "Rechercher une mise à jour"
              }
            >
              {isCheckingUpdate ? (
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              ) : (
                <ArrowDownSquare className="w-4 h-4" />
              )}
            </button>
          )}

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

      <main className="flex-1 flex flex-col min-h-0 px-6 pt-4 pb-14 gap-4 overflow-hidden">
        <IngestWorkspace
          devices={devices}
          isRefreshingDevices={isRefreshingDevices}
          selectedSources={selectedSources}
          selectedDestinations={selectedDestinations}
          customFolderName={customFolderName}
          moveModeDeleteSource={settings.moveModeDeleteSource}
          dragHoverZone={dragHoverZone}
          internalDraggedDevicePathRef={internalDraggedDevicePathRef}
          onSetDragHoverZone={setDragHoverZone}
          onSetPointerDraggingDevice={setPointerDraggingDevice}
          onRefreshDevices={refreshDevices}
          onClearSources={() => setSelectedSources([])}
          onRemoveSourceAt={(idx) =>
            setSelectedSources((prev) => prev.filter((_, i) => i !== idx))
          }
          onAssignSourcePaths={(paths) => assignSourceByPaths(paths)}
          onPickSourceFolder={handlePickSourceFolder}
          onPickSourceFilesPackage={handlePickSourceFilesPackage}
          onOpenIngestBrowser={handleOpenIngestBrowser}
          onClearDestinations={() => setSelectedDestinations([])}
          onRemoveDestination={(path) =>
            setSelectedDestinations((prev) =>
              prev.filter((d) => d.path !== path)
            )
          }
          onAddDestinationPath={addDestinationByPath}
          onPickDestinationFolder={handlePickDestinationFolder}
          onEjectDevice={handleEjectDevice}
          onSetCustomFolderName={setCustomFolderName}
          onLaunchTransfer={() => {
            if (settings.moveModeDeleteSource) {
              setConfirmMoveChecked(false);
              setConfirmMoveModal(true);
            } else {
              handleLaunchTransfer();
            }
          }}
        />

        <HistorySection
          history={history}
          onRevealInFinder={handleRevealInFinder}
          onOpenCertificate={handleOpenCertificate}
          onRerunHistory={handleRerunHistory}
          onDeleteHistory={handleDeleteHistory}
        />
      </main>

      <TransferDrawer
        transfers={transfers}
        isDrawerOpen={isDrawerOpen}
        onSetDrawerOpen={setIsDrawerOpen}
        onPauseTransfer={handlePauseTransfer}
        onResumeTransfer={handleResumeTransferInPlace}
        onDismissTransfer={handleDismissTransfer}
        onCancelTransfer={handleCancelAndRemoveTransfer}
        onRevealInFinder={handleRevealInFinder}
        onOpenCertificate={handleOpenCertificate}
      />

      {isUpdateModalOpen && updateInfo && (
        <UpdateModal
          updateInfo={updateInfo}
          isInstallingUpdate={isInstallingUpdate}
          installStatus={installStatus}
          downloadProgress={downloadProgress}
          onClose={() => setIsUpdateModalOpen(false)}
          onApplyUpdate={handleApplyUpdate}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          onUpdateSetting={handleUpdateSetting}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {subfolderModal && (
        <SubfolderBrowserModal
          modal={subfolderModal}
          onClose={() => setSubfolderModal(null)}
          onToggleExpand={handleToggleExpandSubfolder}
          onToggleCheck={handleToggleCheckSubfolder}
          onValidate={async (
            resolvedPaths,
            sourceIndex,
            rootFolderPath,
            rootFolderName
          ) => {
            setSubfolderModal(null);
            await assignSourceByPaths(resolvedPaths, sourceIndex, {
              rootFolderPath,
              rootFolderName,
            });
          }}
        />
      )}

      {certificateModal && (
        <CertificateModal
          certificate={certificateModal}
          onClose={() => setCertificateModal(null)}
          onExportPdf={handleExportCertificatePdf}
          onRevealInFinder={handleRevealInFinder}
        />
      )}

      {confirmMoveModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer le Mode Déplacement
                </h3>
              </div>
              <button
                onClick={() => setConfirmMoveModal(false)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#FCA5A5] space-y-1">
                <div className="font-bold text-[#EF4444]">
                  SUPPRESSION DES FICHIERS SOURCES ACTIVÉE
                </div>
                <p className="text-[11px] text-[#FCA5A5]/90">
                  Une fois la copie vérifiée à 100 % sur toutes les destinations, les fichiers originaux de la source seront supprimés définitivement.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#EDEDEC] cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmMoveChecked}
                  onChange={(e) => setConfirmMoveChecked(e.target.checked)}
                  className="accent-[#EF4444]"
                />
                <span>
                  Je comprends que les fichiers sources seront supprimés après vérification
                </span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmMoveModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    setConfirmMoveModal(false);
                    handleLaunchTransfer();
                  }}
                  disabled={!confirmMoveChecked}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs cursor-pointer"
                >
                  Lancer le déplacement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
