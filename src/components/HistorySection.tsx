import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  FolderOpen,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { IngestHistoryEntry } from "../types";
import { formatBytes } from "../utils/format";

interface HistorySectionProps {
  history: IngestHistoryEntry[];
  onRevealInFinder: (path: string) => void;
  onOpenCertificate: (reportPath: string) => void;
  onRerunHistory: (item: IngestHistoryEntry) => void;
  onDeleteHistory: (id: string) => void;
}

export function HistorySection({
  history,
  onRevealInFinder,
  onOpenCertificate,
  onRerunHistory,
  onDeleteHistory,
}: HistorySectionProps) {
  return (
    <section className="h-44 shrink-0 border border-[#2F2F2F] rounded-2xl bg-[#202020] flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#2F2F2F] bg-[#242424] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-[#9B9A97]" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#9B9A97]">
            Historique des Transferts
          </h3>
          <span className="text-[11px] text-[#6B6B68] font-mono">
            ({history.length})
          </span>
        </div>
        <span className="text-[11px] text-[#9B9A97]">
          Relancez un transfert récent avec les mêmes sources &amp; destinations
          en un clic
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
                    {formatBytes(item.totalBytes)} • {item.verifiedFiles}/
                    {item.totalFiles} fichiers
                  </span>

                  {item.destinationPaths.length > 0 && (
                    <button
                      onClick={() => onRevealInFinder(item.destinationPaths[0])}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#383838] bg-[#262626] hover:bg-[#323232] text-[#EDEDEC] font-medium transition-colors"
                      title="Ouvrir le dossier de destination dans le Finder"
                    >
                      <FolderOpen className="w-3 h-3 text-[#34D399]" />
                      <span>Finder</span>
                    </button>
                  )}

                  {item.reportPaths && item.reportPaths.length > 0 && (
                    <button
                      onClick={() => onOpenCertificate(item.reportPaths[0])}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#383838] bg-[#262626] hover:bg-[#323232] text-[#EDEDEC] font-medium transition-colors"
                    >
                      <FileText className="w-3 h-3 text-[#60A5FA]" />
                      <span>Certificat</span>
                    </button>
                  )}

                  <button
                    onClick={() => onRerunHistory(item)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EDEDEC] text-[#191919] hover:bg-white font-semibold transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Relancer</span>
                  </button>

                  <button
                    onClick={() => onDeleteHistory(item.id)}
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
  );
}
