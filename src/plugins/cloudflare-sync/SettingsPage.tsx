import React, { useCallback, useEffect, useState } from "react";
import { Icon, useAutosave } from "@voltius/ui";
import type { PluginAPI } from "@/plugins/api";
import {
  disconnect,
  getCloudflareSyncState,
  isConfigured,
  linkExistingVault,
  setupNewVault,
  startPoll,
  stopPoll,
  syncNow,
} from "./sync-engine";
import { WorkerApiError, getHealth, getManifest } from "./worker-api";

type SaveState = ReturnType<typeof useAutosave>["saveState"];

function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
}) {
  const base =
    "rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default";
  const size = small ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm";
  const colors =
    variant === "primary"
      ? "bg-(--t-accent) text-white hover:bg-(--t-accent-hover)"
      : variant === "danger"
        ? "bg-transparent border border-(--t-status-error) text-(--t-status-error) hover:bg-[color-mix(in_srgb,var(--t-status-error)_10%,transparent)]"
        : "bg-(--t-bg-elevated) border border-(--t-border) text-(--t-text-muted) hover:border-(--t-border-hover)";
  return (
    <button className={`${base} ${size} ${colors}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-(--t-text-muted)">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-(--t-text-dim)">{hint}</p> : null}
    </div>
  );
}

function textInputClass() {
  return "form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)";
}

export function createSettingsPage(api: PluginAPI) {
  return function CloudflareSyncSettingsPage() {
    const [workerUrl, setWorkerUrl] = useState("");
    const [token, setToken] = useState("");
    const [passphrase, setPassphrase] = useState("");
    const [pollSeconds, setPollSeconds] = useState(60);
    const [configured, setConfigured] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deviceCount, setDeviceCount] = useState<number | null>(null);
    const [, setTick] = useState(0);

    const refresh = useCallback(async () => {
      const [url, tok, pass, poll, cfg] = await Promise.all([
        api.storage.get<string>("workerUrl"),
        api.vault.get("syncToken"),
        api.vault.get("passphrase"),
        api.storage.get<number>("pollIntervalSeconds"),
        isConfigured(),
      ]);
      setWorkerUrl(url ?? "");
      setToken(tok ?? "");
      setPassphrase(pass ?? "");
      setPollSeconds(poll ?? 60);
      setConfigured(cfg);
      setTick((n) => n + 1);
      if (cfg && url && tok) {
        try {
          const manifest = await getManifest(api.http, url, tok);
          setDeviceCount(manifest.devices.length);
        } catch {
          setDeviceCount(null);
        }
      } else {
        setDeviceCount(null);
      }
    }, [api]);

    useEffect(() => {
      void refresh();
    }, [refresh]);

    const urlSave = useAutosave(workerUrl, async (v) => {
      await api.storage.set("workerUrl", v.replace(/\/+$/, ""));
    });
    const tokenSave = useAutosave(token, async (v) => {
      await api.vault.set("syncToken", v);
    });
    const passSave = useAutosave(passphrase, async (v) => {
      await api.vault.set("passphrase", v);
    });

    async function run(action: () => Promise<void>, okMsg: string) {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        await action();
        setMessage(okMsg);
        await refresh();
      } catch (err) {
        const msg =
          err instanceof WorkerApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setError(msg);
      } finally {
        setBusy(false);
      }
    }

    const syncState = getCloudflareSyncState();

    return (
      <div className="flex flex-col gap-6 p-4 max-w-xl">
        <div className="flex items-start gap-3">
          <Icon icon="lucide:cloud" width={22} className="text-(--t-text-primary) mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold text-(--t-text-primary)">
              {api.i18n.t("settingsLabel")}
            </h2>
            <p className="text-sm text-(--t-text-muted)">
              Sync encrypted vault blobs to your own Cloudflare Worker + R2. The Worker only
              sees ciphertext. Use a passphrase that is{" "}
              <strong className="font-medium">not</strong> your sync token.
            </p>
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-(--t-text-primary)">Connection</h3>
          <Field label="Worker URL" hint="Example: https://voltius-sync.example.workers.dev">
            <input
              className={textInputClass()}
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://your-worker.workers.dev"
            />
            <SaveHint state={urlSave.saveState} />
          </Field>
          <Field label="Sync token" hint="Bearer token configured as SYNC_TOKEN on the Worker">
            <input
              type="password"
              className={textInputClass()}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Long random secret"
            />
            <SaveHint state={tokenSave.saveState} />
          </Field>
          <Field
            label="Encryption passphrase"
            hint="Required. Derives the vault encryption key. Never reuse the sync token."
          >
            <input
              type="password"
              className={textInputClass()}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Strong passphrase"
            />
            <SaveHint state={passSave.saveState} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !workerUrl || !token || !passphrase}
              onClick={() =>
                void run(
                  () => setupNewVault(workerUrl, token, passphrase),
                  "Created remote vault and uploaded this device",
                )
              }
            >
              Create vault
            </Btn>
            <Btn
              variant="secondary"
              disabled={busy || !workerUrl || !token || !passphrase}
              onClick={() =>
                void run(
                  () => linkExistingVault(workerUrl, token, passphrase),
                  "Linked existing vault",
                )
              }
            >
              Link existing
            </Btn>
            <Btn
              variant="secondary"
              disabled={busy || !workerUrl}
              onClick={() =>
                void run(async () => {
                  const health = await getHealth(api.http, workerUrl);
                  if (!health.ok) throw new Error("Worker health check failed");
                }, "Worker health OK")
              }
            >
              Test health
            </Btn>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-(--t-text-primary)">Sync</h3>
          <div className="text-sm text-(--t-text-muted)">
            Status: <span className="text-(--t-text-primary)">{syncState.status}</span>
            {configured ? " · configured" : " · not configured"}
            {deviceCount != null ? ` · ${deviceCount} device(s)` : ""}
            {syncState.lastSync
              ? ` · last ${syncState.lastSync.toLocaleString()}`
              : ""}
          </div>
          <Field label="Poll interval (seconds)">
            <input
              type="number"
              min={10}
              max={3600}
              className={textInputClass()}
              value={pollSeconds}
              onChange={(e) => setPollSeconds(Number(e.target.value) || 60)}
              onBlur={() => {
                const clamped = Math.min(3600, Math.max(10, pollSeconds || 60));
                setPollSeconds(clamped);
                void api.storage.set("pollIntervalSeconds", clamped).then(() => {
                  if (configured) {
                    stopPoll();
                    startPoll(clamped);
                  }
                });
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn
              disabled={busy || !configured}
              onClick={() => void run(() => syncNow({ showProgress: true }), "Sync finished")}
            >
              Sync now
            </Btn>
            <Btn
              variant="danger"
              disabled={busy || !configured}
              onClick={() => void run(() => disconnect(), "Disconnected")}
            >
              Disconnect
            </Btn>
          </div>
        </section>

        {message ? (
          <p className="text-sm text-(--t-status-connected)">{message}</p>
        ) : null}
        {error ? <p className="text-sm text-(--t-status-error)">{error}</p> : null}

        <p className="text-[11px] text-(--t-text-dim)">
          Deploy guide: <code>examples/cloudflare-sync-worker/README.md</code> ·{" "}
          <a
            className="underline"
            href="https://github.com/VoltiusApp/voltius/issues/267"
            target="_blank"
            rel="noreferrer"
          >
            Voltius#267
          </a>
        </p>
      </div>
    );
  };
}

function SaveHint({ state }: { state: SaveState }) {
  if (state === "saving" || state === "dirty") {
    return <Icon icon="lucide:loader-circle" width={13} className="animate-spin text-(--t-text-dim)" />;
  }
  if (state === "saved") {
    return <Icon icon="lucide:check" width={13} className="text-(--t-status-connected)" />;
  }
  return null;
}
