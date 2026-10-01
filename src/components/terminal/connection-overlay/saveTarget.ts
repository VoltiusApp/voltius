import type { TFunction } from "i18next";
import type { PillOption } from "@/components/shared/Pills";
import type { ConnectRetryOverride, IdentitySaveAs } from "@/types";

export type SaveTarget = "host" | IdentitySaveAs;

export function saveTargetOptions(kind: "own" | "team", canEditHost: boolean, vaultName: string, t: TFunction): PillOption<SaveTarget>[] {
  return kind === "own"
    ? [
        { value: "pick", label: t("terminal.overlay.saveTarget.thisHost") },
        { value: "vault-default", label: t("terminal.overlay.saveTarget.allVaultHosts", { vault: vaultName }) },
      ]
    : [
        { value: "host", label: t("terminal.overlay.saveTarget.everyone"), disabled: !canEditHost },
        { value: "pick", label: t("terminal.overlay.saveTarget.onlyMe") },
      ];
}

export function defaultSaveTarget(kind: "own" | "team", canEditHost: boolean): SaveTarget {
  return kind === "team" && canEditHost ? "host" : "pick";
}

export function repairSaveTarget(via: "pick" | "default"): SaveTarget {
  return via === "pick" ? "pick" : "vault-default";
}

export function identityOverride(identityId: string, target: SaveTarget): ConnectRetryOverride {
  return target === "host" ? { identityId } : { identityId, saveAs: target };
}
