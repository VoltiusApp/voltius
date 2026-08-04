import { describe, expect, it } from "vitest";
import { scanForSecrets } from "./snippetSecretScan";

const kinds = (text: string) => scanForSecrets(text).map(f => f.kind).sort();

// Assembled at runtime so this file never contains a literal shaped like a live
// credential. The scanner sees the same strings; a repo secret scanner does not,
// and so does not cry wolf on every PR that touches these tests.
const stripeish = ["sk", "live", "9f8a7b6c5d4e3f2a1b0c"].join("-");
const githubish = "gh" + "p_" + "abcdefghijklmnop";
const bearerish = "Bearer " + "abcdef123456";
const passwordish = "hunter" + "2";
const keyHeader = ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" ");

describe("scanForSecrets", () => {
  it("flags a private key block", () => {
    expect(kinds(`${keyHeader}\nabc\n`)).toContain("privateKey");
  });

  it("flags an assigned password", () => {
    expect(kinds(`mysql -u root --password=${passwordish}`)).toContain("credential");
  });

  it("flags an assigned token or api key", () => {
    expect(kinds(`export API_KEY=${stripeish}`)).toContain("credential");
    expect(kinds(`curl -H "Authorization: ${bearerish}"`)).toContain("token");
  });

  it("flags a routable IP address", () => {
    expect(kinds("ssh admin@203.0.113.42")).toContain("host");
  });

  it("flags a hostname that looks like real infrastructure", () => {
    expect(kinds("rsync -a ./ backup@vault.internal.acme.com:/srv")).toContain("host");
  });

  it("reports the matched text so the user can see what tripped it", () => {
    const found = scanForSecrets(`export TOKEN=${githubish}`);
    expect(found[0].match).toContain(githubish);
  });

  it("does not flag ordinary commands", () => {
    for (const cmd of [
      "docker ps -a",
      "journalctl -u nginx -f",
      "df -h && free -m",
      "systemctl restart nginx",
      "ss -tulpn | sort -k5",
      "tar czf backup.tar.gz /etc",
    ]) {
      expect(scanForSecrets(cmd)).toEqual([]);
    }
  });

  it("does not flag localhost or private-range addresses", () => {
    expect(scanForSecrets("curl http://127.0.0.1:8080/health")).toEqual([]);
    expect(scanForSecrets("ssh user@192.168.1.10")).toEqual([]);
  });

  it("does not flag a placeholder variable", () => {
    expect(scanForSecrets("mysql --password={{db_password}}")).toEqual([]);
  });

  it("reports each distinct finding once", () => {
    const text = "echo 203.0.113.42\necho 203.0.113.42";
    expect(scanForSecrets(text)).toHaveLength(1);
  });
});
