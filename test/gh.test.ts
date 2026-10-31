import { faker } from '@faker-js/faker';
import { describe, it, beforeAll, afterAll, vi, type ExpectStatic } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as build from './builders.ts';
import { connectTool, startServer, assertBlocked, textOf, echoed } from './helpers.ts';

// --- Unit tests (mocked exec) ---
vi.mock('../lib/exec.ts', async importOriginal =>
  (await import('./helpers.ts')).withEchoExec(importOriginal));

const { register } = await import('../tools/gh.ts');

const callTool = await connectTool(register);

const callMocked = (args: readonly string[]) => callTool({ args });

const assertAllowed = (expect: ExpectStatic, result: CallToolResult) => {
  expect(result.isError, `expected allowed, got: ${textOf(result)}`).toBeFalsy();
};

describe.concurrent('gh tool (unit)', () => {
  describe('allowed subcommands', () => {
    it.for([
      ['attestation', 'verify'],
      ['cache', 'list'],
      ['gist', 'list'],
      ['gist', 'view'],
      ['issue', 'list'],
      ['issue', 'status'],
      ['issue', 'view'],
      ['label', 'list'],
      ['pr', 'checks'],
      ['pr', 'diff'],
      ['pr', 'list'],
      ['pr', 'status'],
      ['pr', 'view'],
      ['project', 'field-list'],
      ['project', 'item-list'],
      ['project', 'list'],
      ['project', 'view'],
      ['release', 'list'],
      ['release', 'view'],
      ['repo', 'list'],
      ['repo', 'view'],
      ['ruleset', 'check'],
      ['ruleset', 'list'],
      ['ruleset', 'view'],
      ['run', 'list'],
      ['run', 'view'],
      ['search', 'code'],
      ['search', 'commits'],
      ['search', 'issues'],
      ['search', 'prs'],
      ['search', 'repos'],
      ['secret', 'list'],
      ['status'],
      ['variable', 'list'],
      ['workflow', 'list'],
      ['workflow', 'view'],
    ].map(args => ({ name: args.join(' '), args })))(
      'allows $name', async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it('allows subcommand with flags', async ({ expect }) => {
      assertAllowed(expect, await callMocked(['pr', 'list', '--state', 'open', '--json', 'number']));
    });
  });

  describe('global flags', () => {
    it.for([
      ['--version'],
      ['--help'],
      ['-h'],
    ].map(args => ({ name: args[0], args })))(
      'allows standalone $name', async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it('blocks --help with extra args', async ({ expect }) => {
      const result = await callMocked(['--help', 'repo', 'delete']);
      assertBlocked(expect, result);
    });

    it('blocks --version with extra args', async ({ expect }) => {
      const result = await callMocked(['--version', 'repo', 'delete']);
      assertBlocked(expect, result);
    });
  });

  describe('api endpoint handling', () => {
    it.for(([
      'repos/:owner/:repo/pulls/:number/comments',
      'repos/:owner/:repo/pulls/:number/comments/:number',
      'repos/:owner/:repo/pulls/:number/reviews',
      'repos/:owner/:repo/pulls/:number/reviews/:number/comments',
      'repos/:owner/:repo/deployments',
      'repos/:owner/:repo/deployments/:number/statuses',
      'repos/:owner/:repo/check-runs/:number/annotations',
      'repos/:owner/:repo/commits',
      'repos/:owner/:repo/commits/:sha',
      'repos/:owner/:repo/commits/:sha/status',
      'repos/:owner/:repo/commits/:sha/statuses',
      'repos/:owner/:repo/commits/:sha/check-runs',
      'repos/:owner/:repo/commits/:sha/check-suites',
      'repos/:owner/:repo/compare/:branch...:branch',
      'repos/:owner/:repo/pulls/:number/requested_reviewers',
      'repos/:owner/:repo/environments',
      'repos/:owner/:repo/contents',
      'repos/:owner/:repo/contents/:file',
      'repos/:owner/:repo/contents/:path',
      'user',
    ] as const).map(template => ({ name: template, args: ['api', build.template(template)] })))(
      'allows api $name', async ({ args }, { expect }) => {
        assertAllowed(expect, await callMocked(args));
      },
    );

    it('allows api endpoint with flags', async ({ expect }) => {
      assertAllowed(expect, await callMocked([
        'api', build.prCommentsPath(), '--jq', '.[].id',
      ]));
    });

    it('strips leading slash from endpoint', async ({ expect }) => {
      assertAllowed(expect, await callMocked([
        'api', `/${build.prCommentsPath()}`,
      ]));
    });

    it('strips query string from endpoint', async ({ expect }) => {
      assertAllowed(expect, await callMocked([
        'api', `${build.prCommentsPath()}${build.queryString()}`,
      ]));
    });

    it('injects --method GET before user flags', async ({ expect }) => {
      const result = await callMocked([
        'api', build.prCommentsPath(), '--jq', '.[].id',
      ]);
      const { args } = echoed(result);
      const methodIdx = args.indexOf('--method');
      const jqIdx = args.indexOf('--jq');
      expect(methodIdx).toBeGreaterThan(-1);
      expect(args[methodIdx + 1]).toBe('GET');
      expect(methodIdx).toBeLessThan(jqIdx);
    });

    it('--method GET is not defeated by -- end-of-options', async ({ expect }) => {
      const result = await callMocked([
        'api', build.prCommentsPath(), '--',
      ]);
      const { args } = echoed(result);
      const methodIdx = args.indexOf('--method');
      const dashDashIdx = args.indexOf('--');
      expect(methodIdx).toBeGreaterThan(-1);
      expect(methodIdx).toBeLessThan(dashDashIdx);
    });

    it('blocks disallowed endpoint', async ({ expect }) => {
      const result = await callMocked(['api', build.template('repos/:owner/:repo/git/refs')]);
      assertBlocked(expect, result);
    });

    it('blocks bare api (no endpoint)', async ({ expect }) => {
      const result = await callMocked(['api']);
      assertBlocked(expect, result);
    });

    it('blocks api with flag-like endpoint', async ({ expect }) => {
      const result = await callMocked(['api', '--jq', '.[].id']);
      assertBlocked(expect, result);
    });

    it('blocks --method flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--method', 'POST']);
      assertBlocked(expect, result);
    });

    it('blocks -X flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-X', 'POST']);
      assertBlocked(expect, result);
    });

    it('blocks -XPOST (concatenated short flag)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-XPOST']);
      assertBlocked(expect, result);
    });

    it('blocks --input flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--input', build.fileName('json')]);
      assertBlocked(expect, result);
    });

    it('blocks --hostname flag (SSRF)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--hostname', faker.internet.domainName()]);
      assertBlocked(expect, result);
    });

    it('blocks -f flag (body field)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-f', `${faker.lorem.word()}=${faker.lorem.word()}`]);
      assertBlocked(expect, result);
    });

    it('blocks -F flag (@file read)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-F', `${faker.lorem.word()}=@${build.fileName('txt')}`]);
      assertBlocked(expect, result);
    });

    it('blocks -Fbody=@file (concatenated -F)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-Fbody=@/etc/passwd']);
      assertBlocked(expect, result);
    });

    it('blocks --field flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--field', `${faker.lorem.word()}=${faker.lorem.word()}`]);
      assertBlocked(expect, result);
    });

    it('blocks --raw-field flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--raw-field', `${faker.lorem.word()}=${faker.lorem.word()}`]);
      assertBlocked(expect, result);
    });

    it('blocks --verbose flag (token leak)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--verbose']);
      assertBlocked(expect, result);
    });

    it('blocks -H flag (header injection)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-H', 'Accept: text/plain']);
      assertBlocked(expect, result);
    });

    it('blocks --header flag', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '--header', `X-${faker.lorem.word()}: ${faker.lorem.word()}`]);
      assertBlocked(expect, result);
    });

    it('blocks -HAccept:text/plain (concatenated -H)', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath(), '-HAccept:text/plain']);
      assertBlocked(expect, result);
    });

    it('blocks full URL', async ({ expect }) => {
      const result = await callMocked(['api', `https://api.github.com/${build.prCommentsPath()}`]);
      assertBlocked(expect, result);
    });

    it('allows contents without path (directory listing)', async ({ expect }) => {
      assertAllowed(expect, await callMocked(['api', build.template('repos/:owner/:repo/contents')]));
    });

    it('allows contents with trailing slash (directory listing)', async ({ expect }) => {
      assertAllowed(expect, await callMocked(['api', build.template('repos/:owner/:repo/contents/')]));
    });

    it('injects raw Accept header for contents endpoint', async ({ expect }) => {
      const result = await callMocked(['api', build.template('repos/:owner/:repo/contents/:file')]);
      const { args } = echoed(result);
      const hIdx = args.indexOf('-H');
      expect(hIdx).toBeGreaterThan(-1);
      expect(args[hIdx + 1]).toBe('Accept: application/vnd.github.raw+json');
    });

    it('injects raw Accept header for bare contents endpoint', async ({ expect }) => {
      const result = await callMocked(['api', build.template('repos/:owner/:repo/contents')]);
      const { args } = echoed(result);
      const hIdx = args.indexOf('-H');
      expect(hIdx).toBeGreaterThan(-1);
      expect(args[hIdx + 1]).toBe('Accept: application/vnd.github.raw+json');
    });

    it('does not inject Accept header for non-contents endpoint', async ({ expect }) => {
      const result = await callMocked(['api', build.prCommentsPath()]);
      const { args } = echoed(result);
      expect(args.indexOf('-H')).toBe(-1);
    });
  });
});

