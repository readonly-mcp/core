import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/*
 * Cloud-backed tools (az, gh, npm/pnpm network subcommands, acli) routinely
 * take many seconds on a cold start — az in particular pays Python startup
 * plus an AAD token refresh and a network round-trip to Azure DevOps. The
 * timeout is a runaway-command guard, not a latency target, so the bound is
 * generous while still terminating genuinely stuck processes.
 */
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 2 * 1024 * 1024;

const EXEC_OPTS = { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER };

const IS_WIN = process.platform === "win32";

export const text = (stdout, stderr) => ({
  content: [{ type: "text", text: (stdout + stderr).trimEnd() || "(no output)" }],
});

export const fail = (msg) => ({
  content: [{ type: "text", text: msg }],
  isError: true,
});

const append = (note, output) => (output.trim() ? `${note}\n${output.trimEnd()}` : note);

/*
 * Classify a child_process failure into a result. Node kills the child on a
 * timeout or a maxBuffer overflow; in both cases the captured output is usually
 * empty and err.message is a generic "Command failed: …" that hides the real
 * cause — which leads callers to misdiagnose a slow command as a parsing or
 * argument failure (e.g. reading a killed `az … --query '[?…]'` as mangled
 * JMESPath braces). Surface the actual reason, with any partial output
 * appended, so the failure mode is unambiguous. Pure so it can be unit-tested
 * against synthetic error objects without spawning a real process.
 */
export const errorResult = (err, cmd, args) => {
  const partial = (err.stdout || "") + (err.stderr || "");
  if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return fail(append(`Command output exceeded ${MAX_BUFFER} bytes: ${cmd} ${args.join(" ")}`, partial));
  if (err.killed)
    return fail(append(`Command timed out after ${TIMEOUT_MS / 1000}s: ${cmd} ${args.join(" ")}`, partial));
  if (partial) return text(err.stdout || "", err.stderr || "");
  return fail(err.message);
};

export const exec = async (cmd, args) => {
  try {
    const { stdout, stderr } = await run(cmd, args, EXEC_OPTS);
    return text(stdout, stderr);
  } catch (err) {
    return errorResult(err, cmd, args);
  }
};

export const execShell = async (cmd, args) => {
  if (!IS_WIN) return exec(cmd, args);
  return exec("bash", ["-c", 'exec "$@"', "--", cmd, ...args]);
};
