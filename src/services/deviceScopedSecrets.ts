import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { GLOBAL_PROXY_PASSWORD_KEY, GLOBAL_PROXY_SECRET_ID } from "./teamVaultSecretKeys";

const proxyStaysOnDevice = () => !useSyncPrefsStore.getState().isSettingSynced("appSettings.proxy");

export const deviceScopedSecretIds = (): string[] => (proxyStaysOnDevice() ? [GLOBAL_PROXY_SECRET_ID] : []);

export const deviceScopedSecretKeys = (): string[] => (proxyStaysOnDevice() ? [GLOBAL_PROXY_PASSWORD_KEY] : []);
