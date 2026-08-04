import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { writeClipboard } from "@/utils/clipboard";
import type { Snippet } from "@/types";
import { buildShareEntry, shareEntryJson, githubNewFileUrl } from "@/services/snippetShare";
import { scanSteps, type SecretFinding } from "@/services/snippetSecretScan";

const GUIDELINES_URL = "https://github.com/voltiusApp/marketplace/blob/main/CONTRIBUTING.md";

export function ShareSnippetModal({ snippets, packName, onClose }: {
  snippets: Snippet[];
  /** Set when sharing a folder — publishes the selection as a pack. */
  packName?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(false);

  const built = useMemo(() => {
    try {
      const entry = buildShareEntry(snippets, {
        packName,
        author: author.trim() || undefined,
        description: description.trim() || undefined,
      });
      return { entry, json: shareEntryJson(entry), error: null as string | null };
    } catch (e) {
      return { entry: null, json: "", error: String((e as Error)?.message ?? e) };
    }
  }, [snippets, packName, author, description]);

  const findings: SecretFinding[] = useMemo(
    () => snippets.flatMap(s => scanSteps(s.steps)),
    [snippets],
  );
  const uniqueFindings = useMemo(() => {
    const seen = new Set<string>();
    return findings.filter(f => {
      const k = `${f.kind}:${f.match}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [findings]);

  async function handleCopy() {
    await writeClipboard(built.json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard className="w-[42rem] max-w-full flex flex-col gap-4 p-5" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:globe" width={18} className="text-(--t-text-dim)" />
          <h2 className="text-base font-bold text-(--t-text-bright)">{t("snippets.community.shareTitle")}</h2>
        </div>
        <p className="text-xs text-(--t-text-dim)">{t("snippets.community.shareIntro")}</p>

        <div className="flex gap-2">
          <input
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder={t("snippets.community.shareAuthor")}
            className="flex-1 h-8 px-2.5 rounded-lg text-xs text-(--t-text-primary)"
            style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)" }}
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder={t("snippets.community.shareDescription")}
            className="flex-[2] h-8 px-2.5 rounded-lg text-xs text-(--t-text-primary)"
            style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)" }}
          />
        </div>

        {uniqueFindings.length > 0 ? (
          <div
            className="rounded-lg p-3 flex flex-col gap-1.5"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-status-error)" }}
          >
            <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--t-status-error)" }}>
              <Icon icon="lucide:shield-alert" width={12} />
              {t("snippets.community.secretsTitle")}
            </p>
            <p className="text-xs text-(--t-text-dim)">{t("snippets.community.secretsIntro")}</p>
            {uniqueFindings.map((f, i) => (
              <div key={i} className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 text-(--t-text-dim)" style={{ border: "1px solid var(--t-border)" }}>
                  {t(`snippets.community.secretKind_${f.kind}`)}
                </span>
                <span className="text-xs font-mono truncate text-(--t-text-secondary)">{f.match}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs flex items-center gap-1.5 text-(--t-text-dim)">
            <Icon icon="lucide:shield-check" width={12} />
            {t("snippets.community.secretsNone")}
          </p>
        )}

        {built.error ? (
          <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--t-status-error)" }}>
            <Icon icon="lucide:circle-alert" width={12} className="mt-0.5 shrink-0" />
            {t("snippets.community.shareFailed", { error: built.error })}
          </p>
        ) : (
          <pre
            className="flex-1 min-h-0 overflow-auto text-[11px] font-mono p-3 rounded-lg text-(--t-text-secondary)"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
          >
            {built.json}
          </pre>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={!!built.error}
            className="px-3 h-8 rounded-lg text-xs font-semibold disabled:opacity-40 text-(--t-text-primary)"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
          >
            {copied ? t("snippets.community.shareCopied") : t("snippets.community.shareCopy")}
          </button>
          <button
            onClick={() => built.entry && void openUrl(githubNewFileUrl(built.entry.id))}
            disabled={!!built.error}
            className="px-3 h-8 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--t-accent)", color: "var(--t-bg-terminal)" }}
          >
            {t("snippets.community.shareOpenGithub")}
          </button>
          <button
            onClick={() => void openUrl(GUIDELINES_URL)}
            className="text-xs ml-auto text-(--t-text-dim) hover:text-(--t-text-primary)"
          >
            {t("snippets.community.shareGuidelines")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
