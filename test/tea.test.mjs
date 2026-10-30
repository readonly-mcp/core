import { describe, it, beforeAll, afterAll, vi } from "vitest";
import { startServer, assertBlocked } from "./helpers.mjs";

// --- Unit tests (mocked exec) ---
vi.mock("../lib/exec.mjs", () => ({
  exec: async (_cmd, args) => ({
    content: [{ type: "text", text: JSON.stringify(args) }],
  }),
  fail: (msg) => ({ content: [{ type: "text", text: msg }], isError: true }),
}));

const { register } = await import("../tools/tea.mjs");

let handler;
register({ tool: (_, __, ___, fn) => { handler = fn; } });

const callMocked = (args) => handler({ args });

const assertAllowed = (expect, result) => {
  expect(result?.isError, `expected allowed, got: ${result?.content?.[0]?.text}`).toBeFalsy();
};

const execArgs = (result) => JSON.parse(result.content[0].text);

describe.concurrent("tea tool (unit)", () => {
  describe("allowed subcommands", () => {
    it.for([
      ["branches", "list"],
      ["comments", "list", "1"],
      ["issues"],
      ["issues", "5"],
      ["issues", "list"],
      ["labels", "list"],
      ["logins", "list"],
      ["milestones", "issues", "v1.0"],
      ["milestones", "list"],
      ["pulls"],
      ["pulls", "2"],
      ["pulls", "list"],
      ["pulls", "review-comments", "2"],
      ["releases", "list"],
      ["repos", "list"],
      ["repos", "search", "term"],
      ["whoami"],
    ].map(args => ({ name: args.join(" "), args })))(
      "allows $name", async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it("allows subcommand with flags", async ({ expect }) => {
      assertAllowed(expect, await callMocked(["pulls", "list", "--state", "all", "-o", "json"]));
    });
  });

  describe("aliases", () => {
    it.for([
      { args: ["b", "ls"], expected: ["branches", "list"] },
      { args: ["branch", "ls"], expected: ["branches", "list"] },
      { args: ["c", "ls", "1"], expected: ["comments", "list", "1"] },
      { args: ["comment", "list", "1"], expected: ["comments", "list", "1"] },
      { args: ["i", "ls"], expected: ["issues", "list"] },
      { args: ["issue", "7"], expected: ["issues", "7"] },
      { args: ["label", "ls"], expected: ["labels", "list"] },
      { args: ["login", "ls"], expected: ["logins", "list"] },
      { args: ["milestone", "ls"], expected: ["milestones", "list"] },
      { args: ["ms", "i", "v1.0"], expected: ["milestones", "issues", "v1.0"] },
      { args: ["pr", "rc", "2"], expected: ["pulls", "review-comments", "2"] },
      { args: ["pr", "2"], expected: ["pulls", "2"] },
      { args: ["pull", "ls"], expected: ["pulls", "list"] },
      { args: ["r", "ls"], expected: ["releases", "list"] },
      { args: ["release", "ls"], expected: ["releases", "list"] },
      { args: ["repo", "s", "term"], expected: ["repos", "search", "term"] },
    ].map(c => ({ name: c.args.join(" "), ...c })))(
      "runs $name under its canonical names", async ({ args, expected }, { expect }) => {
        expect(execArgs(await callMocked(args))).toEqual(expected);
      },
    );
  });

  describe("view by bare index", () => {
    it.for([
      ["pulls", "2", "--comments"],
      ["pulls", "2", "--comments=false"],
      ["pulls", "-o", "json", "2"],
      ["pulls", "--state", "open"],
      ["pulls", "--state=open", "2"],
      ["pulls", "-f", "index,diff", "2"],
      ["pulls", "--", "2"],
      ["issues", "--state", "closed", "-l", "work", "9"],
      ["milestones", "issues", "--kind", "pull", "v1.0"],
    ].map(args => ({ name: args.join(" "), args })))(
      "allows $name", async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    // A noun with children dispatches to the first positional that names one,
    // even after flags, so every positional is checked, not just the first.
    it.for([
      ["pulls", "--state", "all", "merge", "2"],
      ["pulls", "-o", "json", "m", "2"],
      ["pulls", "--comments", "merge", "2"],
      ["pulls", "--", "merge", "2"],
      ["pulls", "2", "3"],
      ["pulls", "title"],
      ["pulls", "--unknown", "2"],
      ["issues", "--state", "open", "close", "1"],
      ["issues", "-o", "json", "e", "1"],
      ["milestones", "issues", "add", "v1.0", "3"],
      ["milestones", "issues", "--state", "all", "remove", "v1.0", "3"],
      ["milestones", "issues", "-o", "json", "a", "v1.0", "3"],
      ["milestones", "issues", "--kind", "pull", "r", "v1.0", "3"],
      ["milestones", "issues", "v1.0", "extra"],
    ].map(args => ({ name: args.join(" "), args })))(
      "blocks $name", async ({ args }, { expect }) => {
        expect((await callMocked(args)).isError).toBeTruthy();
      },
    );
  });

  describe("global flags", () => {
    it.for([
      ["--version"],
      ["-v"],
      ["--help"],
      ["-h"],
    ].map(args => ({ name: args[0], args })))(
      "allows standalone $name", async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it("blocks --help with extra args", async ({ expect }) => {
      expect((await callMocked(["--help", "repos", "delete"])).isError).toBeTruthy();
    });
  });

  describe("api endpoint handling", () => {
    it.for([
      ["api", "repos/o/r/pulls/1/reviews"],
      ["api", "repos/o/r/pulls/1/reviews/2/comments"],
      ["api", "repos/o/r/commits/abc/status"],
      ["api", "repos/o/r/commits/abc/statuses"],
      ["api", "repos/o/r/contents"],
      ["api", "repos/o/r/contents/README.md"],
      ["api", "repos/o/r/contents/src/main.js"],
      ["api", "repos/o/r/raw/README.md"],
      ["api", "repos/o/r/raw/src/main.js"],
      ["api", "repos/{owner}/{repo}/pulls/1/reviews"],
      ["api", "/repos/o/r/contents/README.md"],
      ["api", "repos/o/r/contents/README.md?ref=main"],
      ["api", "repos/o/r/contents/my%20file.md"],
      ["api", "user"],
    ].map(args => ({ name: args[1], args })))(
      "allows api $name", async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it("allows api endpoint with flags", async ({ expect }) => {
      assertAllowed(expect, await callMocked([
        "api", "repos/o/r/pulls/1/reviews", "-i", "-l", "work", "--repo", "o/r",
      ]));
    });

    it("injects --method GET immediately after the endpoint", async ({ expect }) => {
      const args = execArgs(await callMocked(["api", "repos/o/r/pulls/1/reviews", "--", "-i"]));
      expect(args.slice(0, 4)).toEqual(["api", "repos/o/r/pulls/1/reviews", "--method", "GET"]);
    });

    it.for([
      ["api"],
      ["api", "-i", "user"],
      ["api", "repos/o/r/pulls/1/merge"],
      ["api", "repos/o/r/raw"],
      ["api", "user/repos"],
      ["api", "admin/users"],
      ["api", "/api/v1/admin/users"],
      ["api", "https://gitea.example.com/api/v1/user"],
      ["api", "http://gitea.example.com/api/v1/user"],
      // contents/** and raw/** take any depth, so a dot segment could climb
      // out to an endpoint the allowlist never named.
      ["api", "repos/o/r/contents/../../../../admin/users"],
      ["api", "repos/o/r/raw/./../../../admin/users"],
      ["api", "repos/o/r/contents/%2e%2e/%2E%2E/%2e%2e/%2e%2e/admin/users"],
      ["api", "repos/o/r/contents/..%2f..%2f..%2f..%2fadmin/users"],
      ["api", "repos/o/r/contents/..%5c..%5cadmin"],
      ["api", "repos/o/r/contents/%zz"],
      // The URL parser cuts the path at `#`, so a fragment hidden in a
      // wildcard segment would send the request to a truncated endpoint.
      ["api", "repos/admin#/x/contents/y"],
      ["api", "repos/o/r/contents/README.md#L1"],
    ].map(args => ({ name: args.slice(1).join(" ") || "(bare)", args })))(
      "blocks api $name", async ({ args }, { expect }) => {
        expect((await callMocked(args)).isError).toBeTruthy();
      },
    );

    it.for([
      ["--method", "POST"],
      ["--method=DELETE"],
      ["-method", "POST"],
      ["--meth", "POST"],
      ["-X", "POST"],
      ["-XPOST"],
      ["-f", "body=text"],
      ["-fbody=text"],
      ["--field", "body=text"],
      ["-field", "body=text"],
      ["-F", "body=@file"],
      ["--Field", "body=@file"],
      ["-Field=body=@file"],
      ["-H", "Accept: text/plain"],
      ["--header", "X-Custom: val"],
      ["-header", "X-Custom: val"],
      ["-d", "@file.json"],
      ["--data", "{}"],
      ["-data={}"],
      ["-o", "out.json"],
      ["--output", "out.json"],
      ["-output=out.json"],
      ["--debug"],
      ["--repo", "../other/repo"],
    ].map(flags => ({ name: flags.join(" "), flags })))(
      "blocks api flag $name", async ({ flags }, { expect }) => {
        expect((await callMocked(["api", "repos/o/r/pulls/1/reviews", ...flags])).isError).toBeTruthy();
      },
    );
  });

  describe("--repo", () => {
    it.for([
      ["pulls", "list", "--repo", "owner/name"],
      ["pulls", "list", "--repo=owner/name"],
      ["pulls", "list", "-r", "owner/name"],
      ["pulls", "list", "-repo", "my.org/my-repo_2"],
    ].map(args => ({ name: args.slice(2).join(" "), args })))(
      "allows repository slug $name", async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    // --repo also accepts a local repository path, which would point tea at a
    // directory outside the server's working directory.
    it.for([
      ["pulls", "list", "--repo", "C:/Users/someone/repo"],
      ["pulls", "list", "--repo", "/etc/repo"],
      ["pulls", "list", "--repo", "../other"],
      ["pulls", "list", "--repo", "..\\other"],
      ["pulls", "list", "--repo", "../other/repo"],
      ["pulls", "list", "--repo", "owner/name/extra"],
      ["pulls", "list", "--repo=../other/repo"],
      ["pulls", "list", "-r", "./x"],
      ["pulls", "list", "-repo=../other/repo"],
      ["pulls", "2", "-r", "../other/repo"],
    ].map(args => ({ name: args.slice(2).join(" "), args })))(
      "blocks local path $name", async ({ args }, { expect }) => {
        expect((await callMocked(args)).isError).toBeTruthy();
      },
    );
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent("tea tool (integration)", () => {
  let server;
  beforeAll(async () => { server = startServer(); await server.initialize(); });
  afterAll(() => server.close());

  it.for(
    [
      ["actions", "secrets", "list"],
      ["admin", "users"],
      ["branches", "protect", "main"], ["branches", "P", "main"],
      ["branches", "rename", "a", "b"], ["branches", "rn", "a", "b"],
      ["branches", "unprotect", "main"], ["branches", "U", "main"],
      ["clone", "o/r"], ["C", "o/r"],
      ["comments", "1", "body"],
      ["comments", "add", "1", "body"], ["comments", "a", "1", "body"],
      ["comments", "delete", "1"], ["comments", "rm", "1"],
      ["comments", "edit", "1"], ["comments", "e", "1"],
      ["issues", "close", "1"],
      ["issues", "create"], ["issues", "c"],
      ["issues", "edit", "1"], ["issues", "e", "1"],
      ["issues", "reopen", "1"], ["issues", "open", "1"],
      ["labels", "create"], ["labels", "c"],
      ["labels", "delete"], ["labels", "rm"],
      ["labels", "update"],
      ["logins", "add"],
      ["logins", "default", "x"],
      ["logins", "delete", "x"], ["logins", "rm", "x"],
      ["logins", "edit"], ["logins", "e"],
      ["logins", "helper", "get"], ["logins", "git-credential", "get"],
      ["login", "helper", "get"], ["login", "git-credential", "get"],
      ["logins", "oauth-refresh"],
      ["logins", "status"],
      ["logout"],
      ["milestones", "close", "v1"],
      ["milestones", "create"], ["ms", "c"],
      ["milestones", "delete", "v1"], ["ms", "rm", "v1"],
      ["milestones", "reopen", "v1"], ["ms", "open", "v1"],
      ["notifications", "list"], ["notifications", "read"], ["n", "ls"],
      ["open"], ["o"],
      ["organizations", "list"],
      ["pulls", "approve", "1"], ["pr", "lgtm", "1"], ["pr", "a", "1"],
      ["pulls", "checkout", "1"], ["pr", "co", "1"],
      ["pulls", "clean", "1"],
      ["pulls", "close", "1"],
      ["pulls", "create"], ["pr", "c"],
      ["pulls", "edit", "1"], ["pr", "e", "1"],
      ["pulls", "merge", "1"], ["pr", "m", "1"],
      ["pulls", "reject", "1"],
      ["pulls", "reopen", "1"], ["pr", "open", "1"],
      ["pulls", "reply", "1"],
      ["pulls", "resolve", "1"],
      ["pulls", "review", "1"],
      ["pulls", "unresolve", "1"],
      ["releases", "assets", "list"], ["r", "a", "list"],
      ["releases", "create"], ["r", "c"],
      ["releases", "delete", "v1"], ["r", "rm", "v1"],
      ["releases", "edit", "v1"], ["r", "e", "v1"],
      ["repos", "create"], ["repo", "c"],
      ["repos", "create-from-template"], ["repo", "ct"],
      ["repos", "delete", "o/r"], ["repo", "rm", "o/r"],
      ["repos", "edit"], ["repo", "e"],
      ["repos", "fork", "o/r"], ["repo", "f", "o/r"],
      ["repos", "migrate"], ["repo", "m"],
      ["ssh-keys", "list"],
      ["times", "list"],
      ["webhooks", "list"],
      ["wiki", "list"],
    ].map(args => ({ name: args.join(" "), args }))
  )("blocks $name", async ({ args }, { expect }) => {
    assertBlocked(expect, await server.callTool("tea", { args }));
  });

  // --debug may print the Authorization header; blocked until shown not to.
  describe("blocked debug flags", () => {
    it.for([
      ["--debug", "pulls", "list"],
      ["pulls", "list", "--debug"],
      ["pulls", "list", "-debug"],
      ["pulls", "list", "--vvv"],
      ["pulls", "list", "-vvv"],
      ["pulls", "2", "--debug"],
      ["whoami", "--debug"],
    ].map(args => ({ name: args.join(" "), args })))(
      "blocks $name", async ({ args }, { expect }) => {
        assertBlocked(expect, await server.callTool("tea", { args }));
      },
    );
  });

  // --save writes the label set to a file.
  describe("blocked labels --save", () => {
    it.for([
      ["labels", "list", "--save"],
      ["labels", "list", "--save=true"],
      ["labels", "list", "-save"],
      ["labels", "list", "-s"],
      ["label", "ls", "-s"],
    ].map(args => ({ name: args.join(" "), args })))(
      "blocks $name", async ({ args }, { expect }) => {
        assertBlocked(expect, await server.callTool("tea", { args }));
      },
    );
  });

  it("blocks bare tea", async ({ expect }) => {
    assertBlocked(expect, await server.callTool("tea", { args: [] }));
  });
});
