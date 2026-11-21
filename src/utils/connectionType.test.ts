import { describe, it, expect } from "vitest";
import { isFileOnlyProtocol, isWebProtocol, parseWebdavUrl, protocolLabel, webUrl } from "./connectionType";

describe("isFileOnlyProtocol", () => {
  it("is true for FTP and WebDAV only", () => {
    expect(isFileOnlyProtocol({ connection_type: "ftp" })).toBe(true);
    expect(isFileOnlyProtocol({ connection_type: "webdav" })).toBe(true);
    expect(isFileOnlyProtocol({ connection_type: "ssh" })).toBe(false);
    expect(isFileOnlyProtocol({ connection_type: "serial" })).toBe(false);
    expect(isFileOnlyProtocol({})).toBe(false);
  });
});

describe("protocolLabel", () => {
  it("names each protocol", () => {
    expect(protocolLabel({ connection_type: "ftp", ftp_secure: true })).toBe("FTPS");
    expect(protocolLabel({ connection_type: "ftp" })).toBe("FTP");
    expect(protocolLabel({ connection_type: "webdav" })).toBe("WebDAV");
    expect(protocolLabel({ connection_type: "serial" })).toBe("SERIAL");
    expect(protocolLabel({ connection_type: "web", web_secure: true })).toBe("HTTPS");
    expect(protocolLabel({ connection_type: "web" })).toBe("HTTP");
    expect(protocolLabel({})).toBe("SSH");
  });
});

describe("parseWebdavUrl", () => {
  it("derives host and port and adds the trailing slash", () => {
    expect(parseWebdavUrl(" https://cloud.example.com/remote.php/dav/files/me ")).toEqual({
      url: "https://cloud.example.com/remote.php/dav/files/me/", host: "cloud.example.com", port: 443, secure: true,
    });
    expect(parseWebdavUrl("http://nas.local:5005/dav/")).toEqual({
      url: "http://nas.local:5005/dav/", host: "nas.local", port: 5005, secure: false,
    });
    expect(parseWebdavUrl("http://nas.local")?.port).toBe(80);
    expect(parseWebdavUrl("https://[::1]:8443/")?.host).toBe("::1");
  });

  it("rejects what the backend would reject", () => {
    for (const raw of ["", "nas.local/dav", "ftp://h/", "https://u:p@h/", "https://h/?x=1", "https://h/#f", "https://h/?", "https://h/#"]) {
      expect(parseWebdavUrl(raw), raw).toBeNull();
    }
  });
});

describe("isWebProtocol", () => {
  it("is true for web hosts only, which are not file-only", () => {
    expect(isWebProtocol({ connection_type: "web" })).toBe(true);
    expect(isWebProtocol({ connection_type: "webdav" })).toBe(false);
    expect(isWebProtocol({ connection_type: "ssh" })).toBe(false);
    expect(isWebProtocol({})).toBe(false);
    expect(isFileOnlyProtocol({ connection_type: "web" })).toBe(false);
  });
});

describe("webUrl", () => {
  it("builds the URL a web host opens, dropping the scheme's default port", () => {
    expect(webUrl({ host: "192.168.1.3", port: 8006, web_secure: true })).toBe("https://192.168.1.3:8006/");
    expect(webUrl({ host: "example.com", port: 443, web_secure: true })).toBe("https://example.com/");
    expect(webUrl({ host: "example.com", port: 80 })).toBe("http://example.com/");
    expect(webUrl({ host: "example.com", port: 443 })).toBe("http://example.com:443/");
  });

  it("brackets a bare IPv6 literal", () => {
    expect(webUrl({ host: "fd00::1", port: 8443, web_secure: true })).toBe("https://[fd00::1]:8443/");
    expect(webUrl({ host: "[fd00::1]", port: 8443, web_secure: true })).toBe("https://[fd00::1]:8443/");
  });
});
