import { useState } from "react";
import {
  Bell,
  CheckCircle2,
  FolderTree,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { AppSettings } from "../types";

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => void;
  onClose: () => void;
}

const HASH_OPTIONS: Array<{
  id: NonNullable<AppSettings["hashAlgorithm"]>;
  label: string;
  badge: string;
  badgeColor: string;
  subtitle: string;
  title: string;
}> = [
  {
    id: "xxh64",
    label: "XXH64",
    badge: "Défaut (Rapide)",
    badgeColor: "text-[#60A5FA]",
    subtitle: "Recommandé",
    title: "xxHash 64-bit : Algorithme ultra-rapide recommandé par défaut",
  },
  {
    id: "xxh3",
    label: "XXH3",
    badge: "Turbo CPU",
    badgeColor: "text-[#34D399]",
    subtitle: "Apple Silicon SIMD",
    title: "xxHash 3 : Performance maximale avec instructions vectorisées SIMD",
  },
  {
    id: "md5",
    label: "MD5",
    badge: "Broadcast",
    badgeColor: "text-[#F59E0B]",
    subtitle: "Norme TV & PAD",
    title: "MD5 : Standard contractuel exigé en régie broadcast, TV et PAD",
  },
  {
    id: "sha256",
    label: "SHA-256",
    badge: "Cinéma",
    badgeColor: "text-[#A78BFA]",
    subtitle: "Norme Netflix / Longs",
    title:
      "SHA-256 : Standard cryptographique haute sécurité pour Netflix, longs-métrages et archives",
  },
];

