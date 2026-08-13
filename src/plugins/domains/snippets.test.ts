import { describe, expect, it, vi } from "vitest";
import type { Snippet } from "@/types";
import type { RunTarget } from "@/services/sftpTarget";
import { createSnippetsAPI, type SnippetPorts } from "./snippets";

const snippet = (over: Partial<Snippet> = {}): Snippet => ({
  id: "s1",
  name: "Restart nginx",
  steps: [{ kind: "script", content: "systemctl restart nginx" }],
  tags: ["ops"],
  favorite: false,
  only_for_connection_tags: [],
  only_for_distros: [],
  created_at: "", updated_at: "", vault_id: "personal", clocks: {},
  ...over,
} as Snippet);

function makePorts(over: Partial<SnippetPorts> = {}, items: Snippet[] = [snippet()]) {
  const ports: SnippetPorts = {
    hydrate: vi.fn(async () => {}),
    list: () => items,
    create: vi.fn(async (data) => snippet({ id: "s2", name: data.name })),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    isTeamVault: (id) => id === "team-1",
    resolveTargets: vi.fn(() => ({
      targets: [{ kind: "session" as const, sessionId: "sess-1", sessionType: "ssh", label: "web-01" }],
      unknown: [],
    })),
    run: vi.fn(async () => ({ targets: [{ label: "web-01", ok: true }], flattenErrors: [] })),
    // Mirrors the engine: the preview resolves the variables it was given.
    preview: vi.fn((_s: Snippet, ts: RunTarget[], variables?: Record<string, string>) => ({
      targets: ts.map((t: RunTarget) => ({
        label: t.kind === "connection" ? t.connection.host : t.sessionId,
        steps: [{ kind: "script" as const, content: `echo ${variables?.svc ?? "{{svc}}"}` }],
      })),
      errors: [],
    })),
    ...over,
  };
  return { ports, api: createSnippetsAPI(ports) };
}

describe("snippets domain", () => {
  it("hydrates before listing, so a cold app does not report an empty vault", async () => {
    const hydrate = vi.fn(async () => {});
    const { api } = makePorts({ hydrate });
    await api.list();
    expect(hydrate).toHaveBeenCalled();
  });

  it("projects placement so a moved snippet can be found again", async () => {
    const { api } = makePorts({}, [snippet({ vault_id: "v1", folder_id: "f1" })]);
    expect(await api.list()).toMatchObject([{ vault_id: "v1", folder_id: "f1" }]);
  });

  it("reports a snippet with no vault as personal and no folder as the root", async () => {
    const { api } = makePorts({}, [snippet({ vault_id: undefined, folder_id: undefined })]);
    expect(await api.list()).toMatchObject([{ vault_id: "personal", folder_id: null }]);
  });

  it("keeps the fields an update does not name", async () => {
    const update = vi.fn(async () => {});
    const { api } = makePorts({ update });
    await api.update("s1", { name: "Reload nginx" });
    // updateSnippet takes a whole form, so a patch that named one field would
    // blank the steps — the whole point of the snippet.
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({
      name: "Reload nginx",
      steps: [{ kind: "script", content: "systemctl restart nginx" }],
      tags: ["ops"],
    }));
  });

  it("refuses to change a snippet in a team vault", async () => {
    const update = vi.fn(async () => {});
    const { api } = makePorts({ update }, [snippet({ vault_id: "team-1" })]);
    await expect(api.update("s1", { name: "x" })).rejects.toThrow(/team vault/);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to delete a snippet in a team vault", async () => {
    const remove = vi.fn(async () => {});
    const { api } = makePorts({ remove }, [snippet({ vault_id: "team-1" })]);
    await expect(api.delete("s1")).rejects.toThrow(/team vault/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses to create into a team vault", async () => {
    const create = vi.fn(async () => snippet());
    const { api } = makePorts({ create });
    await expect(api.create({ name: "x", steps: [], vault_id: "team-1" })).rejects.toThrow(/team vault/);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an empty name rather than saving an unnamed snippet", async () => {
    const { api } = makePorts();
    await expect(api.create({ name: "  ", steps: [] })).rejects.toThrow(/name cannot be empty/);
    await expect(api.update("s1", { name: "  " })).rejects.toThrow(/name cannot be empty/);
  });

  it("names the id when it matches nothing", async () => {
    const { api } = makePorts({}, []);
    await expect(api.delete("nope")).rejects.toThrow('Snippet "nope" not found');
  });
});

describe("snippets domain — run", () => {
  it("runs and projects the per-target outcome", async () => {
    const { api, ports } = makePorts();
    const res = await api.run({
      snippetId: "s1",
      targets: [{ session_id: "sess-1" }],
      variables: { svc: "nginx" },
    });
    expect(res.targets).toEqual([{ label: "web-01", ok: true, error: undefined }]);
    expect(res.flatten_errors).toEqual([]);
    // The caller's variables must reach the engine, not a prompt.
    expect(ports.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
      expect.any(Array),
      expect.any(Function),
      { svc: "nginx" },
    );
  });

  it("reports the sessions the run opened, so they can be read back", async () => {
    const { api } = makePorts({
      run: vi.fn(async () => ({ targets: [], flattenErrors: [], openedSessionIds: ["sess-9"] })),
    });
    const res = await api.run({ snippetId: "s1", targets: [{ connection_id: "c-1" }] });
    expect(res.opened_session_ids).toEqual(["sess-9"]);
  });

  it("refuses when a user variable is still missing, naming it", async () => {
    const { api } = makePorts({
      run: vi.fn(async (_s, _t, onPrompt) => {
        onPrompt({
          userVars: [{ name: "svc" }, { name: "region" }],
          initialValues: { region: "eu" },
        } as never);
        return "prompting" as const;
      }),
    });
    await expect(api.run({ snippetId: "s1", targets: [{ session_id: "sess-1" }] }))
      .rejects.toThrow(/Missing variables: svc/);
  });

  it("dry runs the resolved steps, per target, without running anything", async () => {
    const { api, ports } = makePorts();
    const res = await api.run({
      snippetId: "s1",
      targets: [{ session_id: "sess-1" }],
      variables: { svc: "nginx" },
      dryRun: true,
    });
    // Resolved, not the raw template: a dry run reports what would actually run.
    expect(res.steps).toEqual([{ label: "sess-1", steps: [{ kind: "script", content: "echo nginx" }] }]);
    expect(ports.preview).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }), expect.any(Array), { svc: "nginx" },
    );
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("refuses a target reference that resolves to nothing, by name", async () => {
    const { api, ports } = makePorts({
      resolveTargets: vi.fn(() => ({ targets: [], unknown: ["c-9"] })),
    });
    await expect(api.run({ snippetId: "s1", targets: [{ connection_id: "c-9" }] }))
      .rejects.toThrow(/c-9/);
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("refuses a run with no targets rather than reporting a silent success", async () => {
    const { api } = makePorts({ resolveTargets: vi.fn(() => ({ targets: [], unknown: [] })) });
    await expect(api.run({ snippetId: "s1", targets: [] })).rejects.toThrow(/No targets/);
  });
});
