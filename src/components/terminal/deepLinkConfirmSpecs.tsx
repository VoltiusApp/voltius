import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { ConfirmIntent } from "@/services/deepLinkUrl";
import { joinTeamSessionAndOpenTab } from "@/services/teamSessionJoin";
import { searchUsers } from "@/services/teamService";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import type { InviteTarget } from "@/services/teamSharing";
import { fetchCatalog as fetchSnippetCatalog } from "@/services/snippetCatalogFetch";
import { installCatalogEntries } from "@/services/snippetCatalogInstall";
import { resolveInstallVault } from "@/services/import-export/storeAccess";
import type { CatalogEntry } from "@/services/snippetCatalog";
import { useVaultStore } from "@/stores/vaultStore";
import { PluginPermissionList } from "@/components/settings/sections/PluginPermissionList";
import { useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { pluginInstallErrorMessage, type TranslatableMessage } from "@/plugins/installErrors";
import type { PluginManifest } from "@/plugins/api";

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
   * Distinguishes failures that mean something specific to the user from the
   * generic `errorKey`, which it receives as the fallback. Returns a key rather
   * than translated text so the sheet can hold it across a locale change.
   * Absent means every failure reads the same.
   */
  errorMessage?: (e: unknown, fallbackKey: string) => TranslatableMessage;
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

export interface InviteLoad {
  target: InviteTarget | null;
  /** The local session this device can invite into, or null when there is none. */
  localSessionId: string | null;
}

export interface PluginInstallLoad {
  plugin: MarketplacePlugin;
  manifest: PluginManifest;
  /** The exact reviewed manifest text, handed to installPlugin so what was
   *  disclosed and what is loaded are the same bytes. */
  manifestText: string;
  sourceName: string;
}

export interface SnippetInstallLoad {
  entry: CatalogEntry;
  /** Resolved with the entry, not again at accept: the vault the sheet names is
   *  then provably the vault written to, however the selection moves while the
   *  sheet is open. */
  vault: { id: string; name: string };
}

/** What each route's `load` produces. `void` for a route with nothing to fetch. */
export interface ConfirmLoad {
  join: void;
  invite: InviteLoad;
  "snippet-install": SnippetInstallLoad;
  "plugin-install": PluginInstallLoad;
}

/**
 * The local session this device is currently sharing *and* still holds a per-user
 * session key for. An `invite_link` session keeps no such key, so inviting into
 * one would always throw `cannotInviteWithoutSessionKey`.
 */
function shareableSessionId(): string | null {
  const id = useSessionStore.getState().activeSessionId;
  if (!id) return null;
  return useTeamSessionStore.getState().connections[id]?.sessionKeyBytes ? id : null;
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
  invite: {
    icon: "lucide:user-plus",
    acceptLabelKey: "terminal.share.deepLinkInviteAction",
    errorKey: "terminal.share.deepLinkInviteFailed",
    load: async ({ handle }) => {
      const results = await searchUsers(handle);
      // Exact match only. A fuzzy hit would let `@kev` land on `@kevin-p`, which
      // is the impersonation shape the unified invite design set out to close.
      const match = results.find((user) => user.handle.toLowerCase() === handle);
      return {
        target: match ? { user_id: match.user_id, handle: match.handle } : null,
        localSessionId: shareableSessionId(),
      };
    },
    details: (intent, loaded, t) => ({
      title: t("terminal.share.deepLinkInviteTitle", { handle: intent.handle }),
      body: t("terminal.share.deepLinkInviteBody", { handle: intent.handle }),
      note: !loaded
        ? undefined
        : !loaded.target
          ? t("terminal.share.deepLinkInviteUnknownUser", { handle: intent.handle })
          : !loaded.localSessionId
            ? t("terminal.share.deepLinkInviteNoActiveSession")
            : undefined,
    }),
    canAccept: (loaded) => !!loaded?.target && !!loaded.localSessionId,
    accept: async (_intent, loaded) => {
      if (!loaded?.target || !loaded.localSessionId) return;
      await useTeamSessionStore.getState().inviteToActiveSession(loaded.localSessionId, loaded.target);
    },
  },
  "snippet-install": {
    icon: "lucide:scroll-text",
    acceptLabelKey: "snippets.deepLinkInstall.action",
    errorKey: "snippets.deepLinkInstall.failed",
    load: async ({ entryId }) => {
      const { entries } = await fetchSnippetCatalog();
      const entry = entries.find((candidate) => candidate.id === entryId);
      // Rejecting here is what leaves accept dead: a sheet that cannot name what
      // it would install must never be acceptable.
      if (!entry) throw new Error("snippet catalogue entry not found");
      // Read here rather than in `details` and again in `accept` — the store is
      // read directly since the spec is not a component, so two reads are two
      // answers whenever the selection moves while the sheet is open.
      return { entry, vault: resolveInstallVault(useVaultStore.getState()) };
    },
    details: (_intent, loaded, t) => ({
      title: t("snippets.deepLinkInstall.title"),
      body: t("snippets.deepLinkInstall.body"),
      note: loaded
        ? // Named on purpose: the install lands in whichever vault is selected, and a
          // link the user did not author should not quietly write into one they were
          // not thinking about.
          t("snippets.deepLinkInstall.destination", { vault: loaded.vault.name })
        : undefined,
    }),
    extra: (loaded, t) =>
      loaded ? (
        <p className="text-sm text-(--t-text-bright)">
          {t("snippets.deepLinkInstall.summary", {
            name: loaded.entry.name,
            author: loaded.entry.author ?? t("snippets.deepLinkInstall.unknownAuthor"),
            count: loaded.entry.snippets.length,
          })}
        </p>
      ) : null,
    accept: async (_intent, loaded) => {
      if (!loaded) return;
      await installCatalogEntries([{ entry: loaded.entry }], loaded.vault.id);
    },
  },
  "plugin-install": {
    icon: "lucide:puzzle",
    acceptLabelKey: "settings.plugins.deepLinkInstall.action",
    errorKey: "settings.plugins.deepLinkInstall.failed",
    // An integrity mismatch is the user's only tamper signal, so it must not be
    // reported as a link that did not work.
    errorMessage: pluginInstallErrorMessage,
    load: async ({ pluginId, sourceId }) => {
      await useMarketplaceStore.getState().loadSources();
      const source = useMarketplaceStore
        .getState()
        .sources.find((candidate) => candidate.id === sourceId && candidate.enabled);
      // A link can only point at a catalogue this device already trusts. Failing
      // here — before any fetch — is what stops a link introducing a code source.
      if (!source) throw new Error("unknown or disabled plugin source");

      await useMarketplaceStore.getState().fetchCatalog();
      const plugin = useMarketplaceStore
        .getState()
        .catalog.find((candidate) => candidate.id === pluginId && candidate.sourceId === sourceId);
      if (!plugin) throw new Error("plugin not listed by that source");

      const { manifest, manifestText } = await useMarketplaceStore.getState().fetchManifest(plugin);
      return { plugin, manifest, manifestText, sourceName: source.name };
    },
    details: (_intent, loaded, t) => ({
      title: t("settings.plugins.deepLinkInstall.title"),
      body: t("settings.plugins.deepLinkInstall.body"),
      note: loaded ? t("settings.plugins.deepLinkInstall.source", { source: loaded.sourceName }) : undefined,
    }),
    extra: (loaded, t) =>
      loaded ? (
        <>
          <p className="text-sm text-(--t-text-bright)">
            {t("settings.plugins.deepLinkInstall.summary", {
              name: loaded.plugin.name,
              author: loaded.plugin.author,
              version: loaded.plugin.version,
            })}
          </p>
          {/* The permission list is carried here rather than chaining to
              PluginPermissionModal: two consecutive consent dialogs for one click
              train the user to click through both. */}
          <PluginPermissionList permissions={loaded.manifest.permissions ?? []} />
        </>
      ) : null,
    accept: async (_intent, loaded) => {
      if (!loaded) return;
      await useMarketplaceStore.getState().installPlugin(loaded.plugin, loaded.manifestText);
    },
  },
};
