import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, makeFileOp } from "./helpers";

export const FILE_PERMISSIONS = ["sftp:read", "sftp:write", "audit"] as const;

export function buildFileTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const fileOp = makeFileOp(ports, gate);

  return [
    {
      name: "list_files",
      description:
        "List a directory on a file target. A target is a connection id from list_connections "
        + "(SSH or FTP), or the literal \"local\" for the user's own machine.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => ports.api.sftp.list(String(raw.target), String(raw.path)),
    },
    {
      name: "stat_file",
      description: "Size, type and mtime of one path on a file target. Null when it does not exist.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => ports.api.sftp.stat(String(raw.target), String(raw.path)),
    },
    {
      name: "read_file",
      description: "Read a text file from a file target. Large files are truncated.",
      risk: "auto",
      schema: z.object({ target: z.string(), path: z.string(), maxBytes: z.number().int().positive().optional() }),
      execute: async (raw) => ({
        content: await ports.api.sftp.readText(
          String(raw.target),
          String(raw.path),
          raw.maxBytes as number | undefined,
        ),
      }),
    },
    {
      name: "make_dir",
      description: "Create a directory on a file target. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => fileOp("make_dir", raw, (a) =>
        ports.api.sftp.mkdir(String(a.target), String(a.path))),
    },
    {
      name: "write_file",
      description: "Write text to a path on a file target, replacing it if it exists. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string(), content: z.string() }),
      execute: async (raw) => fileOp("write_file", raw, (a) =>
        ports.api.sftp.writeText(String(a.target), String(a.path), String(a.content))),
    },
    {
      name: "rename_path",
      description: "Rename or move a path within one file target. Prompts.",
      risk: "prompt",
      schema: z.object({ target: z.string(), from: z.string(), to: z.string() }),
      execute: async (raw) => fileOp("rename_path", raw, (a) =>
        ports.api.sftp.rename(String(a.target), String(a.from), String(a.to))),
    },
    {
      name: "delete_path",
      description:
        "Delete a file or directory on a file target. Prompts every time, and cannot be undone.",
      risk: "prompt",
      schema: z.object({ target: z.string(), path: z.string() }),
      execute: async (raw) => fileOp("delete_path", raw, (a) =>
        ports.api.sftp.delete(String(a.target), String(a.path))),
    },
    {
      name: "transfer_file",
      description:
        "Copy a file or directory between any two file targets — host to host, or to and from "
        + "\"local\". Host-to-host streams directly and never lands on the user's machine. Prompts.",
      risk: "prompt",
      schema: z.object({
        fromTarget: z.string(), fromPath: z.string(),
        toTarget: z.string(), toPath: z.string(),
      }),
      execute: async (raw) => fileOp("transfer_file", raw, (a) =>
        ports.api.sftp.transfer(
          { target: String(a.fromTarget), path: String(a.fromPath) },
          { target: String(a.toTarget), path: String(a.toPath) },
        )),
    },
  ];
}
