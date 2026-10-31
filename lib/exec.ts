import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const run = promisify(execFile);

/*
 * Cloud-backed tools (az, gh, npm/pnpm network subcommands, acli) routinely
 * take many seconds on a cold start — az in particular pays Python startup
 * plus an AAD token refresh and a network round-trip to Azure DevOps. The
 * timeout is a runaway-command guard, not a latency target, so the bound is
 * generous while still terminating genuinely stuck processes.
 */
const TIMEOUT_MS = 30_000;
export const MAX_BUFFER = 2 * 1024 * 1024;

const EXEC_OPTS = { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER };

const IS_WIN = process.platform === 'win32';

export const text = (stdout: string, stderr: string): CallToolResult => ({
  content: [{ type: 'text', text: (stdout + stderr).trimEnd() || '(no output)' }],
});

export const fail = (msg: string): CallToolResult => ({
  content: [{ type: 'text', text: msg }],
  isError: true,
});

const append = (note: string, output: string) => (output.trim() ? `${note}\n${output.trimEnd()}` : note);

/*
 * The fields execFile decorates its rejection with. A catch clause sees the
 * rejection as unknown, so it is parsed rather than trusted.
 */
const ExecErrorSchema = z.object({
  code: z.union([z.string(), z.number(), z.null()]).optional(),
  killed: z.boolean().optional(),
  message: z.string(),
  stderr: z.string().optional(),
  stdout: z.string().optional(),
});

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
export const errorResult = (err: unknown, cmd: string, args: readonly string[]): CallToolResult => {
  const parsed = ExecErrorSchema.safeParse(err);
  if (!parsed.success) return fail(String(err));
  const { code, killed, message, stderr = '', stdout = '' } = parsed.data;
  const partial = stdout + stderr;
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return fail(append(`Command output exceeded ${MAX_BUFFER} bytes: ${cmd} ${args.join(' ')}`, partial));
  if (killed)
    return fail(append(`Command timed out after ${TIMEOUT_MS / 1000}s: ${cmd} ${args.join(' ')}`, partial));
  if (partial) return text(stdout, stderr);
  return fail(message);
};

export const exec = async (cmd: string, args: readonly string[]): Promise<CallToolResult> => {
  try {
    const { stdout, stderr } = await run(cmd, args, EXEC_OPTS);
    return text(stdout, stderr);
  } catch (error) {
    return errorResult(error, cmd, args);
  }
};

export const execShell = async (cmd: string, args: readonly string[]): Promise<CallToolResult> => {
  if (!IS_WIN) return exec(cmd, args);
  return exec('bash', ['-c', 'exec "$@"', '--', cmd, ...args]);
};
