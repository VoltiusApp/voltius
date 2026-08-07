import { Icon } from "@iconify/react";
import type { Folder } from "@/types";

/** The trail back out of a folder: a root link, then one crumb per ancestor. */
export function FolderBreadcrumb({ path, rootLabel, onNavigateToRoot, onNavigateTo }: {
  path: Folder[];
  rootLabel: string;
  onNavigateToRoot: () => void;
  /** Index into `path` of the crumb clicked. */
  onNavigateTo: (index: number) => void;
}) {
  if (path.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        className="flex items-center gap-1.5 text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
        onClick={onNavigateToRoot}
      >
        <Icon icon="lucide:chevron-left" width={13} />
        {rootLabel}
      </button>
      {path.map((folder, i) => (
        <span key={folder.id} className="flex items-center gap-2">
          <span className="text-(--t-text-dim)">/</span>
          {i < path.length - 1 ? (
            <button
              className="text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
              onClick={() => onNavigateTo(i)}
            >
              {folder.name}
            </button>
          ) : (
            <span className="text-xs font-medium text-(--t-text-primary)">{folder.name}</span>
          )}
        </span>
      ))}
    </div>
  );
}
