import { faker } from "@faker-js/faker";
import { describe, it, beforeAll, afterAll, vi, type ExpectStatic } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as build from "./builders.ts";
import { connectTool, startServer, assertBlocked, assertNotBlocked, textOf, echoed } from "./helpers.ts";

// --- Unit tests (mocked execShell) ---
vi.mock("../lib/exec.ts", async (importOriginal) =>
  (await import("./helpers.ts")).withEchoExec(importOriginal));

const { register } = await import("../tools/npm.ts");

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent("npm tool (unit)", () => {
  describe("allowed subcommands", () => {
    it.for(["audit", "bin", "explain", "fund", "ls", "outdated", "root", "search", "view"])(
      "allows %s", async (sub, { expect }) => {
        assertAllowed(expect, await callMocked([sub]));
      },
    );
  });

  describe("--ignore-scripts injection", () => {
    it("injects --ignore-scripts as first arg", async ({ expect }) => {
      const result = await callMocked(["ls"]);
      const { args } = echoed(result);
      expect(args[0]).toBe("--ignore-scripts");
    });

    it("prepends --ignore-scripts before subcommand", async ({ expect }) => {
      const result = await callMocked(["view", "zod"]);
      const { args } = echoed(result);
      expect(args).toEqual(["--ignore-scripts", "view", "zod"]);
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent("npm tool (integration)", () => {
  let server: ReturnType<typeof startServer>;
  beforeAll(async () => { server = startServer(); await server.initialize(); });
  afterAll(() => server.close());

  describe("blocked subcommands", () => {
    it.for(
      [
        ["install"], ["ci"], ["update"], ["uninstall", "lodash"],
        ["run", "build"], ["exec", "tsc"], ["publish"], ["init"],
        ["link"], ["pack"], ["prune"], ["rebuild"], ["dedupe"],
      ].map(args => ({ name: args.join(" "), args }))
    )("blocks $name", async ({ args }, { expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args }));
    });
  });

  describe("blocked flags", () => {
    it("blocks audit --fix", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["audit", "--fix"] }));
    });

    it("blocks --registry", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["view", faker.internet.domainWord(), "--registry", build.httpsUrl()] }));
    });

    it("blocks --registry=<url>", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["view", faker.internet.domainWord(), `--registry=${build.httpsUrl()}`] }));
    });

    it("blocks --no-ignore-scripts (overrides injected --ignore-scripts)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["audit", "--no-ignore-scripts"] }));
    });

    it("blocks abbreviated --reg (npm expands to --registry)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["view", faker.internet.domainWord(), "--reg", build.httpsUrl()] }));
    });

    it("blocks abbreviated --reg=<url>", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["view", faker.internet.domainWord(), `--reg=${build.httpsUrl()}`] }));
    });

    it("blocks abbreviated --fi (matches --fix)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["audit", "--fi"] }));
    });

    it("blocks --ignore-scripts=false (overrides injected --ignore-scripts)", async ({ expect }) => {
      assertBlocked(expect, await server.callTool("npm", { args: ["audit", "--ignore-scripts=false"] }));
    });
  });

  describe("allowed subcommands", () => {
    it("allows ls", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("npm", { args: ["ls"] }));
    });

    it("allows explain", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("npm", { args: ["explain", "zod"] }));
    });

    it("allows view", async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool("npm", { args: ["view", "zod"] }));
    });
  });
});
