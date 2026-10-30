/**
 * Shared MCP test client for integration tests.
 *
 * Spawns the MCP server as a child process and communicates over JSON-RPC/stdio.
 */

import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { ExpectStatic } from "vitest";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "index.ts");

const ResponseSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  id: z.number(),
  result: z.unknown(),
});

type Response = z.infer<typeof ResponseSchema>;

export const startServer = () => {
  const proc = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  const rl = createInterface({ input: proc.stdout });
  const pending = new Map<number, (msg: Response) => void>();
  const timers = new Map<number, NodeJS.Timeout>();
  let nextId = 1;

  rl.on("line", (line) => {
    try {
      const parsed = ResponseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return;
      const msg = parsed.data;
      const resolve = pending.get(msg.id);
      if (resolve) {
        clearTimeout(timers.get(msg.id));
        timers.delete(msg.id);
        resolve(msg);
        pending.delete(msg.id);
      }
    } catch { /* ignore non-JSON lines */ }
  });

  const send = (method: string, params: unknown) =>
    new Promise<Response>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      proc.stdin.write(msg + "\n");
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout waiting for response to ${method}`));
        }
      }, 15_000));
    });

  const initialize = () =>
    send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });

  const callTool = async (name: string, args: unknown): Promise<CallToolResult> => {
    const resp = await send("tools/call", { name, arguments: args });
    if (resp.error) return { isError: true, content: [{ type: "text", text: resp.error.message }] };
    return CallToolResultSchema.parse(resp.result);
  };

  const close = () => {
    rl.close();
    proc.stdin.end();
    proc.kill();
  };

  return { initialize, callTool, close };
};

/** The text of a result's first content item, which must be text. */
export const textOf = (result: CallToolResult | null): string => {
  const first = result?.content[0];
  if (first?.type !== "text")
    throw new Error(`Expected a text content item, got: ${JSON.stringify(result)}`);
  return first.text;
};

export const assertBlocked = (expect: ExpectStatic, result: CallToolResult, message?: string) => {
  expect(result.isError || textOf(result).includes("not allowed"), message).toBe(true);
};

export const assertNotBlocked = (expect: ExpectStatic, result: CallToolResult, message?: string) => {
  expect(result.isError, message).toBeFalsy();
};
