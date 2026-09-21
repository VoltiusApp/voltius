import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Identity, SshKey } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: Object.assign(() => vi.fn(), { getState: () => ({ loadKeys: vi.fn() }) }) }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: Object.assign(() => vi.fn(), { getState: () => ({ loadIdentities: vi.fn() }) }) }));
vi.mock("@/stores/folderStore", () => ({ useFolderStore: () => vi.fn() }));
vi.mock("@/stores/notificationStore", () => ({ useNotificationStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock("@/hooks/useAllFolders", () => ({ useAllFolders: () => [] }));
vi.mock("@/services/publicKeyStore", () => ({ ensurePublicKey: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn() }));

import KeychainItemActionsSheet from "./KeychainItemActionsSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { initialMobileNavState } from "@/stores/mobileNavCore";

const key = { id: "k1", name: "laptop", tags: [], created_at: "", vault_id: "personal" } as unknown as SshKey;
const identity = { id: "i1", username: "root", tags: [], vault_id: "personal" } as unknown as Identity;

afterEach(() => {
  cleanup();
  useMobileNavStore.setState(initialMobileNavState);
});

describe("KeychainItemActionsSheet edit row", () => {
  test("a key pushes the key-edit screen", () => {
    render(<KeychainItemActionsSheet kind="key" item={key} onClose={() => {}} />);
    fireEvent.click(document.querySelector("[data-keychain-action='edit']")!);
    expect(useMobileNavStore.getState().stack).toEqual([{ kind: "key-edit", keyId: "k1" }]);
  });

  test("an identity pushes the identity-edit screen", () => {
    render(<KeychainItemActionsSheet kind="identity" item={identity} onClose={() => {}} />);
    fireEvent.click(document.querySelector("[data-keychain-action='edit']")!);
    expect(useMobileNavStore.getState().stack).toEqual([{ kind: "identity-edit", identityId: "i1" }]);
  });
});
