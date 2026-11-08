import { usePolicyStore } from "@/stores/policyStore";

const EMPTY = { policy: {}, defaults: {} };

export const withPolicy = (policy: Record<string, unknown>) =>
  usePolicyStore.setState({ machine: { policy, defaults: {} }, server: EMPTY });

export const resetPolicy = () => usePolicyStore.setState({ machine: EMPTY, server: EMPTY, issues: [] });
