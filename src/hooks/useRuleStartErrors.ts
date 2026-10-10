import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeError } from "@/services/backendErrors";
import { openRuleTunnel } from "@/services/portForwardingTunnels";
import type { ActiveTunnel, PortForwardingRule } from "@/types";

export function useRuleStartErrors(): {
  /** Why a rule is not running: its tunnel's own error, else its last failed start. */
  errorFor: (ruleId: string, tunnel?: ActiveTunnel) => string | undefined;
  startRuleOn: (sessionId: string, rule: PortForwardingRule) => Promise<void>;
} {
  const { t } = useTranslation();
  const [startErrors, setStartErrors] = useState<ReadonlyMap<string, string>>(new Map());

  function setError(ruleId: string, message: string | null) {
    setStartErrors((prev) => {
      const next = new Map(prev);
      if (message) next.set(ruleId, message);
      else next.delete(ruleId);
      return next;
    });
  }

  async function startRuleOn(sessionId: string, rule: PortForwardingRule) {
    setError(rule.id, null);
    try {
      await openRuleTunnel(sessionId, rule);
    } catch (e) {
      setError(rule.id, describeError(e, t));
    }
  }

  function errorFor(ruleId: string, tunnel?: ActiveTunnel) {
    if (!tunnel) return startErrors.get(ruleId);
    return typeof tunnel.state === "object" && "error" in tunnel.state ? tunnel.state.error : undefined;
  }

  return { errorFor, startRuleOn };
}
