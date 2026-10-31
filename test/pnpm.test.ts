import { describe, it, vi, type ExpectStatic } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as build from "./builders.ts";
import { connectTool, assertBlocked, assertNotBlocked, textOf } from "./helpers.ts";
import { itWithPackageServer, packageServerTimeout } from "./package-fixture.ts";

// --- Unit tests (mocked execShell) ---
vi.mock("../lib/exec.ts", async (importOriginal) =>
  (await import("./helpers.ts")).withEchoExec(importOriginal));

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
const integration = itWithPackageServer("pnpm");

describe.concurrent("pnpm tool (integration)", { timeout: packageServerTimeout }, () => {
  describe("allowed global flags", () => {
    integration.for([
      { name: "--version", args: ["--version"] },
      { name: "--help", args: ["--help"] },
      { name: "-h", args: ["-h"] },
    ])("allows $name", async ({ args }, { expect, server }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args }));
    });

    integration("blocks --help with trailing args", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["--help", "install"] }));
    });

    integration("blocks -v (not in global flags)", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["-v"] }));
    });
  });

  describe("blocked subcommands", () => {
    integration.for(
      [
        ["add", "lodash"], ["remove", "lodash"], ["install"],
        ["update"], ["run", "build"], ["exec", "tsc"],
        ["publish"], ["init"], ["link"], ["unlink"],
        ["store", "prune"], ["patch", "lodash"],
      ].map(args => ({ name: args.join(" "), args }))
    )("blocks $name", async ({ args }, { expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args }));
    });
  });

  describe("blocked flags", () => {
    integration("blocks audit --fix", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["audit", "--fix"] }));
    });

    integration("blocks --registry", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", "--registry", build.httpsUrl()] }));
    });

    integration("blocks --registry=<url>", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", `--registry=${build.httpsUrl()}`] }));
    });

    integration("blocks abbreviated --reg (expands to --registry)", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", "--reg", build.httpsUrl()] }));
    });

    integration("blocks abbreviated --reg=<url>", async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool("pnpm", { args: ["list", `--reg=${build.httpsUrl()}`] }));
    });
  });

  describe("allowed subcommands", () => {
    integration("allows list", async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["list"] }));
    });

    integration("allows why", async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["why", "zod"] }));
    });

    integration("allows licenses list", async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["licenses", "list"] }));
    });

    integration("allows store status", async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool("pnpm", { args: ["store", "status"] }));
    });
  });
});
