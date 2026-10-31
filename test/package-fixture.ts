/**
 * A throwaway package project for integration tests that run a package
 * manager against the server's working directory.
 *
 * Commands like `npm ls` and `pnpm store status` walk the whole dependency
 * tree, so run against this repository they take as long as its dev toolchain
 * is large, and every added dev dependency pushes them closer to the test
 * timeout. A project holding one dependency keeps their cost flat.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { it } from 'vitest';
import { z } from 'zod';
import { startServer } from './helpers.ts';

const run = promisify(execFile);

const require = createRequire(import.meta.url);

/*
 * The dependency the tests name (`npm explain zod`, `pnpm why zod`), pinned to
 * the version this repository resolved, so the install is reproducible and a
 * package manager whose cache already holds it skips the download.
 */
const dependency = 'zod';
const { version } = z.object({ version: z.string() }).parse(require(`${dependency}/package.json`));

/*
 * In CI pnpm defaults to --frozen-lockfile, which refuses a project with no
 * lockfile. The audit and funding requests fetch reports no test reads.
 */
const installArgs = {
  npm: ['install', '--no-audit', '--no-fund'],
  pnpm: ['install', '--no-frozen-lockfile'],
} satisfies Record<string, readonly string[]>;

/*
 * Both managers are .cmd shims on Windows, which execFile cannot launch.
 * Route through bash as lib/exec.ts's execShell does, rather than a shell
 * that would concatenate the arguments.
 */
const shimmed = (cmd: string, args: readonly string[]): [string, string[]] =>
  process.platform === 'win32' ? ['bash', ['-c', 'exec "$@"', '--', cmd, ...args]] : [cmd, [...args]];

export type PackageManager = keyof typeof installArgs;

export interface PackageFixture extends AsyncDisposable {
  readonly dir: string;
}

/** Creates a project depending on zod and installs it with `manager`. */
export const createPackageFixture = async (manager: PackageManager): Promise<PackageFixture> => {
  const dir = await mkdtemp(join(tmpdir(), `readonly-mcp-${manager}-`));
  const fixture: PackageFixture = {
    dir,
    [Symbol.asyncDispose]: () => rm(dir, { force: true, maxRetries: 3, recursive: true }),
  };
  try {
    const manifest = { name: 'fixture', private: true, dependencies: { [dependency]: version } };
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
    await run(...shimmed(manager, installArgs[manager]), { cwd: dir });
    return fixture;
  } catch (error) {
    await fixture[Symbol.asyncDispose]();
    throw error;
  }
};

/*
 * Vitest gives a fixture no timeout of its own: a file-scoped one is set up
 * inside whichever tests first ask for it, and under `describe.concurrent`
 * that is all of them, each paying for the install against its own timeout.
 * Suites using {@link itWithPackageServer} take this bound, sized to an install
 * on a loaded machine rather than to the commands under test.
 */
export const packageServerTimeout = 60_000;

/**
 * Extends `it` with a server running in a {@link PackageFixture} installed by
 * `manager`, shared by every test in the file.
 */
export const itWithPackageServer = (manager: PackageManager) =>
  it.extend<{ server: ReturnType<typeof startServer> }>({
    server: [async ({}, use) => {
      await using project = await createPackageFixture(manager);
      const server = startServer({ cwd: project.dir });
      try {
        await server.initialize();
        await use(server);
      } finally {
        await server.close();
      }
    }, { scope: 'file' }],
  });
