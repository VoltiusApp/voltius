import { builtIn } from "@/services/policy/adminDefaults";
import { effectiveSettingWith, useEffectiveSettingWith } from "@/services/policy/effectiveCore";

export { boundedValue } from "@/services/policy/effectiveCore";

export const effectiveSetting = <T>(key: string, stored: T): T => effectiveSettingWith(key, stored, builtIn(key));

export const useEffectiveSetting = <T>(key: string, stored: T): T => useEffectiveSettingWith(key, stored, builtIn(key));
