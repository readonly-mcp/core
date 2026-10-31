import { faker } from '@faker-js/faker';
import { describe, it } from 'vitest';
import { MAX_BUFFER, text, fail, errorResult } from '../lib/exec.ts';
import * as build from './builders.ts';
import { textOf } from './helpers.ts';

// exec() and execShell() are integration-tested through every tool test.
// These unit tests cover the pure helper functions.

describe('text()', () => {
  it('combines stdout and stderr', ({ expect }) => {
    const stdout = faker.lorem.sentence();
    const stderr = faker.lorem.sentence();
    const result = text(`${stdout}\n`, `${stderr}\n`);
    expect(textOf(result)).toBe(`${stdout}\n${stderr}`);
  });

  it('trims trailing whitespace', ({ expect }) => {
    const stdout = faker.lorem.sentence();
    const result = text(`${stdout}  \n\n`, '');
    expect(textOf(result)).toBe(stdout);
  });

  it('returns (no output) for empty strings', ({ expect }) => {
    const result = text('', '');
    expect(textOf(result)).toBe('(no output)');
  });

  it('returns (no output) for whitespace-only', ({ expect }) => {
    const result = text('  \n', '  \n');
    expect(textOf(result)).toBe('(no output)');
  });

  it('does not set isError', ({ expect }) => {
    const result = text(faker.lorem.sentence(), '');
    expect(result.isError).toBeUndefined();
  });
});

describe('fail()', () => {
  it('returns isError: true', ({ expect }) => {
    const result = fail(faker.lorem.sentence());
    expect(result.isError).toBe(true);
  });

  it('includes the message', ({ expect }) => {
    const message = faker.lorem.sentence();
    const result = fail(message);
    expect(textOf(result)).toBe(message);
  });

  it('handles empty message', ({ expect }) => {
    const result = fail('');
    expect(textOf(result)).toBe('');
  });
});

describe(errorResult, () => {
  // Shapes mirror what node:child_process.execFile rejects with: a timeout
  // sets killed/signal with empty output; maxBuffer overflow sets the
  // ERR_CHILD_PROCESS_STDIO_MAXBUFFER code; ordinary failures carry output.

  it('surfaces a timeout kill instead of the generic message', ({ expect }) => {
    const cmd = faker.lorem.word();
    const args = build.words(2);
    const err = { killed: true, signal: 'SIGTERM', code: null, message: faker.lorem.sentence(), stdout: '', stderr: '' };
    const result = errorResult(err, cmd, args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Command timed out after 30s: ${cmd} ${args.join(' ')}`);
  });

  it('appends partial output to a timeout message', ({ expect }) => {
    const cmd = faker.lorem.word();
    const args = build.words(2);
    const partial = faker.lorem.sentence();
    const err = { killed: true, signal: 'SIGTERM', code: null, message: faker.lorem.sentence(), stdout: `${partial}\n`, stderr: '' };
    const result = errorResult(err, cmd, args);
    expect(textOf(result)).toBe(`Command timed out after 30s: ${cmd} ${args.join(' ')}\n${partial}`);
  });

  it('surfaces a maxBuffer overflow', ({ expect }) => {
    const cmd = faker.lorem.word();
    const args = build.words(2);
    const err = { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: faker.lorem.sentence(), stdout: '', stderr: '' };
    const result = errorResult(err, cmd, args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Command output exceeded ${MAX_BUFFER} bytes: ${cmd} ${args.join(' ')}`);
  });

  it('returns ordinary failure output without isError', ({ expect }) => {
    const cmd = faker.lorem.word();
    const args = build.words(1);
    const stderr = faker.lorem.sentence();
    const err = { code: 1, message: faker.lorem.sentence(), stdout: '', stderr: `${stderr}\n` };
    const result = errorResult(err, cmd, args);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(stderr);
  });

  it('falls back to err.message when there is no output', ({ expect }) => {
    const message = faker.lorem.sentence();
    const err = { code: 'ENOENT', message, stdout: '', stderr: '' };
    const result = errorResult(err, faker.lorem.word(), []);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it('reads the fields off a real Error instance', ({ expect }) => {
    const message = faker.lorem.sentence();
    const err = Object.assign(new Error(message), { code: 'ENOENT', stdout: '', stderr: '' });
    const result = errorResult(err, faker.lorem.word(), []);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it('reports a thrown value that is not an execFile error', ({ expect }) => {
    const thrown = faker.lorem.sentence();
    const result = errorResult(thrown, faker.lorem.word(), []);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(thrown);
  });
});
