import { selectEffectiveSyncStatus } from "./syncStatus.ts";
function eq<T>(a: T, e: T, m: string) { if (JSON.stringify(a) !== JSON.stringify(e)) { console.error(`FAIL ${m}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); throw new Error(m); } console.log(`PASS ${m}`); }

const V = { status: "success" as const, lastSync: null, error: null };
const G = { status: "error" as const, lastSync: null, error: "boom", configured: true };

// Pro server account → Voltius engine wins regardless of gist.
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "server", isPro: true, gistPluginEnabled: true }).status, "success", "server+pro shows voltius");
// No server account but gist configured → gist engine.
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "local", isPro: false, gistPluginEnabled: true }).status, "error", "gist-only shows gist");
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "local", isPro: false, gistPluginEnabled: true }).configured, true, "gist configured");
// Nothing configured → not configured, falls back to voltius state.
eq(selectEffectiveSyncStatus({ voltius: V, gist: { ...G, configured: false }, accountMode: "local", isPro: false, gistPluginEnabled: false }).configured, false, "nothing configured");
console.log("ALL PASS");
