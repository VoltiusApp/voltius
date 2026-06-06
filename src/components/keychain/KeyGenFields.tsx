import { useState } from "react";
import { Icon } from "@iconify/react";
import { generateSshKeypair } from "@/services/keys";
import { FormSection, formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import { Pills, type PillOption } from "@/components/shared/Pills";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { Toggle } from "@/components/shared/Toggle";
import { useRipple } from "@/hooks/useRipple";

// ─────────────────────────────────────────────────────────────────
// Generate-mode config
// ─────────────────────────────────────────────────────────────────

type KeyType = "ed25519" | "ecdsa" | "rsa";
type EcdsaCurve = "256" | "384" | "521";
type RsaBits = "2048" | "4096";
type CipherOption = "aes256-ctr" | "aes256-gcm";

const CIPHER_OPTIONS: PillOption<CipherOption>[] = [
  { value: "aes256-ctr", label: "AES-256-CTR" },
  { value: "aes256-gcm", label: "AES-256-GCM" },
];

const KEY_TYPE_OPTIONS: PillOption<KeyType>[] = [
  { value: "ed25519", label: "ED25519" },
  { value: "ecdsa", label: "ECDSA" },
  { value: "rsa", label: "RSA" },
];

const ECDSA_CURVES: PillOption<EcdsaCurve>[] = [
  { value: "256", label: "P-256" },
  { value: "384", label: "P-384" },
  { value: "521", label: "P-521" },
];

const RSA_BITS: PillOption<RsaBits>[] = [
  { value: "2048", label: "2048" },
  { value: "4096", label: "4096" },
];

// ─────────────────────────────────────────────────────────────────
// KeyGenFields — generate-mode sub-form
//
// Generates a keypair, then hands the material back to the parent
// KeyForm via onGenerated. The passphrase is returned only when the
// user opts to save it (the key itself is already encrypted with it).
// ─────────────────────────────────────────────────────────────────

export function KeyGenFields({
  onGenerated,
}: {
  onGenerated: (privateKey: string, publicKey: string, passphrase: string) => void;
}) {
  const [keyType, setKeyType] = useState<KeyType>("ed25519");
  const [curve, setCurve] = useState<EcdsaCurve>("256");
  const [rsaBits, setRsaBits] = useState<RsaBits>("4096");
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [savePassphrase, setSavePassphrase] = useState(true);
  const [cipher, setCipher] = useState<CipherOption>("aes256-ctr");
  const [rounds, setRounds] = useState(100);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const { createRipple: rippleGenerate, rippleEls: ripplesGenerate } = useRipple();

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generateSshKeypair({
        keyType,
        curve: keyType === "ecdsa" ? curve : undefined,
        bits: keyType === "rsa" ? parseInt(rsaBits) : undefined,
        passphrase: passphrase || undefined,
        cipher: passphrase ? cipher : undefined,
        rounds: passphrase ? rounds : undefined,
      });
      onGenerated(result.private_key, result.public_key, passphrase && savePassphrase ? passphrase : "");
    } catch (err) {
      setGenError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <FormSection label="Key Type">
        <Pills<KeyType> options={KEY_TYPE_OPTIONS} value={keyType} onChange={setKeyType} />

        {keyType === "ecdsa" && (
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Elliptic curve</label>
            <Pills<EcdsaCurve> options={ECDSA_CURVES} value={curve} onChange={setCurve} />
          </div>
        )}

        {keyType === "rsa" && (
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Key size (bits)</label>
            <Pills<RsaBits> options={RSA_BITS} value={rsaBits} onChange={setRsaBits} />
          </div>
        )}
      </FormSection>

      <FormSection label="Passphrase">
        <div className="relative">
          <input
            type={showPassphrase ? "text" : "password"}
            className={`${formInputClass} pr-9`}
            style={formInputStyle}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Optional passphrase"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPassphrase((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-(--t-text-dim)"
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
            tabIndex={-1}
          >
            <Icon icon={showPassphrase ? "lucide:eye-off" : "lucide:eye"} width={14} />
          </button>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-xs text-(--t-text-dim)">Save passphrase</span>
          <Toggle checked={savePassphrase} onChange={setSavePassphrase} />
        </div>

        {passphrase && (
          <>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Cipher</label>
              <Pills<CipherOption> options={CIPHER_OPTIONS} value={cipher} onChange={setCipher} />
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className={formLabelClass} style={{ ...formLabelStyle, marginBottom: 0 }}>Rounds</label>
                <InfoTooltip text="Number of bcrypt-pbkdf iterations used to derive the encryption key from your passphrase. Higher values slow down brute-force attacks at the cost of slightly slower key loading. OpenSSH default is 16; 100 is a good balance." width={18} />
              </div>
              <input
                type="number"
                min={1}
                max={10000}
                className={formInputClass}
                style={formInputStyle}
                value={rounds}
                onChange={(e) => setRounds(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </>
        )}
      </FormSection>

      {genError && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs bg-[#2D1515] border border-[#5C2020] text-[#F87171]">
          <Icon icon="lucide:alert-circle" width={13} />
          <span className="flex-1">{genError}</span>
        </div>
      )}

      <button
        onClick={handleGenerate}
        onMouseDown={generating ? undefined : rippleGenerate}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors relative overflow-hidden"
        style={{
          background: generating ? "var(--t-bg-elevated)" : "var(--t-accent)",
          color: generating ? "var(--t-text-dim)" : "var(--t-bg-base)",
          cursor: generating ? "not-allowed" : "pointer",
        }}
      >
        {ripplesGenerate}
        {generating ? (
          <>
            <Icon icon="lucide:loader-2" width={15} className="animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Icon icon="lucide:sparkles" width={15} />
            Generate
          </>
        )}
      </button>
    </>
  );
}
