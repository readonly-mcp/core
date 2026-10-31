import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ExpectStatic, afterAll, beforeAll, describe, it, vi } from 'vitest';
import { assertBlocked, connectTool, startServer, textOf } from './helpers.ts';

// --- Unit tests (mocked exec) ---
vi.mock('../lib/exec.ts', async importOriginal =>
  (await import('./helpers.ts')).withEchoExec(importOriginal));

const { register } = await import('../tools/chezmoi.ts');

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent('chezmoi tool (unit)', () => {
  describe('allowed subcommands', () => {
    it.for(['diff', 'doctor', 'managed', 'source-path', 'status', 'target-path', 'verify'])(
      'allows %s', async (sub, { expect }) => {
        assertAllowed(expect, await callMocked([sub]));
      },
    );

    it('allows subcommand with flags', async ({ expect }) => {
      assertAllowed(expect, await callMocked(['status', '--include', 'files']));
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent('chezmoi tool (integration)', () => {
  let server: ReturnType<typeof startServer>;

  beforeAll(async () => { server = startServer(); await server.initialize(); });

  afterAll(() => server.close());

  it.for(
    [
      ['apply'], ['add'], ['data'], ['edit'], ['forget'], ['init'],
      ['remove'], ['re-add'], ['update'], ['destroy'], ['state', 'dump'],
      ['cat-config'],
    ].map(args => ({ name: args.join(' '), args })),
  )('blocks $name', async ({ args }, { expect }) => {
    assertBlocked(expect, await server.callTool('chezmoi', { args }));
  });
});
