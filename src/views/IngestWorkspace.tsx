import React from "react";
import {
  AlertTriangle,
  FolderOpen,
  FolderTree,
  Layers,
  Package,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { PathInspection, StorageDevice } from "../types";
import { formatBytes } from "../utils/format";
import {
  DeviceVisualIcon,
  EjectIcon,
  SdCardLogo,
  SsdLogo,
} from "../components/StorageIcons";

interface IngestWorkspaceProps {
  devices: StorageDevice[];
  isRefreshingDevices: boolean;
  selectedSources: PathInspection[];
  selectedDestinations: PathInspection[];
  customFolderName: string;
  moveModeDeleteSource: boolean;
  dragHoverZone: "source" | "destination" | null;
  internalDraggedDevicePathRef: React.MutableRefObject<string | null>;
  onSetDragHoverZone: (zone: "source" | "destination" | null) => void;
  onSetPointerDraggingDevice: (
    state: { device: StorageDevice; x: number; y: number } | null
  ) => void;
  onRefreshDevices: () => void;
  onClearSources: () => void;
  onRemoveSourceAt: (index: number) => void;
  onAssignSourcePaths: (paths: string[]) => void;
  onPickSourceFolder: (e?: React.MouseEvent) => void;
  onPickSourceFilesPackage: (e: React.MouseEvent) => void;
  onOpenIngestBrowser: (e: React.MouseEvent, index: number) => void;
  onClearDestinations: () => void;
  onRemoveDestination: (path: string) => void;
  onAddDestinationPath: (path: string) => void;
  onPickDestinationFolder: () => void;
  onEjectDevice: (e: React.MouseEvent, dev: StorageDevice) => void;
  onSetCustomFolderName: (value: string) => void;
  onLaunchTransfer: () => void;
}

export function IngestWorkspace({
  devices,
  isRefreshingDevices,
  selectedSources,
  selectedDestinations,
  customFolderName,
  moveModeDeleteSource,
  dragHoverZone,
  internalDraggedDevicePathRef,
  onSetDragHoverZone,
  onSetPointerDraggingDevice,
  onRefreshDevices,
  onClearSources,
  onRemoveSourceAt,
  onAssignSourcePaths,
  onPickSourceFolder,
  onPickSourceFilesPackage,
  onOpenIngestBrowser,
  onClearDestinations,
  onRemoveDestination,
  onAddDestinationPath,
  onPickDestinationFolder,
  onEjectDevice,
  onSetCustomFolderName,
  onLaunchTransfer,
}: IngestWorkspaceProps) {
  const totalSourcesBytes = selectedSources.reduce(
    (sum, s) => sum + s.totalBytes,
    0
  );

  return (
    <div className="flex-1 grid grid-cols-12 gap-5 min-h-0">
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
              onClick={onClearSources}
              className="text-[11px] text-[#9B9A97] hover:text-[#EF4444] transition-colors"
            >
              Tout vider
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            onSetDragHoverZone("source");
          }}
          onDragLeave={() => onSetDragHoverZone(null)}
          onDrop={(e) => {
            e.preventDefault();
            onSetDragHoverZone(null);
            const internalPath =
              e.dataTransfer.getData("text/hardback-path") ||
              internalDraggedDevicePathRef.current;
            internalDraggedDevicePathRef.current = null;
            if (internalPath) {
              onAssignSourcePaths([internalPath]);
            }
          }}
          onClick={onPickSourceFolder}
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
                Déposez vos cartes SD depuis le centre, des dossiers du Finder,
                ou sélectionnez :
              </p>

              <div className="flex items-center gap-2 w-full justify-center">
                <button
                  type="button"
                  onClick={onPickSourceFolder}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] border border-[#383838] text-xs font-medium text-[#EDEDEC] transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Dossier / Carte</span>
                </button>
                <button
                  type="button"
                  onClick={onPickSourceFilesPackage}
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
                        onClick={() => onRemoveSourceAt(srcIdx)}
                        className="p-1 text-[#6B6B68] hover:text-[#EF4444] rounded transition-colors shrink-0"
                        title="Retirer cette source"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {(src.isDir || src.rootFolderPath) && (
                      <button
                        type="button"
                        onClick={(e) => onOpenIngestBrowser(e, srcIdx)}
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
                  onClick={onPickSourceFolder}
                  className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#262626] hover:bg-[#2F2F2F] border border-[#333333] text-[#EDEDEC] font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>Dossier / Carte</span>
                </button>
                <button
                  type="button"
                  onClick={onPickSourceFilesPackage}
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

      <section className="col-span-4 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
            Supports Détectés
          </h2>
          <button
            onClick={onRefreshDevices}
            className="text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isRefreshingDevices ? "animate-spin" : ""
              }`}
            />
            <span>Actualiser</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-0">
          {devices.map((dev) => {
            const usedRatio =
              dev.totalBytes > 0
                ? Math.min(
                    100,
                    Math.round((dev.usedBytes / dev.totalBytes) * 100)
                  )
                : 0;
            const isCard = dev.deviceType === "sd_card";
            const isHdd = dev.deviceType === "hdd";
            const isExternalSsd = dev.deviceType === "ssd";
            const canEject =
              dev.mountPoint !== "/" && dev.mountPoint.startsWith("/Volumes/");

            return (
              <div
                key={dev.id}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  internalDraggedDevicePathRef.current = dev.mountPoint;
                  onSetPointerDraggingDevice({
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
                      <DeviceVisualIcon
                        deviceType={dev.deviceType}
                        className="w-5 h-5"
                      />
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
                      onClick={() => onAssignSourcePaths([dev.mountPoint])}
                      className="text-[11px] px-2 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#F59E0B] hover:text-black border border-[#383838] text-[#FBBF24] transition-colors font-medium"
                    >
                      ← Source
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddDestinationPath(dev.mountPoint)}
                      className="text-[11px] px-2 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#10B981] hover:text-black border border-[#383838] text-[#34D399] transition-colors font-medium"
                    >
                      Dest →
                    </button>
                    {canEject && (
                      <button
                        type="button"
                        onClick={(e) => onEjectDevice(e, dev)}
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
          {moveModeDeleteSource && (
            <div className="px-3 py-2 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[11px] text-[#FCA5A5] flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
              <span>
                <strong className="text-[#EF4444]">Mode Déplacement actif</strong> — les fichiers sources seront supprimés après vérification 100 %.
              </span>
            </div>
          )}

          <input
            type="text"
            value={customFolderName}
            onChange={(e) => onSetCustomFolderName(e.target.value)}
            placeholder="Nom du dossier créé (optionnel, ex: Shooting_CamA)"
            className="w-full px-3 py-2 rounded-xl bg-[#202020] border border-[#2F2F2F] focus:border-[#3B82F6] focus:outline-none text-xs text-[#EDEDEC] placeholder-[#6B6B68]"
          />

          <button
            onClick={onLaunchTransfer}
            disabled={
              selectedSources.length === 0 || selectedDestinations.length === 0
            }
            className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md ${
              selectedSources.length > 0 && selectedDestinations.length > 0
                ? moveModeDeleteSource
                  ? "bg-[#EF4444] hover:bg-[#DC2626] text-white shadow-lg shadow-[#EF4444]/20 cursor-pointer active:scale-[0.99]"
                  : "bg-gradient-to-r from-[#F59E0B] via-[#EAB308] to-[#10B981] hover:from-[#D97706] hover:to-[#059669] text-black shadow-lg shadow-[#F59E0B]/20 cursor-pointer active:scale-[0.99]"
                : "bg-[#222222] text-[#5A5A58] border border-[#2F2F2F] cursor-not-allowed"
            }`}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {moveModeDeleteSource
                ? "Déplacer & Vider la Source"
                : "Lancer le Transfert"}
              {selectedSources.length > 1
                ? ` (${selectedSources.length} sources)`
                : ""}
            </span>
            {selectedDestinations.length > 1 && (
              <span className="text-[11px] bg-black/20 text-black px-1.5 py-0.5 rounded font-mono font-bold">
                ×{selectedDestinations.length}
              </span>
            )}
          </button>
        </div>
      </section>

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
              onClick={onClearDestinations}
              className="text-[11px] text-[#9B9A97] hover:text-[#EF4444] transition-colors"
            >
              Tout vider
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            onSetDragHoverZone("destination");
          }}
          onDragLeave={() => onSetDragHoverZone(null)}
          onDrop={(e) => {
            e.preventDefault();
            onSetDragHoverZone(null);
            const internalPath =
              e.dataTransfer.getData("text/hardback-path") ||
              internalDraggedDevicePathRef.current;
            internalDraggedDevicePathRef.current = null;
            if (internalPath) {
              onAddDestinationPath(internalPath);
            }
          }}
          onClick={onPickDestinationFolder}
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
                Ajoutez un ou plusieurs disques pour sauvegarder vos fichiers
                simultanément.
              </p>
            </div>
          ) : (
            <div className="flex flex-col h-full justify-between min-h-0">
              <div className="space-y-2 overflow-y-auto pr-1">
                {selectedDestinations.map((dest, idx) => {
                  const enoughSpace =
                    selectedSources.length === 0 ||
                    dest.availableBytes >= totalSourcesBytes;
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
                              enoughSpace
                                ? "text-[#34D399]"
                                : "text-[#EF4444] font-semibold"
                            }`}
                          >
                            {formatBytes(dest.availableBytes)} libres
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveDestination(dest.path)}
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
  );
}
