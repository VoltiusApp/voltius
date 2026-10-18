import { describe, expect, test } from "vitest";
import { memberOwnership, type OwnershipContext } from "@/services/teamOwnership";

const ctx = (over: Partial<OwnershipContext> = {}): OwnershipContext => ({
  multiOwner: true,
  billingEnabled: true,
  billingOwnerId: "primary",
  viewerIsOwner: false,
  viewerIsPrimary: false,
  ...over,
});
const of = (c: OwnershipContext, id: string, isOwner: boolean, me = "me") =>
  memberOwnership(c, { userId: id, isMe: id === me, isOwner });

describe("memberOwnership", () => {
  test("the primary owner is out of everyone's reach and cannot leave", () => {
    for (const viewerIsOwner of [false, true]) {
      const o = of(ctx({ viewerIsOwner }), "primary", true);
      expect(o.isPrimaryOwner).toBe(true);
      expect(o.protectedFromViewer).toBe(true);
      expect(o.canGrantOwner).toBe(false);
      expect(o.canMakePrimary).toBe(false);
    }
    expect(of(ctx({ viewerIsPrimary: true, viewerIsOwner: true }), "primary", true, "primary").canLeave).toBe(false);
  });

  test("a co-owner is protected from non-owners only", () => {
    expect(of(ctx(), "bob", true).protectedFromViewer).toBe(true);
    expect(of(ctx({ viewerIsOwner: true }), "bob", true).protectedFromViewer).toBe(false);
    expect(of(ctx({ viewerIsOwner: true }), "bob", true).canGrantOwner).toBe(true);
    expect(of(ctx(), "bob", false).canGrantOwner).toBe(false);
  });

  test("a co-owner may leave on a multi-owner server", () => {
    expect(of(ctx({ viewerIsOwner: true }), "bob", true, "bob").canLeave).toBe(true);
    expect(of(ctx({ viewerIsOwner: true, multiOwner: false }), "bob", true, "bob").canLeave).toBe(false);
  });

  test("on the cloud only the primary owner hands billing over", () => {
    expect(of(ctx({ viewerIsOwner: true }), "bob", true).canMakePrimary).toBe(false);
    expect(of(ctx({ viewerIsPrimary: true, viewerIsOwner: true }), "bob", true).canMakePrimary).toBe(true);
    expect(of(ctx({ viewerIsPrimary: true, viewerIsOwner: true }), "bob", false).canMakePrimary).toBe(false);
  });

  test("self-hosted, any owner can make another owner, or themselves, primary", () => {
    const c = ctx({ billingEnabled: false, viewerIsOwner: true });
    expect(of(c, "bob", true).canMakePrimary).toBe(true);
    expect(of(c, "me", true).canMakePrimary).toBe(true);
  });

  test("an old server keeps the single-owner rules", () => {
    const c = ctx({ multiOwner: false, viewerIsOwner: true, viewerIsPrimary: true });
    expect(of(c, "bob", true).protectedFromViewer).toBe(true);
    expect(of(c, "bob", true).canGrantOwner).toBe(false);
    expect(of(c, "bob", true).canMakePrimary).toBe(false);
    expect(of(c, "carol", false).protectedFromViewer).toBe(false);
  });
});
