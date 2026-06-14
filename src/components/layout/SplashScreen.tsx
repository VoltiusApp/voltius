import { useState, useEffect } from "react";
import { getVaultStatus } from "@/services/vault";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { autoLogin, consumeForceLockFlag, isServerMode } from "@/services/account";
import { saveCurrentAccount } from "@/services/savedAccounts";
import { syncOnLogin, syncOnLoginReplace, startRealtimeSync } from "@/services/sync";
import { loadPlugin, setLoginSyncPending, resolveLoginSync } from "@/plugins/runtime";
import { BUNDLED_PLUGINS } from "@/plugins/bundled";
import { loadInstalledPlugins } from "@/stores/marketplaceStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { useThemeStore } from "@/stores/themeStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import AuthPage from "./AuthPage";
import LogoBadge from "./LogoBadge";

type Phase = "loading" | "auth-first-launch" | "auth-locked" | "finishing" | "done";
type StepStatus = "pending" | "running" | "done" | "error";

interface Step { id: string; label: string; status: StepStatus; }
interface Props { onReady: () => void; }

const INITIAL_STEPS: Step[] = [
  { id: "init",        label: "Initializing app",    status: "pending" },
  { id: "vault",       label: "Checking vault",      status: "pending" },
  { id: "connections", label: "Loading connections",  status: "pending" },
];

export default function SplashScreen({ onReady }: Props) {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [phase, setPhase] = useState<Phase>("loading");
  const [exiting, setExiting] = useState(false);

  const setStep = (id: string, status: StepStatus, label?: string) =>
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, status, ...(label ? { label } : {}) } : s));

  useEffect(() => {
    async function init() {
      setStep("init", "running");
      await delay(300);
      setStep("init", "done");

      setStep("vault", "running");
      await delay(200);

      if (consumeForceLockFlag()) {
        try {
          const { exists } = await getVaultStatus();
          setStep("vault", "done", exists ? "Vault locked" : "First launch");
          setPhase(exists ? "auth-locked" : "auth-first-launch");
        } catch {
          setStep("vault", "error", "Vault check failed");
          setPhase("auth-first-launch");
        }
        return;
      }

      const autoOk = await autoLogin();
      if (autoOk) {
        setStep("vault", "done", "Session restored");
        setPhase("finishing");
        saveCurrentAccount().catch(() => {}); // keep saved accounts list fresh
        await finishLoading();
        return;
      }

      // autoLogin failed — check if a vault already exists (locked) or first launch
      try {
        const { exists } = await getVaultStatus();
        setStep("vault", "done", exists ? "Vault found" : "First launch");
        setPhase(exists ? "auth-locked" : "auth-first-launch");
      } catch {
        setStep("vault", "error", "Vault check failed");
        setPhase("auth-first-launch");
      }
    }
    init().catch(() => {
      // Last-resort guard: never let an unexpected rejection freeze the splash.
      setStep("vault", "error", "Vault check failed");
      setPhase("auth-first-launch");
    });
  }, []);

  const finishLoading = async () => {
    setStep("connections", "running");
    await delay(150);
    try {
      await Promise.all([
        // Populate stores from local cache so tabs paint at boot, before sync lands.
        useConnectionStore.getState().loadConnections(),
        useIdentityStore.getState().loadIdentities(),
        useKeyStore.getState().loadKeys(),
        useFolderStore.getState().loadFolders(),
        useSnippetStore.getState().loadSnippets(),
        useSnippetFolderStore.getState().loadFolders(),
        usePortForwardingStore.getState().loadRules(),
      ]);
      setStep("connections", "done");
    } catch {
      setStep("connections", "error", "Connections unavailable");
    }
    useSubscriptionStore.getState().load().catch(() => {});
    isServerMode().then((server) => {
      if (!server) return;
      const useReplace = sessionStorage.getItem("voltius.replace-sync-on-login") === "1";
      if (useReplace) sessionStorage.removeItem("voltius.replace-sync-on-login");
      // Gate plugins behind this promise so they see post-merge data.
      // vault_reset (logout) wipes the config dir including plugin storage,
      // so plugins must not run their initial sync before server data lands.
      setLoginSyncPending();
      (useReplace ? syncOnLoginReplace() : syncOnLogin())
        .catch(() => {})
        .finally(() => resolveLoginSync());
      startRealtimeSync();
    });
    useThemeStore.getState().loadFromDisk().catch(() => {});
    // Plugin loading must never freeze startup: a single rejected invoke here
    // (e.g. a storage command failing on a locked-down platform) would leave the
    // splash spinning forever. Swallow and continue to the main UI.
    try {
      await usePluginRegistryStore.getState().load();
      const { isEnabled } = usePluginRegistryStore.getState();
      for (const plugin of BUNDLED_PLUGINS) {
        const active = isEnabled(plugin.manifest.id, plugin.manifest.defaultEnabled ?? true);
        loadPlugin(plugin.manifest, plugin.register, active);
      }
      await loadInstalledPlugins();
    } catch (e) {
      console.warn("[splash] plugin loading failed, continuing to app:", e);
    }
    await delay(400);
    setExiting(true);
    await delay(400);
    onReady();
  };

  const handleAuthReady = async () => {
    setPhase("finishing");
    saveCurrentAccount().catch(() => {}); // keep saved accounts list fresh
    await finishLoading();
  };

  if (phase === "auth-first-launch") return <AuthPage isLocked={false} onReady={handleAuthReady} />;
  if (phase === "auth-locked") return <AuthPage isLocked={true} onReady={handleAuthReady} />;

  return (
    <div
      className={`h-full w-full flex flex-col items-center justify-center transition-opacity duration-400 bg-(--t-bg-terminal) ${exiting ? "opacity-0" : "opacity-100"}`}
    >
      <div className="mb-10 text-center">
        <LogoBadge size={14} className="mb-4" />
        <h1 className="text-xl font-bold tracking-wide text-(--t-text-bright)">Voltius</h1>
        <p className="text-xs mt-1 text-(--t-text-muted)">SSH Client</p>
      </div>

      <div className="w-64 space-y-2.5">
        {steps.map((step) => <StepRow key={step.id} step={step} />)}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <div className={`flex items-center gap-3 transition-opacity duration-300 ${step.status === "pending" ? "opacity-30" : "opacity-100"}`}>
      <StepIcon status={step.status} />
      <span className="text-sm" style={{
        color: step.status === "done" ? "var(--t-text-secondary)" :
               step.status === "error" ? "var(--t-status-error)" :
               step.status === "running" ? "var(--t-text-primary)" : "var(--t-text-muted)",
      }}>{step.label}</span>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return (
    <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(34,197,94,0.2)" }}>
      <svg width="8" height="8" viewBox="0 0 10 8" fill="none" stroke="#22c55e" strokeWidth="2"><polyline points="1,4 4,7 9,1" /></svg>
    </div>
  );
  if (status === "running") return (
    <div className="w-4 h-4 rounded-full shrink-0 animate-spin" style={{ border: "2px solid var(--t-border)", borderTopColor: "var(--t-accent)" }} />
  );
  if (status === "error") return (
    <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.2)" }}>
      <svg width="8" height="8" viewBox="0 0 10 10" stroke="#ef4444" strokeWidth="2"><line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" /></svg>
    </div>
  );
  return <div className="w-4 h-4 rounded-full shrink-0 border border-(--t-border)" />;
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
