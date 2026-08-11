import { useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";

/** Prune state shared by the image, network and volume lists. */
export function usePrune(run: () => Promise<string>, onRefresh: () => void) {
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const prune = async () => {
    setPruning(true);
    setMessage(null);
    try {
      setMessage(await run());
      onRefresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setPruning(false);
    }
  };

  return { pruning, message, prune };
}

/** A row action that disables itself while it runs and refreshes only on success.
 *  One busy flag covers every button on the row, which is what a container row
 *  wants: starting it must disable stop, restart and the rest too. */
export function useRowAction<A extends unknown[]>(
  run: (...args: A) => Promise<void>,
  onRefresh: () => void,
  label: string,
) {
  const [busy, setBusy] = useState(false);

  const act = async (...args: A) => {
    setBusy(true);
    try {
      await run(...args);
      onRefresh();
    } catch (e) {
      console.error(`[docker] ${label} failed:`, e);
    } finally {
      setBusy(false);
    }
  };

  return { busy, act };
}

interface Props {
  count: number;
  /** Plural resource name shown beside the count: "images", "networks", "volumes". */
  noun: string;
  emptyLabel: string;
  prune: ReturnType<typeof usePrune>;
  /** Extra toolbar content: the count suffix and any action left of prune. */
  countSuffix?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** The chrome every docker resource list wears: a count-and-prune toolbar, the
 *  prune result line, and a scrolling body with an empty state. */
export function ResourceList({
  count,
  noun,
  emptyLabel,
  prune,
  countSuffix,
  actions,
  children,
}: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b border-(--t-border) shrink-0">
        <span className="text-[10px] text-(--t-text-muted)">
          {count} {noun}
          {countSuffix}
        </span>
        <div className="flex items-center gap-1">
          {actions}
          <button
            onClick={prune.prune}
            disabled={prune.pruning}
            className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm text-(--t-status-warning) hover:bg-(--t-bg-hover) disabled:opacity-40"
          >
            <Icon icon="lucide:trash" width={10} />
            {prune.pruning ? "pruning…" : "prune"}
          </button>
        </div>
      </div>

      {prune.message && (
        <p className="px-3 py-1 text-[10px] text-(--t-text-muted) border-b border-(--t-border)">
          {prune.message}
        </p>
      )}

      <div className="overflow-y-auto flex-1">
        {count === 0 ? (
          <div className="flex items-center justify-center h-20 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">{emptyLabel}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** The row shell of the simple resource lists: two stacked labels, optional
 *  trailing text, and a remove button that appears on hover. */
export function ResourceRow({
  title,
  subtitle,
  trailing,
  removeTitle,
  onRemove,
  onRefresh,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
  removeTitle: string;
  onRemove: () => Promise<void>;
  onRefresh: () => void;
}) {
  const { busy, act } = useRowAction(onRemove, onRefresh, removeTitle.toLowerCase());

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-(--t-border) last:border-0 hover:bg-(--t-bg-hover) group">
      <div className="flex-1 min-w-0">
        {title}
        {subtitle}
      </div>
      {trailing}
      <button
        disabled={busy}
        onClick={act}
        title={removeTitle}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-(--t-status-error) opacity-60 hover:opacity-100 disabled:opacity-40 shrink-0"
      >
        <Icon icon="lucide:trash-2" width={11} />
      </button>
    </div>
  );
}
