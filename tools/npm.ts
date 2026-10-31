import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execShell } from '../lib/exec.ts';
import { ArgsSchema, matchesAllowlist, rejectSubcommand, rejectBlockedFlags } from '../lib/allowlist.ts';

const SUBCOMMANDS = new Set([
  'audit', 'bin', 'explain', 'fund', 'ls', 'outdated', 'root', 'search', 'view',
]);

// --fix: npm audit fix attempts to update packages
// --registry: prevents SSRF / data exfiltration via attacker-controlled registries
// --no-ignore-scripts: overrides the injected --ignore-scripts (npm uses last-wins)
const BLOCKED_FLAGS = new Set(['--fix', '--registry', '--no-ignore-scripts', '--ignore-scripts']);

export const register = (server: McpServer) =>
  server.tool(
    'npm',
    'Run read-only npm commands (audit, bin, explain, fund, ls, outdated, root, search, view)',
    ArgsSchema,
    async ({ args }) => {
      if (!matchesAllowlist(args, SUBCOMMANDS))
        return rejectSubcommand(args, SUBCOMMANDS);
      const rejected = rejectBlockedFlags(args, BLOCKED_FLAGS);
      if (rejected) return rejected;
      return execShell('npm', ['--ignore-scripts', ...args]);
    },
  );
