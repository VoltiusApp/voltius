import { mobileSettingsNav, visiblePlugins, MOBILE_HIDDEN_SECTIONS } from "./settingsMobileCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

// shortcuts is hidden on mobile
{
  assertEqual(MOBILE_HIDDEN_SECTIONS.has("shortcuts"), true, "shortcuts hidden");
  assertEqual(MOBILE_HIDDEN_SECTIONS.has("appearance"), false, "appearance not hidden");
}

// mobileSettingsNav drops hidden sections, keeps order + the rest
{
  const nav = [
    { id: "appearance" as const, label: "Appearance", icon: "x" },
    { id: "shortcuts" as const, label: "Shortcuts", icon: "y" },
    { id: "about" as const, label: "About", icon: "z" },
  ];
  const out = mobileSettingsNav(nav);
  assertEqual(out.map((n) => n.id), ["appearance", "about"], "nav drops shortcuts");
}

// visiblePlugins: on desktop keep everything (incl. desktopOnly)
{
  const plugins = [
    { manifest: { id: "a", desktopOnly: true } },
    { manifest: { id: "b" } },
  ];
  const out = visiblePlugins(plugins, false);
  assertEqual(out.map((p) => p.manifest.id), ["a", "b"], "desktop keeps all");
}

// visiblePlugins: on mobile drop desktopOnly
{
  const plugins = [
    { manifest: { id: "a", desktopOnly: true } },
    { manifest: { id: "b" } },
  ];
  const out = visiblePlugins(plugins, true);
  assertEqual(out.map((p) => p.manifest.id), ["b"], "mobile drops desktopOnly");
}
