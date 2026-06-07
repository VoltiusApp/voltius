import { useState } from "react";
import { Icon } from "@iconify/react";
import LogoBadge from "./LogoBadge";
import {
  createLocalAccountNoPassword,
  createServerAccount,
  login,
} from "@/services/account";
import { useNotificationStore } from "@/stores/notificationStore";


type View = "home" | "cloud";
type CloudMode = "signup" | "signin";

interface Props {
  isLocked: boolean;
  onReady: () => void;
}

const DEFAULT_SERVER = "https://api.voltius.app";

export default function AuthPage({ isLocked, onReady }: Props) {
  const [view, setView] = useState<View>("home");
  const [cloudMode, setCloudMode] = useState<CloudMode>("signup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [showServerUrl, setShowServerUrl] = useState(false);
  const addToast = useNotificationStore((s) => s.addToast);

  const reset = (v: View, mode?: CloudMode) => {
    setView(v);
    if (mode) setCloudMode(mode);
    setError("");
    setPassword("");
    setConfirm("");
  };

  const wrap = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
      onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── Locked (vault exists, need password) ─────────────────────────────────

  if (isLocked) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      await wrap(() => login(password));
    };
    return (
      <Layout>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">
          Enter your master password to unlock
        </p>
        <form onSubmit={submit} className="w-full space-y-2">
          <Input type="password" placeholder="Master password" value={password}
            onChange={setPassword} autoFocus />
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label="Unlock" />
        </form>
        <button
          type="button"
          onClick={async () => {
            const { resetVault } = await import("@/services/vault");
            await resetVault();
            window.location.reload();
          }}
          className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-status-error)"
        >
          Reset vault (deletes all local data)
        </button>
      </Layout>
    );
  }

  // ── Home (first launch) ──────────────────────────────────────────────────

  if (view === "home") {
    return (
      <Layout>
        <p className="text-xs mb-6 text-center text-(--t-text-muted)">
          Choose how you want to use Voltius
        </p>

        <ActionButton
          icon="lucide:zap"
          label="Get started"
          sub="Secured by OS keychain — no password needed"
          primary
          loading={loading}
          onClick={() => wrap(createLocalAccountNoPassword)}
        />

        <div className="flex items-center gap-2 my-4">
          <div className="flex-1 h-px bg-(--t-border)" />
          <span className="text-xs text-(--t-text-dim)">or</span>
          <div className="flex-1 h-px bg-(--t-border)" />
        </div>

        <ActionButton
          icon="lucide:cloud"
          label="Cloud account"
          sub="Sync across devices — sign in or create one"
          onClick={() => reset("cloud", "signup")}
        />
      </Layout>
    );
  }

  // ── Cloud (merged sign-up / sign-in) ─────────────────────────────────────

  if (view === "cloud") {
    const isSignup = cloudMode === "signup";

    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.includes("@")) { setError("Invalid email"); return; }
      const normalizedUrl = serverUrl.replace(/\/+$/, "");
      if (isSignup) {
        if (password.length < 8) { setError("At least 8 characters"); return; }
        if (password !== confirm) { setError("Passwords don't match"); return; }
        await wrap(async () => {
          await createServerAccount(email, password, normalizedUrl);
          addToast({
            pluginId: "system",
            pluginName: "Voltius",
            type: "toast",
            message: "Account created! Check your email to verify.",
            severity: "info",
            duration: 5000,
          });
        });
      } else {
        await wrap(() => login(password, email, normalizedUrl));
      }
    };

    return (
      <Layout onBack={() => reset("home")}>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">
          {isSignup ? "Create an account to sync across devices" : "Sign in to restore your synced data"}
        </p>
        <form onSubmit={submit} className="w-full space-y-2">
          <Input type="email" placeholder="Email" value={email} onChange={setEmail} autoFocus />
          <Input type="password" placeholder={isSignup ? "Master password (min 8 chars)" : "Master password"}
            value={password} onChange={setPassword} />
          {isSignup && (
            <Input type="password" placeholder="Confirm password" value={confirm} onChange={setConfirm} />
          )}
          <button
            type="button"
            onClick={() => setShowServerUrl((v) => !v)}
            className="text-xs w-full text-left transition-colors text-(--t-text-dim)"
          >
            {showServerUrl ? "▾" : "▸"} Custom server URL
          </button>
          {showServerUrl && (
            <Input type="url" placeholder="https://api.voltius.app"
              value={serverUrl} onChange={setServerUrl} />
          )}
          <ErrorMsg msg={error} />
          <SubmitBtn loading={loading} label={isSignup ? "Create account" : "Sign in"} />
        </form>

        <div className="mt-3 text-center">
          {isSignup ? (
            <>
              <span className="text-xs text-(--t-text-dim)">Already have an account? </span>
              <button
                type="button"
                onClick={() => { setCloudMode("signin"); setError(""); setConfirm(""); }}
                className="text-xs text-(--t-accent) hover:underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-(--t-text-dim)">New here? </span>
              <button
                type="button"
                onClick={() => { setCloudMode("signup"); setError(""); }}
                className="text-xs text-(--t-accent) hover:underline"
              >
                Create account
              </button>
            </>
          )}
        </div>

        {isSignup && (
          <p className="mt-2 text-xs text-center text-(--t-text-dim) leading-relaxed">
            Your data is E2E encrypted — the server cannot read it.{" "}
            <a href="https://github.com/VoltiusApp/voltius" target="_blank" rel="noreferrer"
              className="text-(--t-accent) hover:underline">
              Open source.
            </a>
            <br />
            By creating an account you agree to our{" "}
            <a href="https://voltius.app/terms" target="_blank" rel="noreferrer"
              className="text-(--t-accent) hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="https://voltius.app/privacy" target="_blank" rel="noreferrer"
              className="text-(--t-accent) hover:underline">
              Privacy Policy
            </a>
            .
          </p>
        )}
      </Layout>
    );
  }

  return null;
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Layout({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-(--t-bg-terminal)">
      {onBack && (
        <button onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-1.5 text-xs transition-colors text-(--t-text-muted) hover:text-(--t-text-primary)"
        >
          <Icon icon="lucide:arrow-left" width={13} /> Back
        </button>
      )}

      <div className="mb-8 text-center">
        <LogoBadge size={12} className="mb-3" />
        <h1 className="text-lg font-bold text-(--t-text-bright)">Voltius</h1>
      </div>

      <div className="w-72">{children}</div>
    </div>
  );
}

