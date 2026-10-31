/**
 * Arbitrary test data with a domain shape worth centralizing. Raw primitives
 * come from faker directly.
 *
 * No value starts with `-` or contains `..` or `@`, so none can read as a
 * flag, a traversal, or a file reference and change what the security
 * boundary under test decides.
 */

import { faker } from "@faker-js/faker";

/**
 * A source of arbitrary words that never repeats one, for tests where a value
 * colliding with another (an "unknown" subcommand landing in the allowlist)
 * would flip the result. Draws one at a time, which `uniqueArray` cannot.
 */
export const distinctWords = (): (() => string) => {
  const pool = faker.helpers.shuffle([...faker.definitions.lorem.word]);
  return () => {
    const word = pool.pop();
    if (word === undefined) throw new Error("distinctWords exhausted the lorem word list");
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

/**
 * Arbitrary https URL on an arbitrary host.
 */
export const httpsUrl = (): string => `https://${faker.internet.domainName()}`;
