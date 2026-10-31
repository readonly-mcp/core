import { faker } from '@faker-js/faker';
import { describe, it, vi, type ExpectStatic } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as build from './builders.ts';
import { connectTool, assertBlocked, assertNotBlocked, textOf, echoed } from './helpers.ts';
import { itWithPackageServer, packageServerTimeout } from './package-fixture.ts';

// --- Unit tests (mocked execShell) ---
vi.mock('../lib/exec.ts', async (importOriginal) =>
  (await import('./helpers.ts')).withEchoExec(importOriginal));

const { register } = await import('../tools/npm.ts');

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent('npm tool (unit)', () => {
  describe('allowed subcommands', () => {
    it.for(['audit', 'bin', 'explain', 'fund', 'ls', 'outdated', 'root', 'search', 'view'])(
      'allows %s', async (sub, { expect }) => {
        assertAllowed(expect, await callMocked([sub]));
      },
    );
  });

  describe('--ignore-scripts injection', () => {
    it('injects --ignore-scripts as first arg', async ({ expect }) => {
      const result = await callMocked(['ls']);
      const { args } = echoed(result);
      expect(args[0]).toBe('--ignore-scripts');
    });

    it('prepends --ignore-scripts before subcommand', async ({ expect }) => {
      const result = await callMocked(['view', 'zod']);
      const { args } = echoed(result);
      expect(args).toEqual(['--ignore-scripts', 'view', 'zod']);
    });
  });
});

// --- Integration tests (real MCP server) ---
const integration = itWithPackageServer('npm');

describe.concurrent('npm tool (integration)', { timeout: packageServerTimeout }, () => {
  describe('blocked subcommands', () => {
    integration.for(
      [
        ['install'], ['ci'], ['update'], ['uninstall', 'lodash'],
        ['run', 'build'], ['exec', 'tsc'], ['publish'], ['init'],
        ['link'], ['pack'], ['prune'], ['rebuild'], ['dedupe'],
      ].map(args => ({ name: args.join(' '), args }))
    )('blocks $name', async ({ args }, { expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args }));
    });
  });

  describe('blocked flags', () => {
    integration('blocks audit --fix', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['audit', '--fix'] }));
    });

    integration('blocks --registry', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['view', faker.internet.domainWord(), '--registry', build.httpsUrl()] }));
    });

    integration('blocks --registry=<url>', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['view', faker.internet.domainWord(), `--registry=${build.httpsUrl()}`] }));
    });

    integration('blocks --no-ignore-scripts (overrides injected --ignore-scripts)', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['audit', '--no-ignore-scripts'] }));
    });

    integration('blocks abbreviated --reg (npm expands to --registry)', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['view', faker.internet.domainWord(), '--reg', build.httpsUrl()] }));
    });

    integration('blocks abbreviated --reg=<url>', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['view', faker.internet.domainWord(), `--reg=${build.httpsUrl()}`] }));
    });

    integration('blocks abbreviated --fi (matches --fix)', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['audit', '--fi'] }));
    });

    integration('blocks --ignore-scripts=false (overrides injected --ignore-scripts)', async ({ expect, server }) => {
      assertBlocked(expect, await server.callTool('npm', { args: ['audit', '--ignore-scripts=false'] }));
    });
  });

  describe('allowed subcommands', () => {
    integration('allows ls', async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool('npm', { args: ['ls'] }));
    });

    integration('allows explain', async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool('npm', { args: ['explain', 'zod'] }));
    });

    integration('allows view', async ({ expect, server }) => {
      assertNotBlocked(expect, await server.callTool('npm', { args: ['view', 'zod'] }));
    });
  });
});
