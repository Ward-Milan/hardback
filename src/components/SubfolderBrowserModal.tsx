import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderTree,
  X,
} from "lucide-react";
import {
  computeResolvedSubfolderPaths,
  hasUncheckedSubfolderDescendant,
  isSubfolderNodeChecked,
  SubfolderModalState,
} from "../utils/subfolderTree";

interface SubfolderBrowserModalProps {
  modal: SubfolderModalState;
  onClose: () => void;
  onToggleExpand: (folderPath: string) => void;
  onToggleCheck: (folderPath: string, nextChecked: boolean) => void;
  onValidate: (
    resolvedPaths: string[],
    sourceIndex: number,
    rootFolderPath: string,
    rootFolderName: string
  ) => void;
}

export function SubfolderBrowserModal({
  modal,
  onClose,
  onToggleExpand,
  onToggleCheck,
  onValidate,
}: SubfolderBrowserModalProps) {
  const renderBranch = (parentPath: string, depth: number): React.ReactNode => {
    const items = modal.childrenByParent[parentPath] || [];
    return items.map((sub) => {
      const checked = isSubfolderNodeChecked(sub.path, modal.uncheckedPaths);
      const isPartial =
        checked && hasUncheckedSubfolderDescendant(sub.path, modal.uncheckedPaths);
      const isExpanded = modal.expandedPaths.includes(sub.path);

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
                  onClick={() => onToggleExpand(sub.path)}
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
                  onChange={(e) => onToggleCheck(sub.path, e.target.checked)}
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
                  onClick={() => onToggleExpand(sub.path)}
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

  const resolved = computeResolvedSubfolderPaths(modal);

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-[#202020] border border-[#333333] rounded-2xl max-w-lg w-full max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2F2F2F] flex items-center justify-between bg-[#252525]">
          <div>
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-[#60A5FA]" />
              <span className="font-semibold text-sm text-[#EDEDEC]">
                Arborescence de {modal.parentName}
              </span>
            </div>
            <p className="text-[11px] text-[#9B9A97] mt-0.5">
              Cliquez sur la flèche d&apos;un dossier pour déplier ses
              sous-dossiers.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#333333] text-[#9B9A97]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-1.5 flex-1">
          {renderBranch(modal.rootPath, 0)}
        </div>

        <div className="px-5 py-3 border-t border-[#2F2F2F] bg-[#252525] flex items-center justify-between">
          <span className="text-xs text-[#9B9A97]">
            {resolved.length} branche(s) sélectionnée(s)
          </span>
          <button
            disabled={resolved.length === 0}
            onClick={() =>
              onValidate(
                resolved,
                modal.sourceIndex,
                modal.rootPath,
                modal.parentName
              )
            }
            className="px-4 py-1.5 rounded-xl bg-[#EDEDEC] text-[#191919] font-semibold text-xs hover:bg-white disabled:opacity-40"
          >
            Valider la sélection
          </button>
        </div>
      </div>
    </div>
  );
}
