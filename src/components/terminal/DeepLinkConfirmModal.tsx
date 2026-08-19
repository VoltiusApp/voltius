import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { intentKey, type ConfirmIntent } from "@/services/deepLinkUrl";
import { CONFIRM_SPECS, type ConfirmRoute, type ConfirmSpec } from "./deepLinkConfirmSpecs";
import type { TranslatableMessage } from "@/plugins/installErrors";

export function DeepLinkConfirmModal() {
  const prompt = useDeepLinkStore((s) => s.prompt);
  // Keyed by intent: a new link remounts the sheet, which is what discards a prior
  // failure's error and re-runs `load` against the new target. The key embeds a
  // join token, so it must never be logged.
  return prompt ? <ConfirmSheet key={intentKey(prompt)} intent={prompt} /> : null;
}

function failureMessage(spec: ConfirmSpec<ConfirmRoute, unknown>, e: unknown): TranslatableMessage {
  return spec.errorMessage?.(e, spec.errorKey) ?? { key: spec.errorKey };
}

function ConfirmSheet({ intent }: { intent: ConfirmIntent }) {
  const { t } = useTranslation();
  const dismissPrompt = useDeepLinkStore((s) => s.dismissPrompt);
  // The spec is picked by the intent's own route, so the pairing is right by
  // construction — TypeScript cannot prove that through the index. Same shape as
  // `ROUTES[intent.route] as RouteCodec<Route>` in deepLinkUrl.ts.
  const spec = CONFIRM_SPECS[intent.route] as ConfirmSpec<ConfirmRoute, unknown>;

  const [loaded, setLoaded] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!spec.load);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslatableMessage | null>(null);

  // `t` is deliberately absent from the deps: it is a new function on every
  // locale change, and re-running `load` would fetch a second time without
  // resetting the state below, leaving accept live over a stale result.
  useEffect(() => {
    if (!spec.load) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    void spec
      .load(intent)
      .then((value) => {
        if (!cancelled) setLoaded(value);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadFailed(true);
        setError(failureMessage(spec, e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intent, spec]);

  const details = spec.details(intent, loaded, t);
  // A sheet that could not name what it is about must never be acceptable. A
  // failed *accept* is different: it leaves the button live so the user can retry.
  const acceptable = !loading && !loadFailed && (spec.canAccept?.(loaded) ?? true);

  const handleAccept = async () => {
    if (busy || !acceptable) return;
    setBusy(true);
    setError(null);
    try {
      await spec.accept(intent, loaded, t);
      dismissPrompt();
    } catch (e) {
      setError(failureMessage(spec, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={dismissPrompt}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
          >
            <Icon icon={spec.icon} width={16} className="text-(--t-accent)" />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">{details.title}</h2>
        </div>
        <p className="text-sm text-(--t-text-secondary)">{details.body}</p>
        {loading && <p className="text-xs text-(--t-text-dim)">{t("common.state.loading")}</p>}
        {spec.extra?.(loaded, t)}
        {details.note && <p className="text-xs text-(--t-text-dim)">{details.note}</p>}
        {error && <p className="text-xs text-(--t-status-error)">{t(error.key, error.params)}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={dismissPrompt}
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("common.action.cancel")}
          </button>
          <button
            onClick={() => void handleAccept()}
            disabled={busy || !acceptable}
            className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t(spec.acceptLabelKey)}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
