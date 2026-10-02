import { describe, it, expect } from "vitest";
import { isFileOnlyProtocol, parseWebdavUrl, protocolLabel } from "./connectionType";

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
