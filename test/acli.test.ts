import { faker } from '@faker-js/faker';
import { describe, it, beforeAll, afterAll, vi, type ExpectStatic } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { connectTool, startServer, assertBlocked, textOf } from './helpers.ts';

// --- Unit tests (mocked exec) ---
vi.mock('../lib/exec.ts', async importOriginal =>
  (await import('./helpers.ts')).withEchoExec(importOriginal));

const { register } = await import('../tools/acli.ts');

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent('acli tool (unit)', () => {
  describe('allowed subcommands', () => {
    it.for([
      ['jira', 'board', 'list'],
      ['jira', 'filter', 'list'],
      ['jira', 'project', 'list'],
      ['jira', 'sprint', 'list'],
      ['jira', 'workitem', 'comment', 'list'],
      ['jira', 'workitem', 'list'],
      ['jira', 'workitem', 'search'],
      ['jira', 'workitem', 'view'],
    ].map(args => ({ name: args.join(' '), args })))(
      'allows $name', async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it('allows subcommand with flags', async ({ expect }) => {
      assertAllowed(expect, await callMocked(['jira', 'workitem', 'list', '--project', faker.string.alpha({ casing: 'upper', length: 3 })]));
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent('acli tool (integration)', () => {
  let server: ReturnType<typeof startServer>;
  beforeAll(async () => { server = startServer(); await server.initialize(); });
  afterAll(() => server.close());

  it.for(
    [
      ['jira', 'workitem', 'create'],
      ['jira', 'workitem', 'edit'],
      ['jira', 'workitem', 'delete'],
      ['jira', 'workitem', 'assign'],
      ['jira', 'workitem', 'transition'],
      ['jira', 'workitem', 'comment', 'create'],
    ].map(args => ({ name: args.join(' '), args }))
  )('blocks $name', async ({ args }, { expect }) => {
    assertBlocked(expect, await server.callTool('acli', { args }));
  });
});
