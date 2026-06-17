import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appFetch } from "@/services/http";
import { checkoutRequiresEmailVerification } from "@/utils/emailVerification";

export const EMAIL_VERIFICATION_REQUIRED_EVENT = "voltius:email-verification-required";

export type BillingPlan = "pro" | "teams";

async function readResponseBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function openBillingCheckout(plan: BillingPlan): Promise<boolean> {
  const [serverUrl, jwt] = await Promise.all([
    invoke<string | null>("keychain_get", { key: "server_url" }),
    invoke<string | null>("keychain_get", { key: "jwt" }),
  ]);
  if (!serverUrl || !jwt) return false;

  const res = await appFetch(`${serverUrl}/v1/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ plan }),
  });
  const body = await readResponseBody(res);

  if (!res.ok) {
    if (checkoutRequiresEmailVerification(res.status, body)) {
      window.dispatchEvent(new CustomEvent(EMAIL_VERIFICATION_REQUIRED_EVENT));
    }
    return false;
  }

  const { checkout_url } = body as { checkout_url: string };
  await openUrl(checkout_url);
  return true;
}
