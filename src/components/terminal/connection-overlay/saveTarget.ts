import type { TFunction } from "i18next";
import type { PillOption } from "@/components/shared/Pills";
import type { ConnectRetryOverride } from "./types";

export type SaveTarget = "host" | "pick" | "vault-default";

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

export function identityOverride(identityId: string, target: SaveTarget): ConnectRetryOverride {
  return target === "host" ? { identityId } : { identityId, saveAs: target };
}
