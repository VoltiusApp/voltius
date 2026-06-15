import { useMobileNavStore } from "@/stores/mobileNavStore";
import MobileHeader from "../MobileHeader";
import MobileSnippetList from "../MobileSnippetList";

export default function MobileSnippetsScreen() {
  const push = useMobileNavStore((s) => s.push);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={() => push({ kind: "snippet-edit" })} />
      <MobileSnippetList />
    </div>
  );
}
