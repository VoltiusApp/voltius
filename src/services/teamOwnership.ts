export interface OwnershipContext {
  multiOwner: boolean;
  billingEnabled: boolean;
  billingOwnerId: string | undefined;
  viewerIsOwner: boolean;
  viewerIsPrimary: boolean;
}

export interface OwnershipTarget {
  userId: string;
  isMe: boolean;
  isOwner: boolean;
}

export interface MemberOwnership {
  isOwner: boolean;
  isPrimaryOwner: boolean;
  /** Out of the viewer's reach: no removal, no Owner-role change. */
  protectedFromViewer: boolean;
  canLeave: boolean;
  canGrantOwner: boolean;
  canMakePrimary: boolean;
}

export function memberOwnership(ctx: OwnershipContext, target: OwnershipTarget): MemberOwnership {
  const isPrimaryOwner = !!ctx.billingOwnerId && target.userId === ctx.billingOwnerId;
  const ownerPeer = ctx.multiOwner && ctx.viewerIsOwner;
  return {
    isOwner: target.isOwner,
    isPrimaryOwner,
    protectedFromViewer: isPrimaryOwner || (target.isOwner && !ownerPeer),
    canLeave: target.isMe && !isPrimaryOwner && (ctx.multiOwner || !target.isOwner),
    canGrantOwner: ownerPeer && !target.isMe && !isPrimaryOwner,
    canMakePrimary: ctx.multiOwner && target.isOwner && !isPrimaryOwner
      && (ctx.viewerIsPrimary || (!ctx.billingEnabled && ctx.viewerIsOwner)),
  };
}
