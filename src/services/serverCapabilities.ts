import { useEffect } from "react";
import { create } from "zustand";
import { fetchServerMeta } from "@/services/teamObjects";
import { logFailure } from "@/lib/logger";
import { getServerUrl } from "@/services/authTokens";
import { isDefaultServer } from "@/utils/serverInstance";
import type { TeamSecretType } from "@/services/teamVaultSecretKeys";

// Shipped before servers advertised `team_secret_types`: only a refused upload reveals a server too old for one.
const UNADVERTISED_SECRET_TYPES: ReadonlySet<TeamSecretType> = new Set(["connection_knock_sequence"]);
const REFRESH_INTERVAL_MS = 5 * 60_000;

interface ServerCapabilities {
  advertisedSecretTypes: string[] | null;
  refusedSecretTypes: TeamSecretType[];
  twoFactor: boolean;
  passkeys: boolean;
  wrappedSecretsCas: boolean;
  billingEnabled: boolean;
  multiOwner: boolean;
  emailDelivery: boolean;
}

const UNKNOWN: ServerCapabilities = {
  advertisedSecretTypes: null,
  refusedSecretTypes: [],
  twoFactor: false,
  passkeys: false,
  wrappedSecretsCas: false,
  billingEnabled: false,
  multiOwner: false,
  emailDelivery: true,
};
const useServerCapabilities = create<ServerCapabilities>(() => UNKNOWN);

let fetchedAt: number | null = null;
let inFlight: Promise<void> | null = null;

async function loadCapabilities(): Promise<void> {
  try {
    const { team_secret_types: types, two_factor, passkeys, wrapped_secrets_cas, billing_enabled, multi_owner, email_delivery } = await fetchServerMeta(
      "common.error.failedToLoadServerCapabilities",
    );
    fetchedAt = Date.now();
    useServerCapabilities.setState({
      twoFactor: two_factor === true,
      passkeys: passkeys === true,
      wrappedSecretsCas: wrapped_secrets_cas === true,
      billingEnabled: billing_enabled === true,
      multiOwner: multi_owner === true,
      emailDelivery: email_delivery !== false,
      ...(Array.isArray(types)
        ? { advertisedSecretTypes: types.filter((t): t is string => typeof t === "string"), refusedSecretTypes: [] }
        : { advertisedSecretTypes: null }),
    });
  } catch (e) {
    logFailure("server capabilities")(e);
    // Unanswered: only the official cloud is known to sell plans.
    const serverUrl = await getServerUrl().catch(() => null);
    useServerCapabilities.setState({ billingEnabled: serverUrl != null && isDefaultServer(serverUrl) });
  } finally {
    inFlight = null;
  }
}

export function refreshServerCapabilities(): Promise<void> {
  if (fetchedAt !== null && Date.now() - fetchedAt < REFRESH_INTERVAL_MS) return Promise.resolve();
  inFlight ??= loadCapabilities();
  return inFlight;
}

export function resetServerCapabilities(): void {
  fetchedAt = null;
  useServerCapabilities.setState(UNKNOWN);
}

const lacks = (s: ServerCapabilities, type: TeamSecretType): boolean =>
  s.advertisedSecretTypes ? !s.advertisedSecretTypes.includes(type) : s.refusedSecretTypes.includes(type);

export const serverLacksSecretType = (type: TeamSecretType): boolean => lacks(useServerCapabilities.getState(), type);

/** True when the refusal means the server is too old for `type`, which is then remembered. */
export function noteRefusedSecretType(type: TeamSecretType): boolean {
  const s = useServerCapabilities.getState();
  if (s.advertisedSecretTypes || !UNADVERTISED_SECRET_TYPES.has(type)) return false;
  if (!s.refusedSecretTypes.includes(type)) {
    useServerCapabilities.setState({ refusedSecretTypes: [...s.refusedSecretTypes, type] });
  }
  return true;
}

function useCapabilities<T>(select: (s: ServerCapabilities) => T): T {
  useEffect(() => void refreshServerCapabilities(), []);
  return useServerCapabilities(select);
}

type CapabilityFlag = { [K in keyof ServerCapabilities]: ServerCapabilities[K] extends boolean ? K : never }[keyof ServerCapabilities];

export const useServerCapability = (flag: CapabilityFlag): boolean => useCapabilities((s) => s[flag]);

/** Non-hook read for service code; false until `/v1/meta` has answered. */
export const getServerCapability = (flag: CapabilityFlag): boolean => useServerCapabilities.getState()[flag];

export const useServerLacksSecretType = (type: TeamSecretType): boolean => useCapabilities((s) => lacks(s, type));

/** Which second factors this server lets an account enrol; none until it says so. */
export const useServerSecondFactors = (): { totp: boolean; passkeys: boolean } => ({
  totp: useServerCapability("twoFactor"),
  passkeys: useServerCapability("passkeys"),
});

/** What `/v1/meta` says; when it cannot be reached, whether this is the official cloud. */
export const useServerBillingEnabled = (): boolean => useServerCapability("billingEnabled");

/** Whether this server lets several members hold Owner and hand billing between them. */
export const useServerMultiOwner = (): boolean => useServerCapability("multiOwner");

/** Whether this server can send email; servers that predate the flag are assumed to. */
export const useServerEmailDelivery = (): boolean => useServerCapability("emailDelivery");

export async function serverSupportsWrappedSecretsCas(): Promise<boolean> {
  await refreshServerCapabilities();
  return useServerCapabilities.getState().wrappedSecretsCas;
}
