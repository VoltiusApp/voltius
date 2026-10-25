// Drives the Voltius iOS app in the simulator: real taps through XCUITest,
// DOM reads through the WebView context. Every step leaves a screenshot and a
// DOM dump in OUT_DIR; a failing step is recorded and the run goes on, so one
// run reports every broken step at once.
//
// Env: APP_PATH (.app), UDID (booted simulator), OUT_DIR, SSH_PORT, SSH_USER,
//      SSH_PASSWORD, SSH_LOG_DIR (where ssh_server.py writes its logs).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { remote } from "webdriverio";
import * as page from "./page.js";

const OUT = process.env.OUT_DIR;
const UDID = process.env.UDID;
const SSH = {
  host: "127.0.0.1",
  port: process.env.SSH_PORT,
  user: process.env.SSH_USER,
  password: process.env.SSH_PASSWORD,
  logs: process.env.SSH_LOG_DIR,
};
const HOST_LABEL = "e2e-local";
const MARKER = "voltius-e2e-ok";

fs.mkdirSync(OUT, { recursive: true });
const results = [];
let stepNo = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const driver = await remote({
  hostname: "127.0.0.1",
  port: 4723,
  path: "/",
  logLevel: "warn",
  connectionRetryTimeout: 15 * 60 * 1000,
  connectionRetryCount: 1,
  capabilities: {
    platformName: "iOS",
    "appium:automationName": "XCUITest",
    "appium:udid": UDID,
    "appium:app": process.env.APP_PATH,
    "appium:bundleId": "app.voltius",
    "appium:newCommandTimeout": 900,
    "appium:wdaLaunchTimeout": 15 * 60 * 1000,
    "appium:wdaConnectionTimeout": 15 * 60 * 1000,
    "appium:webviewConnectTimeout": 180000,
    "appium:fullContextList": true,
    "appium:connectHardwareKeyboard": false,
    "appium:autoAcceptAlerts": false,
  },
});

// ---------------------------------------------------------------- contexts

let webContext = null;
let current = "NATIVE_APP";

async function toWeb(timeoutMs = 180000) {
  if (webContext && current === webContext) return;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const contexts = await driver.getContexts();
    const web = contexts.find((c) => {
      const id = typeof c === "string" ? c : c.id;
      return id.startsWith("WEBVIEW") && (typeof c === "string" || !c.bundleId || c.bundleId === "app.voltius");
    });
    if (web) {
      const id = typeof web === "string" ? web : web.id;
      if (id !== webContext) log("webview context", JSON.stringify(web));
      webContext = id;
      await driver.switchContext(id);
      current = id;
      return;
    }
    await sleep(2000);
  }
  throw new Error("no WEBVIEW context: is the WKWebView inspectable?");
}

async function toNative() {
  if (current === "NATIVE_APP") return;
  await driver.switchContext("NATIVE_APP");
  current = "NATIVE_APP";
}

async function web(fn, ...args) {
  await toWeb();
  try {
    return await driver.execute(fn, ...args);
  } catch (e) {
    // The page may have navigated or the context id changed: resolve it again once.
    current = "NATIVE_APP";
    webContext = null;
    await toWeb();
    return driver.execute(fn, ...args);
  }
}

// ---------------------------------------------------------------- evidence

function shot(name) {
  const file = path.join(OUT, `${name}.png`);
  try {
    execFileSync("xcrun", ["simctl", "io", UDID, "screenshot", file], { stdio: "ignore" });
  } catch (e) {
    log("screenshot failed", e.message);
  }
}

async function dump(name) {
  try {
    const d = await web(page.dumpPage);
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(d, null, 2));
    return d;
  } catch (e) {
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ error: String(e) }));
    return null;
  }
}

