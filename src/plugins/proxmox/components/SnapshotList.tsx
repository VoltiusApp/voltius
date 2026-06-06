import { useState } from "react";
import { Icon } from "@iconify/react";
import {
  proxmoxLxcSnapshotCreate,
  proxmoxLxcSnapshotDelete,
  proxmoxLxcSnapshotRollback,
} from "../services";
import { getProxmoxApi } from "../runtime";
import type { LxcSnapshot } from "../types";

interface Props {
  vmid: number;
  vmName: string;
  snapshots: LxcSnapshot[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  snapshotInput: string;
  snapshotInputDesc: string;
  onSnapshotInputChange: (v: string) => void;
  onSnapshotDescChange: (v: string) => void;
  onBack: () => void;
  onRefresh: () => void;
}

export function SnapshotList({
  vmid,
  vmName,
  snapshots,
  sessionId,
  isRemote,
  localShell,
  snapshotInput,
  snapshotInputDesc,
  onSnapshotInputChange,
  onSnapshotDescChange,
  onBack,
  onRefresh,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [busySnap, setBusySnap] = useState<string | null>(null);

  const create = async () => {
    const name = snapshotInput.trim();
    if (!name) return;
    setCreating(true);
    try {
      await proxmoxLxcSnapshotCreate(
        sessionId,
        isRemote,
        localShell,
        vmid,
        name,
        snapshotInputDesc.trim() || null,
      );
      onSnapshotInputChange("");
      onSnapshotDescChange("");
      onRefresh();
    } catch (e) {
      getProxmoxApi()?.notifications.toast(`Snapshot failed: ${e}`, { severity: "error" });
    } finally {
      setCreating(false);
    }
  };

  const rollback = async (snapname: string) => {
    setBusySnap(snapname);
    try {
      await proxmoxLxcSnapshotRollback(sessionId, isRemote, localShell, vmid, snapname);
      onRefresh();
    } catch (e) {
      getProxmoxApi()?.notifications.toast(`Rollback failed: ${e}`, { severity: "error" });
    } finally {
      setBusySnap(null);
    }
  };

  const del = async (snapname: string) => {
    setBusySnap(snapname);
    try {
      await proxmoxLxcSnapshotDelete(sessionId, isRemote, localShell, vmid, snapname);
      onRefresh();
    } catch (e) {
      getProxmoxApi()?.notifications.toast(`Delete failed: ${e}`, { severity: "error" });
    } finally {
      setBusySnap(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-(--t-border) shrink-0">
        <button
          onClick={onBack}
          className="p-1 text-(--t-text-muted) hover:text-(--t-text) rounded-sm hover:bg-(--t-bg-card-hover)"
        >
          <Icon icon="lucide:arrow-left" width={12} />
        </button>
        <span className="text-[11px] font-medium text-(--t-text) truncate">
          CT {vmid} — {vmName}
        </span>
      </div>

      {/* Create form */}
      <div className="flex flex-col gap-1 px-3 py-2 border-b border-(--t-border) shrink-0">
        <div className="flex gap-1">
          <input
            type="text"
            value={snapshotInput}
            onChange={(e) => onSnapshotInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="Snapshot name"
            className="flex-1 min-w-0 bg-(--t-bg-input) border border-(--t-border) rounded-sm px-2 py-0.5 text-[10px] text-(--t-text) placeholder:text-(--t-text-muted) outline-hidden focus:border-(--t-accent)"
          />
          <button
            onClick={create}
            disabled={creating || !snapshotInput.trim()}
            title="Create snapshot"
            className="px-2 py-0.5 rounded-sm border border-(--t-border) text-[10px] text-(--t-text-muted) hover:bg-(--t-bg-hover) hover:text-(--t-text) disabled:opacity-40"
          >
            {creating ? <Icon icon="lucide:loader-circle" width={11} className="animate-spin" /> : "+"}
          </button>
        </div>
        <input
          type="text"
          value={snapshotInputDesc}
          onChange={(e) => onSnapshotDescChange(e.target.value)}
          placeholder="Description (optional)"
          className="bg-(--t-bg-input) border border-(--t-border) rounded-sm px-2 py-0.5 text-[10px] text-(--t-text) placeholder:text-(--t-text-muted) outline-hidden focus:border-(--t-accent)"
        />
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="flex items-center justify-center h-16 opacity-40">
            <p className="text-[11px] text-(--t-text-muted)">No snapshots</p>
          </div>
        ) : (
          snapshots.map((snap) => (
            <div
              key={snap.name}
              className="flex items-center gap-2 px-3 py-1.5 border-b border-(--t-border) last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[11px] truncate ${snap.is_current ? "font-semibold text-(--t-text)" : "text-(--t-text)"}`}
                  >
                    {snap.name}
                  </span>
                  {snap.is_current && (
                    <span className="text-[9px] px-1 rounded-sm bg-(--t-accent) text-white shrink-0">here</span>
                  )}
                </div>
                {snap.timestamp && (
                  <p className="text-[10px] text-(--t-text-muted) truncate">{snap.timestamp}</p>
                )}
                {snap.description && (
                  <p className="text-[10px] text-(--t-text-muted) truncate">{snap.description}</p>
                )}
              </div>
              {!snap.is_current && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => rollback(snap.name)}
                    disabled={busySnap !== null}
                    title="Rollback to this snapshot"
                    className="p-1 rounded-sm hover:bg-(--t-bg-card-hover) text-(--t-text-muted) hover:text-(--t-text) disabled:opacity-40"
                  >
                    <Icon icon="lucide:history" width={11} />
                  </button>
                  <button
                    onClick={() => del(snap.name)}
                    disabled={busySnap !== null}
                    title="Delete snapshot"
                    className="p-1 rounded-sm hover:bg-(--t-bg-card-hover) text-(--t-status-error) opacity-60 hover:opacity-100 disabled:opacity-40"
                  >
                    <Icon icon="lucide:trash-2" width={11} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
