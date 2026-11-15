import { create } from "zustand";
import type { PreviewDraft, PreviewResponse } from "@/services/permissionPreview";
import type { PreviewSession } from "@/services/previewSnapshot";
import type { TeamObjectType } from "@/services/teamObjects";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";

export type { PreviewSession };

export type SidePanel = { kind: "access" } | { kind: "why"; type: TeamObjectType; objectId: string } | null;
export type SaveConfirm = "memberKeyLoss" | "roleKeyLoss";

interface PreviewState {
  session: PreviewSession | null;
  draft: PreviewDraft | null;
  result: PreviewResponse | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  side: SidePanel;
  saving: boolean;
  saveError: string | null;
  pendingConfirm: SaveConfirm | null;
  enter: (session: PreviewSession) => void;
  exit: () => void;
  setDraft: (draft: PreviewDraft | null) => void;
  refetch: () => Promise<void>;
  showWhy: (type: TeamObjectType, objectId: string) => void;
  showAccess: () => void;
  closeSide: () => void;
  requestSave: () => Promise<void>;
  confirmSave: () => Promise<void>;
  cancelSave: () => void;
  save: () => Promise<void>;
}

const IDLE = {
  session: null, draft: null, result: null, status: "idle", error: null, side: null,
  saving: false, saveError: null, pendingConfirm: null,
} as const satisfies Partial<PreviewState>;

const DRAFT_DEBOUNCE_MS = 250;

const ENDING_KEY: Record<number, string> = {
  404: "members.viewAs.ended",
  403: "members.viewAs.ended",
  402: "members.viewAs.needsBusiness",
};

export function saveNeedsConfirm(result: PreviewResponse | null): SaveConfirm | null {
  if (!result) return null;
  if (result.current.holds_vault_key_gate && result.draft && !result.draft.holds_vault_key_gate) return "memberKeyLoss";
  if (result.affected?.lose_vault_key.length) return "roleKeyLoss";
  return null;
}

let unwatch: (() => void)[] = [];
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let sentSeq = 0;
let appliedSeq = 0;

// Dynamic imports: usePermissions loads this store, and its consumers must not pull in i18n, sync or key rotation.
function watchSession(session: PreviewSession): (() => void)[] {
  const { teamId, vaultId } = session;
  const exit = () => usePreviewStore.getState().exit();
  const refetch = () => void usePreviewStore.getState().refetch();
  void import("@/services/sync").then(({ onTeamSseEvent }) => {
    if (usePreviewStore.getState().session !== session) return;
    unwatch.push(onTeamSseEvent((id) => { if (id === teamId) refetch(); }));
  });
  return [
    useVaultStore.subscribe(({ selectedVaultIds: ids }) => {
      if (ids.length !== 1 || ids[0] !== vaultId) exit();
    }),
    useUIStore.subscribe((s) => {
      if (s.homeView || s.activeNav === "terminal" || s.sftpPanelOpen || s.settingsOpen) exit();
    }),
    useTeamStore.subscribe((s, prev) => {
      if (!s.teams.some((t) => t.id === teamId)) exit();
      else if (s.membersByTeam[teamId] !== prev.membersByTeam[teamId] || s.rolesByTeam[teamId] !== prev.rolesByTeam[teamId]) refetch();
    }),
  ];
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  ...IDLE,

  enter: (session) => {
    get().exit();
    useVaultClipboardStore.getState().clear();
    useVaultStore.getState().selectVaultOnly(session.vaultId);
    useUIStore.getState().setSftpPanelOpen(false);
    set({ session, side: { kind: "access" } });
    unwatch = watchSession(session);
    void get().refetch();
  },

  exit: () => {
    if (!get().session) return;
    unwatch.forEach((stop) => stop());
    unwatch = [];
    clearTimeout(draftTimer);
    appliedSeq = sentSeq;
    set(IDLE);
  },

  setDraft: (draft) => {
    if (!get().session) return;
    set({ draft });
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void get().refetch(), DRAFT_DEBOUNCE_MS);
  },

  refetch: async () => {
    const { session, draft } = get();
    if (!session) return;
    const seq = ++sentSeq;
    set({ status: "loading" });
    const settle = () => {
      if (seq <= appliedSeq || get().session !== session) return false;
      appliedSeq = seq;
      return true;
    };
    try {
      const { previewPermissions } = await import("@/services/permissionPreview");
      const result = await previewPermissions(session.teamId, { subject: session.subject, ...(draft && { draft }) });
      if (settle()) set({ result, status: seq === sentSeq ? "ready" : "loading", error: null });
    } catch (e) {
      if (!settle()) return;
      const ending = ENDING_KEY[(e as { status?: number }).status ?? 0];
      if (!ending) {
        set({ status: "error", error: e instanceof Error ? e.message : String(e) });
        return;
      }
      get().exit();
      const { default: i18n } = await import("@/i18n");
      useNotificationStore.getState().addToast({
        source: APP_SOURCE, type: "toast", message: i18n.t(ending), severity: "warning", duration: 5000,
      });
    }
  },

  showWhy: (type, objectId) => set({ side: { kind: "why", type, objectId } }),
  showAccess: () => set({ side: { kind: "access" } }),
  closeSide: () => set({ side: null }),

  requestSave: async () => {
    const confirm = saveNeedsConfirm(get().result);
    if (confirm) set({ pendingConfirm: confirm });
    else await get().save();
  },

  confirmSave: async () => {
    const teamId = get().session?.teamId;
    set({ pendingConfirm: null });
    await get().save();
    if (!teamId) return;
    const { checkAndRotateTeamKey } = await import("@/services/teamKeyRotation");
    await checkAndRotateTeamKey(teamId);
  },

  cancelSave: () => set({ pendingConfirm: null }),

  save: async () => {},
}));

export const isPreviewing = (): boolean => usePreviewStore.getState().session !== null;
