// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Connection } from "@/types";

vi.mock("@/hooks/useAllSnippets", () => ({
  useAllSnippets: () => [
    { id: "personal-snippet", vault_id: "personal" },
    { id: "team-snippet", vault_id: "team-1" },
  ],
}));
vi.mock("@/hooks/useWritableVaultIds", () => ({ resolveVaultIdForSave: (id: string) => id }));

import { useHostCommandFields } from "./formShared";

const host = { id: "h", pre_snippet_id: "personal-snippet", post_snippet_id: "team-snippet" } as Connection;

test("a vault change drops the snippets left outside the new vault and keeps the rest", () => {
  const { result, rerender } = renderHook(({ vaultId }) => useHostCommandFields(host, vaultId), {
    initialProps: { vaultId: "personal" },
  });
  expect(result.current.preSnippetId).toBe("personal-snippet");

  rerender({ vaultId: "team-1" });
  expect(result.current.vaultId).toBe("team-1");
  expect(result.current.preSnippetId).toBeUndefined();
  expect(result.current.postSnippetId).toBe("team-snippet");
});
