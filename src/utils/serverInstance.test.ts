import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_URL,
  instanceLabel,
  isDefaultServer,
  lastServerUrl,
  rememberServer,
} from "./serverInstance";

describe("isDefaultServer", () => {
  it("accepts the official cloud", () => {
    expect(isDefaultServer(DEFAULT_SERVER_URL)).toBe(true);
  });

  it("ignores trailing slashes and case", () => {
    expect(isDefaultServer("HTTPS://API.VOLTIUS.APP//")).toBe(true);
  });

  it("rejects a self-hosted instance", () => {
    expect(isDefaultServer("https://stackdome.example.tld")).toBe(false);
  });

  it("treats a missing URL as the default, so nothing gets marked on a guess", () => {
    expect(isDefaultServer(null)).toBe(true);
  });
});

describe("instanceLabel", () => {
  it("leaves the official cloud unlabelled", () => {
    expect(instanceLabel(DEFAULT_SERVER_URL)).toBeNull();
  });

  it("labels a self-hosted instance with its host", () => {
    expect(instanceLabel("https://stackdome.example.tld")).toBe("stackdome.example.tld");
  });

  it("drops an api. or www. prefix that carries no information", () => {
    expect(instanceLabel("https://api.stackdome.example.tld")).toBe("stackdome.example.tld");
    expect(instanceLabel("https://www.stackdome.example.tld")).toBe("stackdome.example.tld");
  });

  it("keeps the prefix when dropping it would leave a bare name", () => {
    expect(instanceLabel("https://api.local")).toBe("api.local");
  });

  it("keeps a non-default port, which is what distinguishes two instances on one host", () => {
    expect(instanceLabel("http://192.168.1.40:8443")).toBe("192.168.1.40:8443");
  });

  it("drops the port when it is the scheme's own", () => {
    expect(instanceLabel("https://stackdome.example.tld:443")).toBe("stackdome.example.tld");
  });

  it("returns null for a URL it cannot parse, so the caller falls back to Cloud", () => {
    expect(instanceLabel("not a url")).toBeNull();
    expect(instanceLabel(null)).toBeNull();
    expect(instanceLabel("")).toBeNull();
  });
});

describe("the last server signed in to", () => {
  beforeEach(() => localStorage.clear());

  it("is the official cloud until something else is used", () => {
    expect(lastServerUrl()).toBe(DEFAULT_SERVER_URL);
  });

  it("is remembered across the sign-out that adding an account performs", () => {
    rememberServer("https://stackdome.example.tld");
    expect(lastServerUrl()).toBe("https://stackdome.example.tld");
  });

  it("ignores a value it could not parse rather than seeding a broken field", () => {
    rememberServer("not a url");
    expect(lastServerUrl()).toBe(DEFAULT_SERVER_URL);
  });
});