export function SettingsModal({
  settings,
  onUpdateSetting,
  onClose,
}: SettingsModalProps) {
  const [settingsTab, setSettingsTab] = useState<
    "speed" | "files" | "automation"
  >("speed");

  const activeHash = settings.hashAlgorithm || "xxh64";

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-[#202020] border border-[#333333] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2F2F2F] flex items-center justify-between bg-[#252525]">
          <div className="flex items-center gap-2.5">
            <Settings className="w-4 h-4 text-[#EDEDEC]" />
            <span className="font-semibold text-sm text-[#EDEDEC]">
              Paramètres de Configuration
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center px-6 border-b border-[#2F2F2F] bg-[#1E1E1E] gap-2">
          <button
            type="button"
            onClick={() => setSettingsTab("speed")}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              settingsTab === "speed"
                ? "border-[#3B82F6] text-[#60A5FA]"
                : "border-transparent text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Copie & Intégrité</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsTab("files")}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              settingsTab === "files"
                ? "border-[#10B981] text-[#34D399]"
                : "border-transparent text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Arborescence & Fichiers</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsTab("automation")}
            className={`py-3 px-3.5 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              settingsTab === "automation"
                ? "border-[#F59E0B] text-[#FBBF24]"
                : "border-transparent text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Rapports & Confort</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 text-xs">
          {settingsTab === "speed" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] space-y-3">
                <div>
                  <div className="font-semibold text-[#EDEDEC] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>Moteur mathématique d'empreinte (Hash)</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#3B82F6]/15 text-[#60A5FA] font-medium uppercase tracking-wide">
                        {activeHash.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <p className="text-[#9B9A97] mt-1 leading-relaxed">
                    Sélectionnez l'algorithme bit-à-bit utilisé pour certifier
                    l'intégrité physique de vos copies et générer les manifestes
                    MHL / ASC-MHL.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {HASH_OPTIONS.map((opt) => {
                    const selected = activeHash === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => onUpdateSetting("hashAlgorithm", opt.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          selected
                            ? "bg-[#3B82F6]/15 border-[#3B82F6] text-white shadow-sm"
                            : "bg-[#222222] border-[#333333] text-[#9B9A97] hover:text-[#EDEDEC] hover:border-[#444444]"
                        }`}
                        title={opt.title}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-[#EDEDEC]">
                            {opt.label}
                          </span>
                          {selected && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                          )}
                        </div>
                        <div
                          className={`text-[10px] ${opt.badgeColor} font-medium mt-0.5`}
                        >
                          {opt.badge}
                        </div>
                        <div className="text-[9px] text-[#888888] mt-1 leading-tight">
                          {opt.subtitle}
                        </div>
                      </button>
                    );
                  })}
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
                    Traite jusqu'à 16 fichiers simultanément en mémoire vive
                    pour saturer le bus Thunderbolt et accélérer les cartes
                    contenant de nombreux fichiers.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.turboIo}
                  onChange={(e) => onUpdateSetting("turboIo", e.target.checked)}
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
                    En copie multi-cibles, décharge d'abord à vitesse maximale
                    vers le premier disque rapide (SSD NVMe) pour libérer votre
                    carte au plus vite, puis réplique vers les disques
                    secondaires.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.smartCascading}
                  onChange={(e) =>
                    onUpdateSetting("smartCascading", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                    <span>
                      Vérification rapide (Sans relecture physique du disque
                      cible)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#FBBF24]">
                      Vitesse ×2
                    </span>
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Calcule l'empreinte mathématique uniquement pendant la
                    lecture des flux sans relire physiquement les secteurs du
                    disque cible après écriture.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.fastInlineVerifyOnly}
                  onChange={(e) =>
                    onUpdateSetting("fastInlineVerifyOnly", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#3B82F6]"
                />
              </label>
            </div>
          )}

          {settingsTab === "files" && (
            <div className="space-y-4 animate-fadeIn">
              <div className="p-3.5 rounded-xl bg-[#10B981]/10 border border-[#10B981]/25 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-[#34D399]">
                    Copie Conforme 1:1 (Par Défaut)
                  </span>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Hardback préserve l'arborescence exacte de votre source et
                    copie 100% de vos fichiers sans aucun tri ni exclusion. Les
                    options ci-dessous sont entièrement facultatives.
                  </p>
                </div>
              </div>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                    <span>
                      Ranger automatiquement par type (Vidéos / Photos / Audio)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-[#9B9A97]">
                      Désactivé par défaut
                    </span>
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Si activé, classe automatiquement les fichiers dans des
                    sous-dossiers Videos/, Photos/, Audio/ selon leur format, au
                    lieu de conserver les dossiers d'origine.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.sortByMediaType}
                  onChange={(e) =>
                    onUpdateSetting("sortByMediaType", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                    <span>
                      Ignorer les fichiers système (.DS_Store, Thumbs.db, ._*)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-[#9B9A97]">
                      Désactivé par défaut
                    </span>
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Laissez désactivé pour copier rigoureusement chaque octet de
                    votre support sans omettre les fichiers système ou cachés.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.ignoreJunkFiles}
                  onChange={(e) =>
                    onUpdateSetting("ignoreJunkFiles", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC] flex items-center gap-2">
                    <span>
                      Ignorer les proxies & aperçus caméra (.LRV, .THM)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2A2A2A] text-[#9B9A97]">
                      Désactivé par défaut
                    </span>
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Si activé, omet les miniatures et vidéos basse résolution
                    créées par les caméras GoPro, DJI ou drones pour économiser
                    l'espace disque.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.ignoreCameraProxies}
                  onChange={(e) =>
                    onUpdateSetting("ignoreCameraProxies", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#10B981]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#EF4444]/25 cursor-pointer hover:border-[#EF4444]/45">
                <div>
                  <div className="font-semibold text-[#FCA5A5] flex items-center gap-2">
                    <span>
                      Mode Déplacement (Vider la source après vérification)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EF4444]/15 text-[#EF4444] font-medium">
                      Sensible
                    </span>
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Supprime les fichiers de la carte source UNIQUEMENT lorsque
                    100 % des copies sur toutes les destinations cibles sont
                    certifiées bit-à-bit sans aucune erreur.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.moveModeDeleteSource}
                  onChange={(e) =>
                    onUpdateSetting("moveModeDeleteSource", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#EF4444]"
                />
              </label>
            </div>
          )}

          {settingsTab === "automation" && (
            <div className="space-y-4 animate-fadeIn">
              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC]">
                    Éjecter automatiquement la carte SD en fin de transfert
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Démonte proprement la carte SD dès que 100 % des fichiers
                    sont copiés et certifiés, pour que vous puissiez la retirer
                    en toute sécurité sans passer par le Finder.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoEjectSource}
                  onChange={(e) =>
                    onUpdateSetting("autoEjectSource", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC]">
                    Notifications bannières macOS & alerte sonore
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Affiche une bannière système macOS et joue un carillon
                    discret lorsqu'un transfert se termine en arrière-plan.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.soundNotification}
                  onChange={(e) =>
                    onUpdateSetting("soundNotification", e.target.checked)
                  }
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
                    Démarre discrètement Hardback dans la barre des menus à
                    l'ouverture de votre session macOS, sans ouvrir la fenêtre
                    principale.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(settings.launchAtStartup)}
                  onChange={(e) =>
                    onUpdateSetting("launchAtStartup", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                />
              </label>

              <label className="flex items-start justify-between gap-4 p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] cursor-pointer hover:border-[#3E3E3E]">
                <div>
                  <div className="font-semibold text-[#EDEDEC]">
                    Écrire aussi les rapports (.txt / .mhl) sur le disque de
                    destination
                  </div>
                  <p className="text-[#9B9A97] mt-0.5 leading-relaxed">
                    Génère les fichiers de manifestes MHL et rapports texte
                    directement à la racine de la copie sur vos disques
                    externes.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.writeReportsOnDisk}
                  onChange={(e) =>
                    onUpdateSetting("writeReportsOnDisk", e.target.checked)
                  }
                  className="mt-1 rounded border-[#383838] bg-[#262626] text-[#F59E0B]"
                />
              </label>

              <div className="p-3.5 rounded-xl bg-[#191919] border border-[#2F2F2F] space-y-2">
                <div className="font-semibold text-[#EDEDEC]">
                  Webhook de Notification Distante (Discord / Slack / API)
                </div>
                <p className="text-[#9B9A97] leading-relaxed">
                  URL HTTP appelée en fin de transfert avec le rapport de
                  vérification au format JSON.
                </p>
                <input
                  type="text"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={settings.webhookUrl || ""}
                  onChange={(e) =>
                    onUpdateSetting("webhookUrl", e.target.value)
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-[#242424] border border-[#383838] text-xs text-[#EDEDEC] focus:border-[#F59E0B] outline-none"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#141414] border border-[#262626] space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#9B9A97]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Cadre d&apos;Utilisation &amp; Responsabilité</span>
                </div>
                <p className="text-[11px] text-[#787774] leading-relaxed">
                  Hardback est un utilitaire de déchargement et vérification
                  broadcast open-source (Licence MIT). La copie sécurisée et la
                  vérification d&apos;intégrité s&apos;exécutent localement sur
                  votre matériel. L&apos;utilisateur demeure responsable du
                  contrôle de ses copies et de la préservation de ses médias
                  originaux.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-[#2F2F2F] bg-[#252525] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-[#EDEDEC] text-[#191919] font-semibold text-xs hover:bg-white transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