function sshLog(file) {
  try {
    return fs.readFileSync(path.join(SSH.logs, file), "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- actions

async function webviewOrigin() {
  await toNative();
  const wv = await driver.$("-ios class chain:**/XCUIElementTypeWebView");
  const rect = await driver.getElementRect(await wv.elementId);
  return rect;
}

/** Native tap at the centre of a CSS-pixel rect of the WebView. */
async function tapRect(rect) {
  const [x, y, w, h] = rect;
  // Rects are in layout-viewport CSS pixels; iOS may have zoomed the page (input
  // focus zoom), so map through the visual viewport's offset and size.
  const vv = await web(() => {
    const v = window.visualViewport;
    return v ? [v.offsetLeft, v.offsetTop, v.width, v.height] : [0, 0, innerWidth, innerHeight];
  });
  const origin = await webviewOrigin();
  const sx = origin.width / vv[2];
  const sy = origin.height / vv[3];
  const px = Math.round(origin.x + (x + w / 2 - vv[0]) * sx);
  const py = Math.round(origin.y + (y + h / 2 - vv[1]) * sy);
  await driver.execute("mobile: tap", { x: px, y: py });
  return [px, py];
}

async function waitText(pattern, timeoutMs = 30000) {
  const re = new RegExp(pattern, "i");
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    try {
      last = await web(() => document.body.innerText || "");
      if (re.test(last)) return true;
    } catch {
      /* page reloading */
    }
    await sleep(1000);
  }
  throw new Error(`text /${pattern}/ not shown after ${timeoutMs / 1000}s`);
}

async function tap(pattern, { timeoutMs = 20000, js = false } = {}) {
  const end = Date.now() + timeoutMs;
  let found = null;
  while (Date.now() < end && !found) {
    found = await web(page.findTarget, pattern);
    if (!found) await sleep(1000);
  }
  if (!found) throw new Error(`nothing matches /${pattern}/`);
  if (js) {
    await web(page.clickLastTarget);
    return `js-click <${found.tag}> "${found.text}"`;
  }
  const at = await tapRect(found.rect);
  return `tap <${found.tag}> "${found.text}" at ${at}`;
}

async function tapSel(selector) {
  const rect = await web(page.rectOf, selector);
  if (!rect) throw new Error(`no element ${selector}`);
  const at = await tapRect(rect);
  return `tap ${selector} at ${at}`;
}

async function fill(pattern, value) {
  await web(page.resetView);
  const found = await web(page.findInput, pattern);
  if (!found) throw new Error(`no input matches /${pattern}/`);
  await tapRect(found.rect);
  await sleep(400);
  await web(page.findInput, pattern);
  const ok = await web(page.setInputValue, value);
  if (!ok) throw new Error(`could not set /${pattern}/`);
  return `filled [${found.described}]`;
}

async function optional(fn) {
  try {
    return await fn();
  } catch (e) {
    return `skipped (${e.message})`;
  }
}

// ---------------------------------------------------------------- steps

async function step(name, fn) {
  stepNo += 1;
  const id = `${String(stepNo).padStart(2, "0")}-${name}`;
  log("STEP", id);
  const started = Date.now();
  let status = "ok";
  let detail = "";
  try {
    detail = (await fn()) || "";
  } catch (e) {
    status = "FAILED";
    detail = e.message.split("\n")[0];
  }
  await sleep(1500);
  shot(id);
  const d = await dump(id);
  results.push({ id, status, detail, secs: Math.round((Date.now() - started) / 1000), text: d ? d.text.slice(0, 300) : "" });
  log(status, detail);
  return status === "ok";
}

await step("launch", async () => {
  await toWeb(240000);
  await waitText("Get started|Choose how|Unlock|Hosts", 240000);
  const d = await web(() => [navigator.userAgent, innerWidth, innerHeight]);
  return `webview up: ${d.join(" | ")}`;
});

await step("get-started", async () => {
  const r = await tap("Get started");
  await waitText("New Host|New host|Add Host|Add host|No hosts|Hosts", 60000);
  return r;
});

await step("dismiss-onboarding", async () => {
  // Possible one-off prompts (biometrics, what's new, tips): close them if present.
  const out = [];
  for (const p of ["Not now", "Skip", "Later", "Got it", "Close", "Dismiss", "Maybe later"]) {
    const found = await web(page.findTarget, `^${p}$`);
    if (found) out.push(await tap(`^${p}$`));
  }
  return out.join("; ") || "nothing to dismiss";
});

// Selectors follow MobileShell (same screens as Android): data-mobile-* attributes
// first, visible text as the fallback, so a desktop layout still gets a try.

await step("new-host", async () => {
  let r;
  if (await web(page.rectOf, "[data-mobile-add]")) {
    r = await tapSel("[data-mobile-add]");
    await sleep(1200);
    r += "; " + (await tapSel("[data-add-choice=item]").catch(() => tap("^New host$")));
  } else {
    r = await tap("New Host|New host|Add Host|Add host|Create host");
  }
  await waitText("Host / IP|Hostname|Host or IP|Address", 20000);
  return r;
});

await step("fill-host", async () => {
  const out = [];
  out.push(await optional(() => fill("My Server|Label|Name", HOST_LABEL)));
  out.push(await fill("Host / IP|Hostname|Host or IP|Address|^Host$", SSH.host));
  out.push(await optional(() => fill("^Port$|Port", String(SSH.port))));
  out.push(await fill("Username|User", SSH.user));
  out.push(await fill("Password", SSH.password));
  return out.join("; ");
});

await step("save-host", async () => {
  // The mobile host editor autosaves: wait out the debounce, then go back.
  await sleep(2500);
  const reset = await web(page.resetView);
  await sleep(1200);
  let r = `page was scrolled by ${JSON.stringify(reset.scrolledBy)}; `;
  if (await web(page.rectOf, "[data-mobile-back]")) r += await tapSel("[data-mobile-back]");
  else r += await tap("^(Save|Create|Add|Add host|Save host|Done)$");
  await sleep(1500);
  const text = await web(() => document.body.innerText || "");
  if (/Leave without saving|Discard changes/i.test(text)) {
    r += "; exit guard shown: " + (await tap("^Save$|Keep editing"));
  }
  // Back on the hosts list: the host row exists and the editor is gone.
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const back = await web(() => !!document.querySelector("[data-mobile-hosts] [data-mobile-host]") &&
      !/^(Edit|New) host$/m.test(document.body.innerText || ""));
    if (back) return r;
    await sleep(1000);
  }
  throw new Error(`${r}; still in the host editor`);
});

await step("connect", async () => {
  await web(page.resetView);
  let r = (await web(page.rectOf, "[data-mobile-hosts] [data-mobile-host]"))
    ? await tapSel("[data-mobile-hosts] [data-mobile-host]")
    : await tap(HOST_LABEL);
  // Desktop lists may need a second tap or an explicit Connect button.
  await sleep(3000);
  if (!/CONNECT/.test(sshLog("ssh-events.log"))) {
    r += "; " + (await optional(() => tap("^Connect$|^SSH$|Open terminal")));
  }
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const text = await web(() => document.body.innerText || "");
    if (/fingerprint|unknown host|authenticity|trust this|host key/i.test(text)) {
      r += "; host-key prompt: " + (await tap("^(Trust|Accept|Trust & connect|Connect|Continue|Yes|Add and connect)$"));
    }
    if (/PTY_OPEN/.test(sshLog("ssh-events.log"))) return `${r}; shell open`;
    await sleep(1500);
  }
  const ev = sshLog("ssh-events.log").trim().split("\n").slice(-6).join(" / ");
  throw new Error(`no shell after 45s (server: ${ev || "no event"})`);
});

