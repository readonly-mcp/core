/**
 * Shared MCP test client for integration tests.
 *
 * Spawns the MCP server as a child process and communicates over JSON-RPC/stdio.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

/*
 * The arguments each result answered, so a failed assertion on the result can
 * name the generated values it ran with. Keyed weakly by the result object, so
 * nothing outlives the test that made the call.
 */
const requests = new WeakMap<CallToolResult, unknown>();

const remember = (args: unknown, result: CallToolResult): CallToolResult => {
  requests.set(result, args);
  return result;
};

const describeRequest = (result: CallToolResult): string =>
  `arguments: ${JSON.stringify(requests.get(result))}`;

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
    if (resp.error) return remember(args, { isError: true, content: [{ type: "text", text: resp.error.message }] });
    return remember(args, CallToolResultSchema.parse(resp.result));
  };

  const close = () => {
    rl.close();
    proc.stdin.end();
    proc.kill();
  };

  return { initialize, callTool, close };
};

/**
 * Registers one tool on a real McpServer and connects a client to it in
 * memory, so unit tests reach the handler the way production does: through
 * the protocol and the tool's input schema.
 */
export const connectTool = async (register: (server: McpServer) => unknown) => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  register(server);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  const [tool, ...others] = tools;
  if (tool === undefined || others.length > 0)
    throw new Error(`Expected one registered tool, got: ${tools.map((t) => t.name).join(", ")}`);
  return async (args: Record<string, unknown>): Promise<CallToolResult> =>
    remember(args, CallToolResultSchema.parse(await client.callTool({ name: tool.name, arguments: args })));
};

/** The text of a result's first content item, which must be text. */
export const textOf = (result: CallToolResult | null): string => {
  const first = result?.content[0];
  if (first?.type !== "text")
    throw new Error(`Expected a text content item, got: ${JSON.stringify(result)}`);
  return first.text;
};

export const assertBlocked = (expect: ExpectStatic, result: CallToolResult, message = `expected blocked, ${describeRequest(result)}`) => {
  expect(result.isError || textOf(result).includes("not allowed"), message).toBe(true);
};

export const assertNotBlocked = (expect: ExpectStatic, result: CallToolResult, message = `expected not blocked, ${describeRequest(result)}`) => {
  expect(result.isError, message).toBeFalsy();
};
