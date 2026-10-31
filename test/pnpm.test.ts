import { describe, it, beforeAll, afterAll, vi, type ExpectStatic } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as build from "./builders.ts";
import { connectTool, startServer, assertBlocked, assertNotBlocked, textOf } from "./helpers.ts";

// --- Unit tests (mocked execShell) ---
vi.mock("../lib/exec.ts", () => ({
  execShell: async (_cmd: string, args: readonly string[]) => ({
    content: [{ type: "text", text: JSON.stringify(args) }],
  }),
  fail: (msg: string) => ({ content: [{ type: "text", text: msg }], isError: true }),
}));

const { register } = await import("../tools/pnpm.ts");

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent("pnpm tool (unit)", () => {
  describe("allowed global flags", () => {
    it.for([
      { name: "--version", args: ["--version"] },
      { name: "--help", args: ["--help"] },
      { name: "-h", args: ["-h"] },
    ])("allows $name", async ({ args }, { expect }) => {
      assertAllowed(expect, await callMocked(args));
    });
  });

  describe("allowed subcommands", () => {
    it.for([
      { name: "audit", args: ["audit"] },
      { name: "bin", args: ["bin"] },
      { name: "licenses list", args: ["licenses", "list"] },
      { name: "list", args: ["list"] },
      { name: "outdated", args: ["outdated"] },
      { name: "root", args: ["root"] },
      { name: "search", args: ["search", "zod"] },
      { name: "store status", args: ["store", "status"] },
      { name: "why", args: ["why", "zod"] },
    ])("allows $name", async ({ args }, { expect }) => {
      assertAllowed(expect, await callMocked(args));
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent("pnpm tool (integration)", () => {
  let server: ReturnType<typeof startServer>;
  beforeAll(async () => { server = startServer(); await server.initialize(); });
  afterAll(() => server.close());

  describe("allowed global flags", () => {
    it.for([
      { name: "--version", args: ["--version"] },
      { name: "--help", args: ["--help"] },
      { name: "-h", args: ["-h"] },
    ])("allows $name", async ({ args }, { expect }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args }));
    });

    it("blocks --help with trailing args", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["--help", "install"] }));
    });

    it("blocks -v (not in global flags)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["-v"] }));
    });
  });

  describe("blocked subcommands", () => {
    it.for(
      [
        ["add", "lodash"], ["remove", "lodash"], ["install"],
        ["update"], ["run", "build"], ["exec", "tsc"],
        ["publish"], ["init"], ["link"], ["unlink"],
        ["store", "prune"], ["patch", "lodash"],
      ].map(args => ({ name: args.join(" "), args }))
    )("blocks $name", async ({ args }, { expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args }));
    });
  });

  describe("blocked flags", () => {
    it("blocks audit --fix", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["audit", "--fix"] }));
    });

    it("blocks --registry", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", "--registry", build.httpsUrl()] }));
    });

    it("blocks --registry=<url>", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", `--registry=${build.httpsUrl()}`] }));
    });

    it("blocks abbreviated --reg (expands to --registry)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", "--reg", build.httpsUrl()] }));
    });

    it("blocks abbreviated --reg=<url>", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", `--reg=${build.httpsUrl()}`] }));
    });
  });

  describe("allowed subcommands", () => {
    it("allows list", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["list"] }));
    });

    it("allows why", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["why", "zod"] }));
    });

    it("allows licenses list", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["licenses", "list"] }));
    });

    it("allows store status", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["store", "status"] }));
    });
  });
});
