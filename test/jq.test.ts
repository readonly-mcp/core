import { faker } from '@faker-js/faker';
import { describe, it, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as build from './builders.ts';
import { startServer, assertBlocked, assertNotBlocked } from './helpers.ts';

describe.concurrent('jq file argument blocking', () => {
  let server: ReturnType<typeof startServer>;
  let tmpDir: string;
  let canaryFile: string;

  beforeAll(async () => {
    server = startServer();
    await server.initialize();
    tmpDir = await mkdtemp(join(tmpdir(), 'mcp-test-'));
    canaryFile = join(tmpDir, 'canary.txt').replace(/\\/g, '/');
    await writeFile(canaryFile, 'ORIGINAL', 'utf8');
  });

  afterAll(async () => {
    server.close();
    await rm(tmpDir, { recursive: true });
  });

  describe('allowed (no file args)', () => {
    it('allows -n empty', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-n', 'empty'] }));
    });

    it('allows --arg with filter only', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['--arg', 'k', faker.lorem.word(), '-n', '.foo'] }));
    });

    it('allows --argjson with filter only', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['--argjson', 'k', String(faker.number.int()), '-n', '$k'] }));
    });

    it('allows -r -n with filter only', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-r', '-n', '.foo'] }));
    });
  });

  describe('--args and --jsonargs handling', () => {
    it('allows --args flag before filter', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['--args', '-n', '$ARGS.positional'] }));
    });

    it('allows --jsonargs flag before filter', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['--jsonargs', '-n', '$ARGS.positional'] }));
    });

    it('blocks positional args after filter even with --args (safe false positive)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-n', '$ARGS.positional', '--args', ...build.words(2)] }));
    });
  });

  describe('blocked (file args)', () => {
    it('blocks jq . /etc/passwd', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['.', '/etc/passwd'] }));
    });

    it('blocks jq . <canary>', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['.', canaryFile] }));
    });

    it('blocks --arg k v . <file>', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['--arg', 'k', faker.lorem.word(), '.', canaryFile] }));
    });
  });

  describe('blocked file-reading flags', () => {
    it.for(['--slurpfile', '--rawfile', '--from-file', '-f', '--library-path'])(
      'blocks %s', async (flag, { expect }) => {
        assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: [flag, faker.lorem.word(), canaryFile] }));
      },
    );

    it('blocks -L (library path)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-L', build.absolutePath(), '-n', 'empty'] }));
    });

    it('blocks --from-file=path (equals form)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: [`--from-file=${build.fileName('jq')}`] }));
    });
  });

  describe('combined short flag bypass', () => {
    it('blocks -rf (combined -r -f)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-rf', '/etc/passwd'] }));
    });

    it('blocks -nf (combined -n -f)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-nf', '/etc/passwd'] }));
    });

    it('blocks -Sf (combined -S -f)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-Sf', '/etc/passwd'] }));
    });

    it('blocks -L/path (concatenated library path)', async ({ expect }) => {
      assertBlocked(expect, await server.callTool('shell', { command: 'jq', args: [`-L${build.absolutePath()}`, '-n', 'empty'] }));
    });

    it('allows -rn (no file chars)', async ({ expect }) => {
      assertNotBlocked(expect, await server.callTool('shell', { command: 'jq', args: ['-rn', 'empty'] }));
    });
  });
});
