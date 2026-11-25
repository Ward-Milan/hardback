import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Printer,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { VisualCertificateData } from "../types";
import { formatBytes } from "../utils/format";

interface CertificateModalProps {
  certificate: VisualCertificateData;
  onClose: () => void;
  onExportPdf: () => void;
  onRevealInFinder: (path: string) => void;
}

export function CertificateModal({
  certificate,
  onClose,
  onExportPdf,
  onRevealInFinder,
}: CertificateModalProps) {
  const [certViewMode, setCertViewMode] = useState<"visual" | "raw">("visual");
  const [certSearchQuery, setCertSearchQuery] = useState("");

  const filteredCertRecords = certificate.records.filter(
    (r) =>
      !certSearchQuery.trim() ||
      r.relativePath.toLowerCase().includes(certSearchQuery.toLowerCase()) ||
      r.sourceHash.toLowerCase().includes(certSearchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-[#1E1E1E] border border-[#333333] rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
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
                Généré le {certificate.dateLocal} • ID{" "}
                {certificate.jobId.slice(0, 8)}
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
              onClick={onExportPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#EDEDEC] text-[#191919] hover:bg-white text-xs font-semibold transition-colors cursor-pointer"
              title="Exporter et ouvrir le certificat au format PDF"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Exporter PDF</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#333333] text-[#9B9A97] hover:text-[#EDEDEC]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {certViewMode === "raw" ? (
          <pre className="p-6 text-xs font-mono text-[#EDEDEC] overflow-auto flex-1 leading-relaxed select-text bg-[#161616]">
            {certificate.rawText}
          </pre>
        ) : (
          <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-[#191919]">
            <div className="p-4 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-[#34D399] shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-[#EDEDEC]">
                    100 % des fichiers ont été vérifiés physiquement sans aucune
                    erreur
                  </div>
                  <div className="text-xs text-[#9B9A97] mt-0.5">
                    Chaque bit relu sur le support de destination correspond
                    exactement à la source ({certificate.algorithm}).
                  </div>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-[#10B981]/20 text-[#34D399] font-mono text-xs font-semibold shrink-0">
                CERTIFIÉ CONFORME
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                <span className="text-[11px] text-[#9B9A97] block">
                  Volume Total
                </span>
                <span className="text-base font-semibold font-mono text-[#EDEDEC] mt-0.5 block">
                  {formatBytes(certificate.totalBytes)}
                </span>
              </div>
              <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                <span className="text-[11px] text-[#9B9A97] block">
                  Fichiers Certifiés
                </span>
                <span className="text-base font-semibold font-mono text-[#34D399] mt-0.5 block">
                  {certificate.verifiedFiles} / {certificate.totalFiles}
                </span>
              </div>
              <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                <span className="text-[11px] text-[#9B9A97] block">
                  Débit Moyen
                </span>
                <span className="text-base font-semibold font-mono text-[#60A5FA] mt-0.5 block">
                  {certificate.avgSpeedMbS.toFixed(1)} Mo/s
                </span>
              </div>
              <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-3.5">
                <span className="text-[11px] text-[#9B9A97] block">
                  Durée Totale
                </span>
                <span className="text-base font-semibold font-mono text-[#EDEDEC] mt-0.5 block">
                  {certificate.durationSecs.toFixed(1)} s
                </span>
              </div>
            </div>

            <div className="bg-[#202020] border border-[#2F2F2F] rounded-xl p-4 flex items-center justify-between gap-4 text-xs">
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[#9B9A97] w-20 shrink-0">
                    Source :
                  </span>
                  <span className="font-mono text-[#EDEDEC] truncate">
                    {certificate.sourcePath}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#9B9A97] w-20 shrink-0">
                    Destination :
                  </span>
                  <span className="font-mono text-[#34D399] truncate">
                    {certificate.destinationPath}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onRevealInFinder(certificate.destinationPath)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2A2A2A] hover:bg-[#333333] border border-[#383838] text-[#EDEDEC] font-medium shrink-0 transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#34D399]" />
                <span>Voir dans le Finder</span>
              </button>
            </div>

            {certificate.corruptedVideos &&
            certificate.corruptedVideos.length > 0 ? (
              <div className="p-4 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#FBBF24] space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
                  <span>
                    Alerte Intégrité Vidéo ({certificate.corruptedVideos.length}{" "}
                    rush(s) non finalisé(s))
                  </span>
                </div>
                <p className="text-[11px] text-[#D1D5DB]">
                  Ces fichiers ont été transférés tels quels depuis la carte
                  mais leur atome MOOV est manquant (enregistrement interrompu
                  sur la caméra) :
                </p>
                <ul className="list-disc list-inside font-mono text-[11px] text-[#FCD34D] space-y-0.5">
                  {certificate.corruptedVideos.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/20 text-xs text-[#34D399] flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0" />
                <span>
                  Intégrité des conteneurs vidéo : 100% Validé (Tous conteneurs
                  finalisés avec atome MOOV)
                </span>
              </div>
            )}

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
  );
}
