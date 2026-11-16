import MobilePanelHeader from "../panels/MobilePanelHeader";

export default function MobileMemberScreen({ teamId, userId }: { teamId: string; userId: string }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-member={`${teamId}:${userId}`}>
      <MobilePanelHeader title={userId} />
    </div>
  );
}
