import { ArrowDownSquare, ArrowRight, RefreshCw, X } from "lucide-react";
import { UpdateCheckInfo } from "../types";
import { formatBytes } from "../utils/format";

interface UpdateModalProps {
  updateInfo: UpdateCheckInfo;
  isInstallingUpdate: boolean;
  installStatus: string;
  downloadProgress: number;
  onClose: () => void;
  onApplyUpdate: () => void;
}

export function UpdateModal({
  updateInfo,
  isInstallingUpdate,
  installStatus,
  downloadProgress,
  onClose,
  onApplyUpdate,
}: UpdateModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
      <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2C2C2C] flex items-center justify-between bg-[#232323]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <ArrowDownSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#EDEDEC]">
                Mise à jour disponible
              </h3>
              <p className="text-[11px] text-[#9B9A97]">
                {updateInfo.releaseName || updateInfo.latestVersion} •{" "}
                {formatBytes(updateInfo.assetSize)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isInstallingUpdate}
            onClick={onClose}
            className="text-[#888888] hover:text-[#EDEDEC] p-1.5 rounded-lg hover:bg-[#2A2A2A] transition-colors disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between text-xs bg-[#161616] p-3 rounded-xl border border-[#2B2B2B]">
            <div>
              <span className="text-[#888888] block text-[10px]">
                Version actuelle
              </span>
              <span className="font-semibold text-[#EDEDEC] font-mono">
                {updateInfo.currentVersion}
              </span>
            </div>
            <ArrowRight className="w-4 h-4 text-[#555555]" />
            <div>
              <span className="text-blue-400 block text-[10px] font-semibold">
                Nouvelle version
              </span>
              <span className="font-bold text-blue-400 font-mono">
                {updateInfo.latestVersion}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
              Résumé des nouveautés
            </span>
            <div className="bg-[#161616] p-3.5 rounded-xl border border-[#2A2A2A] text-xs text-[#D1D5DB] leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap font-sans">
              {updateInfo.releaseNotes}
            </div>
          </div>

          {isInstallingUpdate && (
            <div className="space-y-2 pt-2 bg-[#171717] p-3.5 rounded-xl border border-blue-500/20">
              <div className="flex items-center justify-between text-xs">
                <span className="text-blue-300 font-medium">{installStatus}</span>
                <span className="font-mono text-blue-400 font-bold">
                  {downloadProgress}%
                </span>
              </div>
              <div className="w-full bg-[#111111] h-2 rounded-full overflow-hidden border border-[#2A2A2A]">
                <div
                  className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full transition-all duration-150"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-[#191919] border-t border-[#2C2C2C] flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isInstallingUpdate}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#252525] border border-[#2F2F2F] transition-colors disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={isInstallingUpdate}
            onClick={onApplyUpdate}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg shadow-blue-600/30 border border-blue-400/40 flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isInstallingUpdate ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Mise à jour en cours…</span>
              </>
            ) : (
              <>
                <ArrowDownSquare className="w-3.5 h-3.5" />
                <span>Mettre à jour</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
