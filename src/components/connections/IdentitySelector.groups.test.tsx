import { afterEach, test, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Identity } from "@/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import IdentitySelector from "./IdentitySelector";

afterEach(cleanup);

const ident = (id: string, name: string) => ({ id, name, username: id, tags: [] }) as unknown as Identity;

test("with own identities the list shows shared and own groups", () => {
  render(
    <IdentitySelector value={null} identities={[ident("t", "ops-deploy")]} ownIdentities={[ident("o", "Alice")]} sharedLabel="Ops vault · shared" onChange={() => {}} onGoToKeychain={() => {}} />,
  );
  fireEvent.click(screen.getByText("connections.identitySelector.noIdentityInline"));
  expect(screen.getByText("Ops vault · shared")).toBeTruthy();
  expect(screen.getByText("connections.identitySelector.ownGroup")).toBeTruthy();
  expect(screen.getByText("Alice")).toBeTruthy();
});

test("without own identities the list is unchanged", () => {
  render(<IdentitySelector value={null} identities={[ident("t", "ops-deploy")]} onChange={() => {}} onGoToKeychain={() => {}} />);
  fireEvent.click(screen.getByText("connections.identitySelector.noIdentityInline"));
  expect(screen.queryByText("connections.identitySelector.ownGroup")).toBeNull();
});
