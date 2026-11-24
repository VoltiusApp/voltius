import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Pills } from "@/components/shared/Pills";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore, type KeysDrawerTab } from "@/stores/uiStore";
import { writeToSession } from "@/hooks/useTerminal";
import { haptic } from "@/lib/haptics";
import { DRAWER_KEYS, DRAWER_TABS, type DrawerKey } from "./extraKeysCore";
import { KEY_CLASS, KEY_STYLE, LatchKey, keepKeyboardClosed, noFocusSteal, pressKey, useTapKey } from "./mobileKeys";
import { useTerminalPanelItems } from "./terminalPanelItems";

function DrawerKeyButton({ k, sessionId }: { k: DrawerKey; sessionId: string | null }) {
  const { t } = useTranslation();
  const tapHandlers = useTapKey(() => {
    if (k.kind === "key") { pressKey(sessionId, k.key); return; }
    if (!sessionId) return;
    haptic("key");
    writeToSession(sessionId, k.bytes);
  });
  if (k.kind === "key") {
    return (
      <button data-mobile-drawer-key={k.key} aria-label={k.icon ? k.label : undefined} {...tapHandlers}
        className={`${KEY_CLASS} font-medium`} style={KEY_STYLE}>
        {k.icon ? <Icon icon={k.icon} width={18} /> : k.label}
      </button>
    );
  }
  return (
    <button data-mobile-drawer-key={k.label} {...tapHandlers} className={`${KEY_CLASS} flex-col gap-0.5`} style={KEY_STYLE}>
      <span className="text-sm font-semibold leading-none">{k.label}</span>
      <span className="max-w-full overflow-hidden text-ellipsis text-[9px] leading-none whitespace-nowrap" style={{ color: "var(--t-text-secondary)" }}>
        {t(`mobile.keysDrawer.captions.${k.caption}`)}
      </span>
    </button>
  );
}

function PanelChips() {
  const items = useTerminalPanelItems();
  return (
    <div className="h-full grid grid-rows-2 grid-flow-col auto-cols-max gap-0.5 overflow-x-auto scrollbar-none" style={{ touchAction: "pan-x" }}>
      {items.map((it) => (
        <button key={it.key} data-mobile-panel-quick={it.key} onClick={it.onTap}
          className="flex items-center gap-1.5 px-3 rounded-[9px] text-xs font-medium" style={KEY_STYLE}>
          <Icon icon={it.icon} width={15} />{it.label}
        </button>
      ))}
    </div>
  );
}

/** Tabbed keys above the extra-keys row: navigation, readline chords, F-keys and the terminal panels. */
export default function MobileKeysDrawer({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { t } = useTranslation();
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const tab = useUIStore((s) => s.terminalKeysDrawerTab);
  const setTab = useUIStore((s) => s.setTerminalKeysDrawerTab);
  return (
    <div data-mobile-keys-drawer className="shrink-0 flex flex-col gap-0.5 px-1 pt-1 pb-0.5 border-t"
      style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
      onMouseDown={noFocusSteal} onTouchStart={() => keepKeyboardClosed(keyboardOpen)}>
      <div className="flex items-center gap-1 px-0.5">
        <div className="flex-1 min-w-0">
          <Pills<KeysDrawerTab> value={tab} onChange={setTab}
            options={DRAWER_TABS.map((value) => ({ value, label: t(`mobile.keysDrawer.tabs.${value}`) }))} />
        </div>
        <LatchKey mod="shift" className="relative w-14 h-[30px] rounded-[9px] text-xs font-semibold flex items-center justify-center gap-1">
          <Icon icon="lucide:arrow-big-up" width={14} />Shift
        </LatchKey>
      </div>
      {/* Every tab is two key rows tall, so switching tabs never resizes the terminal. */}
      <div className="h-[78px]">
        {tab === "panels"
          ? <PanelChips />
          : <div className="grid grid-cols-6 gap-0.5">{DRAWER_KEYS[tab].map((k) => <DrawerKeyButton key={k.label} k={k} sessionId={sessionId} />)}</div>}
      </div>
    </div>
  );
}