await step("type-command", async () => {
  const rect = await web(page.terminalRect);
  if (!rect) throw new Error("no terminal on screen");
  await tapRect(rect);
  await sleep(1500);
  let how = "native keyboard";
  try {
    await toNative();
    const focused = await driver.$("-ios predicate string:hasKeyboardFocus == 1");
    await focused.addValue(`echo ${MARKER}\n`);
  } catch (e) {
    how = `native failed (${e.message.split("\n")[0]})`;
  }
  await sleep(3000);
  if (!sshLog("ssh-pty-input.log").includes(`echo ${MARKER}`)) {
    how += "; fallback " + (await web(page.typeInTerminal, `echo ${MARKER}\r`));
    await sleep(3000);
  }
  return how;
});

await step("check-output", async () => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const out = sshLog("ssh-pty-output.log").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "\n");
    if (out.split("\n").some((l) => l.trim() === MARKER)) {
      const rows = await web(() => [...document.querySelectorAll(".xterm-rows > div")].map((d) => d.textContent).join("\n"));
      const onScreen = rows ? (rows.includes(MARKER) ? "visible in DOM rows" : "not in DOM rows") : "WebGL renderer (see screenshot)";
      return `shell printed ${MARKER}; ${onScreen}`;
    }
    await sleep(1000);
  }
  throw new Error(`shell never printed ${MARKER} (input seen: ${JSON.stringify(sshLog("ssh-pty-input.log").slice(-80))})`);
});

await step("open-sftp", async () => {
  // Mobile: terminal top bar "Panels" → SFTP; else the SFTP tab, then pick the host.
  let r;
  try {
    r = await tap("^Panels$");
    await sleep(1200);
    r += "; " + (await tap("^SFTP$"));
  } catch {
    r = await tapSel("[data-mobile-tab=sftp]").catch(() => tap("^SFTP$|Files|Open SFTP"));
    await sleep(1500);
    r += "; " + (await optional(() => tap(HOST_LABEL)));
  }
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (/SFTP_OPEN/.test(sshLog("ssh-events.log"))) return `${r}; SFTP session opened`;
    await sleep(1500);
  }
  throw new Error(`${r}; no SFTP session on the server`);
});

// ---------------------------------------------------------------- report

const lines = [
  "# Voltius iOS simulator run",
  "",
  "| Step | Result | Time | Detail |",
  "| --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.id} | ${r.status} | ${r.secs}s | ${r.detail.replace(/\|/g, "\\|")} |`),
  "",
];
fs.writeFileSync(path.join(OUT, "summary.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
console.log(lines.join("\n"));

await driver.deleteSession().catch(() => {});
process.exit(0);