// --- Integration tests (real MCP server) ---
describe.concurrent('gh tool (integration)', () => {
  let server: ReturnType<typeof startServer>;
  beforeAll(async () => { server = startServer(); await server.initialize(); });
  afterAll(() => server.close());

  it.for(
    [
      ['issue', 'create'], ['issue', 'close'], ['issue', 'delete'], ['issue', 'edit'],
      ['pr', 'create'], ['pr', 'close'], ['pr', 'merge'], ['pr', 'edit'],
      ['repo', 'create'], ['repo', 'delete'],
      ['auth', 'login'],
      ['gist', 'create'], ['gist', 'delete'], ['gist', 'edit'],
      ['label', 'create'], ['label', 'delete'], ['label', 'edit'],
      ['release', 'create'], ['release', 'delete'], ['release', 'edit'],
      ['workflow', 'run'], ['workflow', 'enable'], ['workflow', 'disable'],
      ['secret', 'set'], ['secret', 'delete'],
      ['variable', 'get'], ['variable', 'set'], ['variable', 'delete'],
      ['project', 'create'], ['project', 'delete'], ['project', 'edit'],
      ['cache', 'delete'],
      ['ruleset', 'create'],
    ].map(args => ({ name: args.join(' '), args }))
  )('blocks $name', async ({ args }, { expect }) => {
    assertBlocked(expect, await server.callTool('gh', { args }));
  });

  describe('blocked api endpoints', () => {
    it.for(([
      'repos/:owner/:repo/git/refs',
      'repos/:owner/:repo/pulls/:number/merge',
      'gists',
      'user/repos',
      'graphql',
    ] as const).map(template => ({ name: template, args: ['api', build.template(template)] })))(
      'blocks api $name', async ({ args }, { expect }) => {
        assertBlocked(expect, await server.callTool('gh', { args }));
      },
    );
  });

  describe('blocked api flags', () => {
    it.for([
      { name: '--method POST', args: ['api', build.prCommentsPath(), '--method', 'POST'] },
      { name: '--method=DELETE', args: ['api', build.prCommentsPath(), '--method=DELETE'] },
      { name: '-X POST', args: ['api', build.prCommentsPath(), '-X', 'POST'] },
      { name: '-XPOST (concatenated)', args: ['api', build.prCommentsPath(), '-XPOST'] },
      { name: '-XDELETE (concatenated)', args: ['api', build.prCommentsPath(), '-XDELETE'] },
      { name: '--input', args: ['api', build.prCommentsPath(), '--input', build.fileName('json')] },
      { name: '--input=file', args: ['api', build.prCommentsPath(), `--input=${build.fileName('json')}`] },
      { name: '--meth (abbreviated)', args: ['api', build.prCommentsPath(), '--meth', 'POST'] },
      { name: '--hostname (SSRF)', args: ['api', build.prCommentsPath(), '--hostname', faker.internet.domainName()] },
      { name: '--hostname=evil (SSRF)', args: ['api', build.prCommentsPath(), `--hostname=${faker.internet.domainName()}`] },
      { name: '-f (body field)', args: ['api', build.prCommentsPath(), '-f', `${faker.lorem.word()}=${faker.lorem.word()}`] },
      { name: '-fkey=val (concatenated)', args: ['api', build.prCommentsPath(), `-f${faker.lorem.word()}=${faker.lorem.word()}`] },
      { name: '-F (@file read)', args: ['api', build.prCommentsPath(), '-F', `${faker.lorem.word()}=@${build.fileName()}`] },
      { name: '-Fx=@file (concatenated)', args: ['api', build.prCommentsPath(), '-Fx=@/etc/passwd'] },
      { name: '--field', args: ['api', build.prCommentsPath(), '--field', `${faker.lorem.word()}=${faker.lorem.word()}`] },
      { name: '--raw-field', args: ['api', build.prCommentsPath(), '--raw-field', `${faker.lorem.word()}=${faker.lorem.word()}`] },
      { name: '--verbose (token leak)', args: ['api', build.prCommentsPath(), '--verbose'] },
      { name: '-H (header injection)', args: ['api', build.prCommentsPath(), '-H', 'Accept: text/plain'] },
      { name: '--header', args: ['api', build.prCommentsPath(), '--header', `X-${faker.lorem.word()}: ${faker.lorem.word()}`] },
      { name: '-HAccept:... (concatenated)', args: ['api', build.prCommentsPath(), '-HAccept:text/plain'] },
    ])('blocks api $name', async ({ args }, { expect }) => {
      assertBlocked(expect, await server.callTool('gh', { args }));
    });
  });

  describe('blocked api full URLs', () => {
    it('blocks https:// URL', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('gh', {
        args: ['api', `https://api.github.com/${build.prCommentsPath()}`],
      }));
    });

    it('blocks http:// URL', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('gh', {
        args: ['api', `http://api.github.com/${build.prCommentsPath()}`],
      }));
    });
  });

  it('blocks bare api', async ({ expect }) => {
    assertBlocked(expect, await server.callTool('gh', { args: ['api'] }));
  });
});
