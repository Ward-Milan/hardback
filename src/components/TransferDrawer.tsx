import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderOpen,
  Pause,
  Play,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { TransferJobState } from "../types";
import { formatEta, formatSpeed } from "../utils/format";

interface TransferDrawerProps {
  transfers: TransferJobState[];
  isDrawerOpen: boolean;
  onSetDrawerOpen: (open: boolean) => void;
  onPauseTransfer: (jobId: string) => void;
  onResumeTransfer: (jobId: string) => void;
  onDismissTransfer: (jobId: string) => void;
  onCancelTransfer: (jobId: string) => void;
  onRevealInFinder: (path: string) => void;
  onOpenCertificate: (reportPath: string) => void;
}

const JOB_STATUS_LABELS: Record<string, string> = {
  copying: "Copie en cours",
  verifying: "Vérification",
  completed: "Terminé & Vérifié",
  paused: "En Pause",
  queued: "En file d'attente (Disque occupé)",
  scanning: "Préparation",
};

export function TransferDrawer({
  transfers,
  isDrawerOpen,
  onSetDrawerOpen,
  onPauseTransfer,
  onResumeTransfer,
  onDismissTransfer,
  onCancelTransfer,
  onRevealInFinder,
  onOpenCertificate,
}: TransferDrawerProps) {
  const activeRunningJobs = transfers.filter(
    (t) =>
      t.status === "scanning" ||
      t.status === "copying" ||
      t.status === "verifying"
  );
  const activeRunningCount = activeRunningJobs.length;
  const primaryActiveJob = activeRunningJobs[0] || transfers[0] || null;

  return (
    <>
      {!isDrawerOpen && (
        <button
          onClick={() => onSetDrawerOpen(true)}
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
            onClick={() => onSetDrawerOpen(false)}
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
                          {JOB_STATUS_LABELS[job.status] || "Erreur"}
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
                          onClick={() => onPauseTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#F59E0B]/15 hover:text-[#FBBF24] hover:border-[#F59E0B]/40 text-xs font-medium text-[#EDEDEC] transition-colors"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </button>
                      )}

                      {(isPaused || isFailed) && (
                        <button
                          onClick={() => onResumeTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-semibold transition-colors shadow-sm"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Reprendre</span>
                        </button>
                      )}

                      {isDone && job.destinationPaths.length > 0 && (
                        <button
                          onClick={() =>
                            onRevealInFinder(job.destinationPaths[0])
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC]"
                          title="Ouvrir le dossier dans le Finder macOS"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#34D399]" />
                          <span>Ouvrir dans le Finder</span>
                        </button>
                      )}

                      {isDone && job.reportPaths.length > 0 && (
                        <button
                          onClick={() => onOpenCertificate(job.reportPaths[0])}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#323232] text-xs font-medium text-[#EDEDEC]"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#60A5FA]" />
                          <span>Certificat</span>
                        </button>
                      )}

                      {isDone ? (
                        <button
                          onClick={() => onDismissTransfer(job.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#383838] bg-[#262626] hover:bg-[#333333] hover:text-[#EDEDEC] text-xs font-medium text-[#9B9A97] transition-colors"
                          title="Fermer cette carte de la liste des transferts actifs"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Fermer</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => onCancelTransfer(job.id)}
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
                        style={{
                          width: `${Math.max(2, job.progressPercent)}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 pt-1">
                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">
                        Progression
                      </span>
                      <span className="text-lg font-semibold font-mono text-[#EDEDEC]">
                        {job.progressPercent.toFixed(1)}%
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">
                        Vitesse
                      </span>
                      <span className="text-lg font-semibold font-mono text-[#60A5FA]">
                        {isPaused
                          ? "En pause"
                          : isQueued
                          ? "En attente"
                          : formatSpeed(job.speedBps)}
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">
                        Temps restant
                      </span>
                      <span className="text-lg font-semibold font-mono text-[#EDEDEC]">
                        {isDone
                          ? "0s"
                          : isPaused
                          ? "—"
                          : isQueued
                          ? "En file"
                          : formatEta(job.etaSeconds)}
                      </span>
                    </div>

                    <div className="bg-[#191919] border border-[#2A2A2A] rounded-xl p-3">
                      <span className="text-[11px] text-[#9B9A97] block">
                        Fichiers vérifiés
                      </span>
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
                          Alerte Intégrité Vidéo ({job.corruptedVideos.length}{" "}
                          rush(s) non finalisé(s) ou endommagé(s) détecté(s)) :
                        </span>
                        <p className="text-[11px] text-[#D1D5DB]">
                          Attention : la caméra s'est éteinte ou a été coupée
                          avant la finalisation du conteneur (atome MOOV
                          manquant). Ne formatez pas la carte avant vérification
                          en montage :
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
    </>
  );
}
