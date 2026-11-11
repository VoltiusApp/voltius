import { buildEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { mergeTeamDocs } from "@/services/policy/mergeLayers";
import { useEnrolledTeamStore } from "@/stores/enrolledTeamStore";
import { usePolicyStore } from "@/stores/policyStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";

const EMPTY = { policy: {}, defaults: {} };

export const ENROLL_SERVER = "https://srv.example";
export const ENROLL_SECRET = "s".repeat(43);
export const ENROLL_ID = "a".repeat(32);
export const enrollmentTokenText = (id = ENROLL_ID, server = ENROLL_SERVER) => buildEnrollmentToken(server, id, ENROLL_SECRET);

export const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} } });

export const resetPolicy = () => {
  usePolicyStore.setState({ machine: EMPTY, issues: [] });
  useTeamPolicyStore.setState({ layer: null, inputs: "" });
  useEnrolledTeamStore.setState({ entry: null });
};

export const echoTeamDoc = async (cmd: string, args?: unknown) =>
  cmd === "policy_check_team_doc"
    ? { doc: { ...JSON.parse((args as { text: string }).text), defaults: {} }, issues: [] }
    : undefined;

const singleTeamLayer = (policy: Record<string, unknown>, team: string) =>
  mergeTeamDocs([{ teamId: team, teamName: team, joinedAt: "", policy }]);

export const withTeamPolicy = (policy: Record<string, unknown>, team = "Acme") =>
  useTeamPolicyStore.getState().setLayer(singleTeamLayer(policy, team), team);

export const withEnrolledTeam = (policy: Record<string, unknown>, team = "Acme", tokenId = ENROLL_ID) =>
  useEnrolledTeamStore.getState().setEntry({
    tokenId,
    server: ENROLL_SERVER,
    teamId: team,
    teamName: team,
    revision: 1,
    layer: singleTeamLayer(policy, team),
  });
