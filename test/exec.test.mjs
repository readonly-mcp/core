import { describe, it } from "vitest";
import { text, fail, errorResult } from "../lib/exec.mjs";

// exec() and execShell() are integration-tested through every tool test.
// These unit tests cover the pure helper functions.

describe("text()", () => {
  it("combines stdout and stderr", ({ expect }) => {
    const result = text("hello\n", "warn\n");
    expect(result.content[0].text).toBe("hello\nwarn");
  });

  it("trims trailing whitespace", ({ expect }) => {
    const result = text("hello  \n\n", "");
    expect(result.content[0].text).toBe("hello");
  });

  it("returns (no output) for empty strings", ({ expect }) => {
    const result = text("", "");
    expect(result.content[0].text).toBe("(no output)");
  });

  it("returns (no output) for whitespace-only", ({ expect }) => {
    const result = text("  \n", "  \n");
    expect(result.content[0].text).toBe("(no output)");
  });

  it("does not set isError", ({ expect }) => {
    const result = text("ok", "");
    expect(result.isError).toBeUndefined();
  });
});

describe("fail()", () => {
  it("returns isError: true", ({ expect }) => {
    const result = fail("bad");
    expect(result.isError).toBe(true);
  });

  it("includes the message", ({ expect }) => {
    const result = fail("something went wrong");
    expect(result.content[0].text).toBe("something went wrong");
  });

  it("handles empty message", ({ expect }) => {
    const result = fail("");
    expect(result.content[0].text).toBe("");
  });
});

describe(errorResult, () => {
  // Shapes mirror what node:child_process.execFile rejects with: a timeout
  // sets killed/signal with empty output; maxBuffer overflow sets the
  // ERR_CHILD_PROCESS_STDIO_MAXBUFFER code; ordinary failures carry output.

  it("surfaces a timeout kill instead of the generic message", ({ expect }) => {
    const err = { killed: true, signal: "SIGTERM", code: null, message: "Command failed: bash -c sleep 60", stdout: "", stderr: "" };
    const result = errorResult(err, "bash", ["-c", "sleep 60"]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/timed out after 30s: bash -c sleep 60/);
  });

  it("appends partial output to a timeout message", ({ expect }) => {
    const err = { killed: true, signal: "SIGTERM", code: null, message: "Command failed", stdout: "partial line\n", stderr: "" };
    const result = errorResult(err, "az", ["pipelines", "list"]);
    expect(result.content[0].text).toBe("Command timed out after 30s: az pipelines list\npartial line");
  });

  it("surfaces a maxBuffer overflow", ({ expect }) => {
    const err = { killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", message: "stdout maxBuffer length exceeded", stdout: "", stderr: "" };
    const result = errorResult(err, "az", ["pipelines", "list"]);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/output exceeded \d+ bytes: az pipelines list/);
  });

  it("returns ordinary failure output without isError", ({ expect }) => {
    const err = { code: 1, message: "Command failed", stdout: "", stderr: "git: not a repo\n" };
    const result = errorResult(err, "git", ["status"]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("git: not a repo");
  });

  it("falls back to err.message when there is no output", ({ expect }) => {
    const err = { code: "ENOENT", message: "spawn nonesuch ENOENT", stdout: "", stderr: "" };
    const result = errorResult(err, "nonesuch", []);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("spawn nonesuch ENOENT");
  });
});
