import { SubfolderEntry } from "../types";

export interface SubfolderModalState {
  sourceIndex: number;
  rootPath: string;
  parentName: string;
  childrenByParent: Record<string, SubfolderEntry[]>;
  expandedPaths: string[];
  uncheckedPaths: string[];
}

export function isSubfolderNodeChecked(
  folderPath: string,
  uncheckedPaths: string[]
): boolean {
  return !uncheckedPaths.some(
    (u) => folderPath === u || folderPath.startsWith(u + "/")
  );
}

export function hasUncheckedSubfolderDescendant(
  folderPath: string,
  uncheckedPaths: string[]
): boolean {
  return uncheckedPaths.some((u) => u.startsWith(folderPath + "/"));
}

export function computeResolvedSubfolderPaths(
  modal: SubfolderModalState
): string[] {
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
}
