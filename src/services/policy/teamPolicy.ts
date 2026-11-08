import { invoke } from "@/lib/invoke";
import { clientVersion } from "@/services/clientHeaders";
import { lockPolicyDoc } from "@/services/lockPolicy";
import type { Team, TeamPolicyDoc } from "@/services/teamService";
import type { PolicyIssue } from "@/stores/policyStore";
import { useTeamPolicyStore } from "@/stores/teamPolicyStore";
import { mergeTeamDocs, type TeamPolicyInput } from "./mergeLayers";

interface CheckedTeamDoc {
  doc: TeamPolicyDoc & { defaults: Record<string, unknown> };
  issues: PolicyIssue[];
}

type TeamDoc = { team: Team; text: string };

const docOf = (team: Team): TeamPolicyDoc | null =>
  team.policy !== undefined
    ? team.policy
    : team.lock_policy
      ? { version: 1, policy: lockPolicyDoc(team.lock_policy) }
      : null;

export function teamDocsFrom(teams: Team[]): TeamDoc[] {
  return teams.flatMap((team) => {
    const doc = docOf(team);
    return doc ? [{ team, text: JSON.stringify(doc) }] : [];
  });
}

async function checkDoc({ team, text }: TeamDoc): Promise<{ input: TeamPolicyInput; issues: PolicyIssue[] }> {
  const { doc, issues } = await invoke<CheckedTeamDoc>("policy_check_team_doc", { text });
  return {
    input: { teamId: team.id, teamName: team.name, joinedAt: team.joined_at ?? "", policy: doc.policy },
    issues: issues.map((i) => ({ ...i, message: `${team.name}: ${i.message}` })),
  };
}

let refreshSeq = 0;

export function clearTeamPolicy(): void {
  refreshSeq++;
  useTeamPolicyStore.getState().setLayer(null, "");
}

export async function refreshTeamPolicy(teams: Team[]): Promise<void> {
  const seq = ++refreshSeq;
  const docs = teamDocsFrom(teams);
  const rows = docs.map(({ team, text }) => [team.id, team.name, team.joined_at ?? "", team.policy_revision ?? null, text]);
  const inputs = JSON.stringify([await clientVersion(), ...rows]);
  if (seq !== refreshSeq || inputs === useTeamPolicyStore.getState().inputs) return;
  const checked = await Promise.all(docs.map(checkDoc));
  if (seq !== refreshSeq) return;
  const merged = mergeTeamDocs(checked.map((c) => c.input));
  const layer = docs.length ? { ...merged, issues: [...checked.flatMap((c) => c.issues), ...merged.issues] } : null;
  useTeamPolicyStore.getState().setLayer(layer, inputs);
}