function ActionButton({ icon, label, sub, primary, loading, onClick }: {
  icon: string; label: string; sub: string;
  primary?: boolean; loading?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl mb-2 text-left transition-all"
      style={{
        background: primary ? "var(--t-accent)" : "var(--t-bg-elevated)",
        border: `1px solid ${primary ? "var(--t-accent)" : "var(--t-border)"}`,
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)";
      }}
      onMouseLeave={(e) => {
        if (!primary) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
      }}
    >
      <Icon icon={loading ? "lucide:loader-2" : icon} width={18}
        className={`shrink-0 ${loading ? "animate-spin" : ""}`}
        style={{ color: primary ? "white" : "var(--t-accent)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: primary ? "white" : "var(--t-text-primary)" }}>
          {label}
        </p>
        <p className="text-xs" style={{ color: primary ? "rgba(255,255,255,0.7)" : "var(--t-text-muted)" }}>
          {sub}
        </p>
      </div>
    </button>
  );
}

function Input({ type, placeholder, value, onChange, autoFocus }: {
  type: string; placeholder: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
      onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
      onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
    />
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-xs text-center py-1 text-(--t-status-error)">{msg}</p>;
}

function SubmitBtn({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading}
      className="w-full py-2 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2 bg-(--t-accent)"
      style={{ opacity: loading ? 0.7 : 1 }}
      onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent-hover)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)"; }}
    >
      {loading && <Icon icon="lucide:loader-2" width={14} className="animate-spin" />}
      {label}
    </button>
  );
}
