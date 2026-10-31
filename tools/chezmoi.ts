import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ArgsSchema, matchesAllowlist, rejectSubcommand } from '../lib/allowlist.ts';
import { exec } from '../lib/exec.ts';

const SUBCOMMANDS = new Set([
  'diff', 'doctor', 'managed',
  'source-path', 'status', 'target-path', 'verify',
]);

export const register = (server: McpServer) =>
  server.tool(
    'chezmoi',
    'Run read-only chezmoi commands (diff, doctor, managed, source-path, status, target-path, verify)',
    ArgsSchema,
    async ({ args }) => {
      if (!matchesAllowlist(args, SUBCOMMANDS))
        return rejectSubcommand(args, SUBCOMMANDS);
      return exec('chezmoi', args);
    },
  );
