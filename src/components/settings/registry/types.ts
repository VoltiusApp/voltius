import type { SettingsSection } from "@/stores/uiStore";

/** Ce qu'une écriture ferait perdre, et dans quel sens. Une clé gardée n'est
 *  dangereuse que dans la direction qui désarme le garde-fou : réactiver
 *  l'écran de consentement ne coûte rien. */
export interface SettingConsequence {
  /** Clé i18n de la phrase montrée au refus. */
  key: string;
  /** Vrai quand passer de `current` à `next` affaiblit le garde-fou. */
  weakens(next: unknown, current: unknown): boolean;
}

export interface SettingOption { value: string; label: string }

interface NumericControl {
  min: number;
  max: number;
  step: number;
  unit: string;
  toDisplay?(value: unknown): number;
  fromDisplay?(display: number): unknown;
}

export type SettingControl =
  | { kind: "toggle" }
  | { kind: "select"; options(): SettingOption[]; toOption?(value: unknown): string; fromOption?(option: string): unknown }
  | ({ kind: "stepper" } & NumericControl)
  | ({ kind: "number" } & NumericControl)
  | { kind: "time" }
  | { kind: "value"; format?(value: unknown): string }
  | { kind: "open" };

export type SettingPlatform = "all" | "desktop" | "mobile" | "android";

export interface SettingDef {
  key: string;
  type: "boolean" | "number" | "enum" | "string" | "structured";
  values?: readonly string[];
  min?: number;
  max?: number;
  default: unknown;
  section: SettingsSection;
  /** Clé i18n, résolue à l'appel de `setting_list` — jamais au build. */
  labelKey: string;
  writable: boolean;
  /** Clé de politique qui peut verrouiller cette entrée. */
  policyKey?: string;
  /** Présente seulement sur les clés qui désarment un garde-fou. */
  consequence?: SettingConsequence;
  get(): unknown;
  set?(value: unknown): void;

  /** The title its settings row shows, when it differs from the standalone `labelKey`. */
  titleKey?: string;
  descKey?: string;
  keywords?: readonly string[];
  control: SettingControl;
  use(): unknown;
  useActive?(): boolean;
  isDirty?(value: unknown, defaultValue: unknown): boolean;
  reset?(): void;
  resettable?: false;
  syncKey?: string;
  platform?: SettingPlatform;
  mobileHidden?: boolean;
}
