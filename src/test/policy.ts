import { mergeTeamDocs } from "@/services/policy/mergeLayers";
import { usePolicyStore } from "@/stores/policyStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";

const EMPTY = { policy: {}, defaults: {} };

export const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} } });

export const resetPolicy = () => {
  useTeamPolicyStore.setState({ layer: null, inputs: "" });
  usePolicyStore.setState({ machine: EMPTY, issues: [] });
};

export const echoTeamDoc = async (cmd: string, args?: unknown) =>
  cmd === "policy_check_team_doc"
    ? { doc: { ...JSON.parse((args as { text: string }).text), defaults: {} }, issues: [] }
    : undefined;

export const withTeamPolicy = (policy: Record<string, unknown>, team = "Acme") =>
  useTeamPolicyStore.getState().setLayer(mergeTeamDocs([{ teamId: team, teamName: team, joinedAt: "", policy }]), team);
