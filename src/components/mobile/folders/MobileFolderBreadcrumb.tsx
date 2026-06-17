import { Icon } from "@iconify/react";
import type { Folder } from "@/types";

/** Home / A / B breadcrumb. onNavigate(-1) = root; onNavigate(i) = that path index. */
export default function MobileFolderBreadcrumb({
  path, onNavigate,
}: { path: Folder[]; onNavigate: (index: number) => void }) {
  if (path.length === 0) return null;
  return (
    <div className="flex items-center gap-1 px-4 py-1.5 text-xs text-(--t-text-dim) overflow-x-auto shrink-0" data-folder-breadcrumb>
      <button className="shrink-0 active:text-(--t-text-primary)" onClick={() => onNavigate(-1)}>Home</button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1 shrink-0">
          <Icon icon="lucide:chevron-right" width={12} />
          <button
            className={i === path.length - 1 ? "text-(--t-text-primary) font-medium" : "active:text-(--t-text-primary)"}
            onClick={() => onNavigate(i)}
          >
            {f.name}
          </button>
        </span>
      ))}
    </div>
  );
}
