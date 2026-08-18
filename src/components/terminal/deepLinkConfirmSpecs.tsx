import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { ConfirmIntent } from "@/services/deepLinkUrl";
import { joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";

export type ConfirmRoute = ConfirmIntent["route"];
type IntentOf<K extends ConfirmRoute> = Extract<ConfirmIntent, { route: K }>;

export interface ConfirmDetails {
  title: string;
  body: string;
  /** Dim line under the body: what the link cannot tell us, or why accept is off. */
  note?: string;
}

export interface ConfirmSpec<K extends ConfirmRoute, L> {
  icon: string;
  acceptLabelKey: string;
  errorKey: string;
  /**
   * Resolves what the link names. Omitted where the intent already says
   * everything, so such a sheet paints complete in its first frame rather than
   * flashing a spinner over copy it already has.
   */
  load?: (intent: IntentOf<K>) => Promise<L>;
  details: (intent: IntentOf<K>, loaded: L | null, t: TFunction) => ConfirmDetails;
  extra?: (loaded: L | null, t: TFunction) => ReactNode;
  /** Guards accept on what `load` found. Absent means "acceptable once loaded". */
  canAccept?: (loaded: L | null) => boolean;
  accept: (intent: IntentOf<K>, loaded: L | null, t: TFunction) => Promise<void>;
}

/** What each route's `load` produces. `void` for a route with nothing to fetch. */
export interface ConfirmLoad {
  join: void;
}

export const CONFIRM_SPECS: { [K in ConfirmRoute]: ConfirmSpec<K, ConfirmLoad[K]> } = {
  join: {
    icon: "lucide:users",
    acceptLabelKey: "terminal.share.deepLinkJoinAction",
    errorKey: "terminal.share.deepLinkJoinFailed",
    details: (_intent, _loaded, t) => ({
      title: t("terminal.share.deepLinkJoinTitle"),
      body: t("terminal.share.deepLinkJoinBody"),
      // The link carries no host name, so naming one would mean inventing it.
      note: t("terminal.share.deepLinkJoinUnknownHost"),
    }),
    accept: async (intent, _loaded, t) => {
      await joinTeamSessionAndOpenTab({
        sessionId: intent.sessionId,
        connectionName: t("hosts.teamSessions.sharedTerminalFallback"),
        inviteToken: intent.token,
      });
    },
  },
};
