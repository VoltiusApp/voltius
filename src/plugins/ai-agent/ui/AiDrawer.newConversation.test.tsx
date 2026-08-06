import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installCatalogI18n } from "../testing/fakeI18n";
import { AiDrawer } from "./AiDrawer";
import { useAgentStore, _setDeps } from "../state/agentStore";
import * as storeMod from "../state/agentStore";
import { CONVERSATION_KEY } from "../state/persistence";

installCatalogI18n();

// @iconify/react schedules an async icon-data-load timer that can fire after
// this file's jsdom environment is torn down, touching `window` and surfacing
// as an unhandled error unrelated to any assertion here. Stub it out — same
// reasoning as AiDrawer.dock.test.tsx.
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));
vi.mock("@voltius/ui", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ConnectionAvatar: () => null,
}));

function mockDeps() {
  const storageDelete = vi.fn();
  const deps = {
    api: {
      storage: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        delete: storageDelete,
      },
      connections: {
        list: vi.fn().mockResolvedValue([]),
        subscribe: vi.fn(() => () => {}),
      },
      sessions: {
        list: vi.fn(() => []),
        onConnected: vi.fn(() => () => {}),
        onDisconnected: vi.fn(() => () => {}),
      },
    },
    profiles: {
      getActiveId: vi.fn().mockResolvedValue("p1"),
      list: vi.fn().mockResolvedValue([{ id: "p1", providerKind: "anthropic", label: "A", model: "claude-x" }]),
    },
    controller: {},
  } as never;
  vi.spyOn(storeMod, "getAgentDeps").mockReturnValue(deps);
  // getAgentDeps is spied for the components that call it directly (e.g.
  // ProfileSwitcher), but newConversation reads the module-private `deps`
  // closure itself — set it too, or its storage.get/delete calls never fire.
  _setDeps(deps);
  return { storageDelete };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  _setDeps(null);
});

describe("AiDrawer new-conversation button", () => {
  it("renders with its accessible name, calls the store's newConversation on click, and empties the transcript", async () => {
    const { storageDelete } = mockDeps();
    useAgentStore.setState({
      transcript: [{ kind: "user", text: "old message" }],
      messages: [{ role: "user", content: "old message" }],
    });
    const spy = vi.spyOn(useAgentStore.getState(), "newConversation");

    render(<AiDrawer open={true} onClose={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "New conversation" });
    await userEvent.click(button);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().transcript).toEqual([]);
    expect(useAgentStore.getState().messages).toEqual([]);
    // Exercises the mode-reset half of the action: without `delete` on the
    // storage mock, newConversation's `storage.delete` call throws and
    // rejects unhandled, and the assertions above passed regardless.
    await vi.waitFor(() => expect(storageDelete).toHaveBeenCalledWith(CONVERSATION_KEY));
  });
});
