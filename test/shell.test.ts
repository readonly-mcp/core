import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ExpectStatic, afterAll, beforeAll, describe, it, vi } from 'vitest';
import { assertBlocked, assertNotBlocked, connectTool, startServer, textOf } from './helpers.ts';

// --- Unit tests (mocked execShell) ---
vi.mock(import('../lib/exec.ts'), async importOriginal =>
  (await import('./helpers.ts')).withEchoExec(importOriginal));

const { register } = await import('../tools/shell.ts');

const callTool = await connectTool(register);

const callMocked = (command: string, args: readonly string[] = []) => callTool({ command, args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent('shell tool (unit)', () => {
  describe('allowed commands', () => {
    it.for([
      'basename', 'date', 'dirname', 'eza', 'file', 'jq', 'ls', 'pwd',
      'readlink', 'realpath', 'stat', 'wc', 'which', 'whoami',
    ])('allows %s', async (cmd, { expect }) => {
      assertAllowed(expect, await callMocked(cmd));
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent('shell tool (integration)', () => {
  let server: ReturnType<typeof startServer>;

  beforeAll(async () => { server = startServer(); await server.initialize(); });

  afterAll(() => server.close());

  describe('blocked commands', () => {
    it.for([
      'rm', 'mv', 'cp', 'chmod', 'chown', 'mkdir', 'rmdir', 'touch', 'dd',
      'tee', 'sed', 'awk', 'bash', 'sh', 'cmd', 'powershell', 'node',
      'python', 'py', 'printenv', 'rg', 'bat', 'cat', 'delta', 'diff',
      'head', 'tail',
    ])('blocks %s', async (cmd, { expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: cmd, args: [] }));
    });
  });

  describe('path traversal in command name', () => {
    it('blocks /bin/rm', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: '/bin/rm', args: [] }));
    });

    it('blocks ../../bin/rm', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: '../../bin/rm', args: [] }));
    });
  });

  describe('empty command', () => {
    it('blocks empty command', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: '', args: [] }));
    });
  });

  describe('allowed commands', () => {
    it('allows ls', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'ls', args: ['.'] }));
    });
  });
});
