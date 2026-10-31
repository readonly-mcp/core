/**
 * Arbitrary test data with a domain shape worth centralizing. Raw primitives
 * come from faker directly.
 *
 * No value starts with `-` or contains `..` or `@`, so none can read as a
 * flag, a traversal, or a file reference and change what the security
 * boundary under test decides.
 */

import { faker } from '@faker-js/faker';

/**
 * A source of arbitrary words that never repeats one, for tests where a value
 * colliding with another (an "unknown" subcommand landing in the allowlist)
 * would flip the result. Draws one at a time, which `uniqueArray` cannot.
 */
export const distinctWords = (): (() => string) => {
  const pool = faker.helpers.shuffle([...faker.definitions.lorem.word]);
  return () => {
    const word = pool.pop();
    if (word === undefined) throw new Error('distinctWords exhausted the lorem word list');
    return word;
  };
};

/**
 * Distinct arbitrary words.
 */
export const words = (count: number): string[] =>
  faker.helpers.uniqueArray(() => faker.lorem.word(), count);

/**
 * Arbitrary long flag, e.g. `--foo-bar`.
 */
export const longFlag = (): string => `--${faker.lorem.slug()}`;

/**
 * Arbitrary owner or repository name, e.g. `octo-org`.
 */
export const ownerName = (): string => faker.internet.domainWord();

/**
 * Arbitrary `owner/repo` slug.
 */
export const repoSlug = (): string => `${ownerName()}/${ownerName()}`;

/**
 * Arbitrary repository REST path prefix, e.g. `repos/octo-org/widget`.
 */
export const repoApiPath = (): string => `repos/${repoSlug()}`;

/**
 * Arbitrary single-parameter query string, e.g. `?foo=bar`.
 */
export const queryString = (): string => `?${faker.lorem.word()}=${faker.lorem.word()}`;

/**
 * Arbitrary pull request review comments path, the endpoint most API tests
 * use as their allowed baseline.
 */
export const prCommentsPath = (): string => `${repoApiPath()}/pulls/${resourceId()}/comments`;

/**
 * Arbitrary issue, pull request, or other numeric resource id.
 */
export const resourceId = (): string => String(faker.number.int({ max: 99_999, min: 1 }));

/**
 * Arbitrary full commit SHA.
 */
export const commitSha = (): string => faker.git.commitSha();

/**
 * Arbitrary file name with the given extension, e.g. `foo-bar.json`.
 */
export const fileName = (extension = faker.system.commonFileExt()): string =>
  `${faker.lorem.slug()}.${extension}`;

/**
 * Arbitrary relative file path one directory deep, e.g. `foo/bar-baz.js`.
 */
export const relativeFilePath = (): string => `${faker.lorem.word()}/${fileName()}`;

/**
 * Arbitrary absolute POSIX path that does not exist, e.g. `/foo-bar/baz-qux`.
 */
export const absolutePath = (): string => `/${faker.lorem.slug()}/${faker.lorem.slug()}`;

const placeholders = {
  branch: () => faker.lorem.slug(2),
  file: () => fileName(),
  host: () => faker.internet.domainName(),
  number: resourceId,
  owner: ownerName,
  path: relativeFilePath,
  repo: ownerName,
  sha: commitSha,
  version: () => `v${faker.system.semver()}`,
  word: () => faker.lorem.word(),
} satisfies Readonly<Record<string, () => string>>;

/*
 * The runtime regex's `[a-z]`, spelled out: template literal types have no
 * character classes. `Lowercase<C>` tricks would also admit non-ASCII
 * letters the regex rejects.
 */
type Letter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';

/** The run of lowercase letters `S` starts with, which the filler reads as a key. */
type LeadingKey<S extends string, Key extends string = ''> =
  S extends `${infer C extends Letter}${infer Rest}` ? LeadingKey<Rest, `${Key}${C}`> : Key;

/** Every key the filler would read out of `S`; `""` where a colon starts none. */
type KeysIn<S extends string> =
  S extends `${string}:${infer After}` ? LeadingKey<After> | KeysIn<After> : never;

type UnknownKeys<S extends string> = Exclude<KeysIn<S>, keyof typeof placeholders | ''>;

/**
 * `S` itself when every placeholder in it is known, otherwise a message type
 * that no argument matches. A widened `string` is rejected outright, since
 * its keys cannot be checked: tables feeding a template need `as const`.
 */
type CheckedTemplate<S extends string> =
  string extends S ? 'a template must be a string literal'
  : [UnknownKeys<S>] extends [never] ? S
  : `unknown template placeholder :${UnknownKeys<S>}`;

type Filler = <const S extends string>(template: CheckedTemplate<S>) => string;

// The same generators, looked up by the plain string the regex captures.
const generators: Readonly<Partial<Record<string, () => string>>> = placeholders;

/**
 * A filler for `:key` placeholders in a route or argument template, e.g.
 * `repos/:owner/:repo/pulls/:number` → `repos/octo-org/widget/pulls/42`.
 * Every occurrence of a key across the filler's calls gets the same value,
 * so an alias's args and its expected canonical args agree. The template
 * doubles as a stable test name. `:key` rather than `{key}`, which tea
 * expands itself. Unknown keys fail to compile.
 */
export const templateFiller = (): Filler => {
  const values = new Map<string, string>();
  const valueOf = (placeholder: string, key: string): string => {
    const known = values.get(key);
    if (known !== undefined) return known;
    const generate = generators[key];
    // Unreachable through the types; kept for callers that bypass them.
    if (generate === undefined) throw new Error(`Unknown template placeholder: ${placeholder}`);
    const value = generate();
    values.set(key, value);
    return value;
  };
  return template => template.replace(/:([a-z]+)/g, valueOf);
};

/**
 * Fills one template with fresh values; see `templateFiller`.
 */
export const template: Filler = text => templateFiller()(text);

/**
 * Arbitrary https URL on an arbitrary host.
 */
export const httpsUrl = (): string => `https://${faker.internet.domainName()}`;
