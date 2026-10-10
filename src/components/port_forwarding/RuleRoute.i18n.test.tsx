import { expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en/portForwarding.json";
import { RouteSummary } from "./RuleRoute";

vi.mock("@iconify/react", () => ({ Icon: () => null }));

it("prints the angle-bracket placeholders as written", async () => {
  await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const anyAddress = i18n.t("portForwarding.ruleForm.summary.anyAddress");
  const { container } = render(
    <RouteSummary summary={{ variant: "localShared", listener: `${anyAddress}:8080`, target: "db:80", command: "ssh -L 0.0.0.0:8080:db:80 <host>" }} />,
  );
  expect(container.querySelector("p")?.textContent).toBe("Devices on the network open <your-ip>:8080 to reach db:80 as the SSH server sees it.");
});
