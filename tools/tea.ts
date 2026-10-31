import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ArgsSchema, matchesApiPath, normalizeApiPath,
  rejectApiEndpoint, rejectBlockedFlags, rejectSubcommand,
} from '../lib/allowlist.ts';
import { exec, fail } from '../lib/exec.ts';

const GLOBAL_FLAGS = new Set(['--help', '--version', '-h', '-v']);

// Aliases from `tea <noun> --help` (tea 0.16.0). Only nouns and verbs with an
// allowed command are listed: anything else stays unresolved and is rejected,
// so a missing alias fails closed.
const NOUN_ALIASES: Record<string, readonly string[]> = {
  branches: ['b', 'branch'],
  comments: ['c', 'comment'],
  issues: ['i', 'issue'],
  labels: ['label'],
  logins: ['login'],
  milestones: ['milestone', 'ms'],
  pulls: ['pr', 'pull'],
  releases: ['r', 'release'],
  repos: ['repo'],
  whoami: [],
};

const VERB_ALIASES: Record<string, Record<string, readonly string[]>> = {
  branches: { list: ['ls'] },
  comments: { list: ['ls'] },
  issues: { list: ['ls'] },
  labels: { list: ['ls'] },
  logins: { list: ['ls'] },
  milestones: { issues: ['i'], list: ['ls'] },
  pulls: { 'list': ['ls'], 'review-comments': ['rc'] },
  releases: { list: ['ls'] },
  repos: { list: ['ls'], search: ['s'] },
  whoami: {},
};

const resolverOf = (aliases: Record<string, readonly string[]>): Map<string, string> => new Map(
  Object.entries(aliases).flatMap(([name, alts]) =>
    [name, ...alts].map((alias): [string, string] => [alias, name])),
);

const NOUNS = resolverOf(NOUN_ALIASES);
const VERBS = Object.fromEntries(
  Object.entries(VERB_ALIASES).map(([noun, verbs]) => [noun, resolverOf(verbs)]),
);

// Commands whose children are all excluded, so the remaining args are free.
const LEAVES = new Set([
  'branches list',
  'comments list',
  'issues list',
  'labels list',
  'logins list',
  'milestones list',
  'pulls list', 'pulls review-comments',
  'releases list',
  'repos list', 'repos search',
  'whoami',
]);

// Commands that act without a verb but also have children (`tea pulls 2`
// views, `tea pulls merge 2` merges). tea dispatches to the first positional
// naming a child, even after flags, so these accept only flags whose arity is
// known and check every positional. Flags from `tea <command> --help`.
const SHARED_VALUE_FLAGS = [
  'f', 'fields', 'l', 'limit', 'lm', 'login', 'o', 'output', 'p', 'page',
  'R', 'r', 'remote', 'repo', 'state',
];

type BarePolicy = {
  booleans: ReadonlySet<string>;
  positional: (arg: string) => boolean;
  values: ReadonlySet<string>;
};

const BARE: Record<string, BarePolicy> = {
  'issues': {
    booleans: new Set(['comments', 'h', 'help']),
    positional: arg => /^\d+$/.test(arg),
    values: new Set([
      ...SHARED_VALUE_FLAGS,
      'A', 'a', 'assignee', 'author', 'F', 'from', 'K', 'k', 'keyword', 'kind',
      'L', 'labels', 'M', 'm', 'mentions', 'milestones', 'org', 'owner', 'u', 'until',
    ]),
  },
  'milestones issues': {
    booleans: new Set(['h', 'help']),
    positional: arg => !['a', 'add', 'r', 'remove'].includes(arg),
    values: new Set([...SHARED_VALUE_FLAGS, 'kind']),
  },
  'pulls': {
    booleans: new Set(['comments', 'h', 'help']),
    positional: arg => /^\d+$/.test(arg),
    values: new Set(SHARED_VALUE_FLAGS),
  },
};

// tea (urfave/cli) treats `-name` and `--name` alike, so `-debug` must be
// caught as `--debug`. Single-dash forms are lengthened for the prefix
// matcher; single-letter flags already match as short flags.
const toLongForm = (arg: string): string => /^-[^-][^=]/.test(arg) ? '-' + arg : arg;

const flagName = (arg: string): string => arg.replace(/^--?/, '').split('=', 1)[0] ?? '';

const isFlag = (arg: string): boolean => arg.startsWith('-') && arg !== '-' && arg !== '--';

// --debug / --vvv: may print the Authorization header, like gh --verbose.
const BLOCKED_FLAGS = new Set(['--debug', '--vvv']);

// labels --save / -s: writes the label set to a file.
const NOUN_BLOCKED_FLAGS: Record<string, ReadonlySet<string>> = { labels: new Set(['--save', '-s']) };

const rejectFlags = (args: readonly string[], blocked: ReadonlySet<string>): CallToolResult | null =>
  rejectBlockedFlags(args, blocked) ??
  rejectBlockedFlags(args.map(toLongForm), blocked);

// --repo also accepts a local repository path, which would point tea at a
// directory outside the server's working directory. Only `owner/name` slugs
// pass; `.` and `..` segments are paths, not names.
const isRepoSlug = (value: string): boolean =>
  /^[\w.-]+\/[\w.-]+$/.test(value) &&
  value.split('/').every(segment => !/^\.+$/.test(segment));

const repoValues = (args: readonly string[]): string[] => args.flatMap((arg, i) => {
  if (!isFlag(arg) || !['r', 'repo'].includes(flagName(arg))) return [];
  const eq = arg.indexOf('=');
  return [eq === -1 ? args[i + 1] ?? '' : arg.slice(eq + 1)];
});

const rejectRepoPath = (args: readonly string[]): CallToolResult | null => {
  const path = repoValues(args).find(value => !isRepoSlug(value));
  return path === undefined ? null : fail(`--repo must be an owner/name slug, not a path: ${path}`);
};

// Walks the args after a bare command, consuming each flag's value by arity.
// Unknown flags are rejected because their arity, and so whether the next arg
// is a value or a positional, cannot be known.
const rejectBareArgs = (args: readonly string[], { booleans, positional, values }: BarePolicy): CallToolResult | null => {
  const step = (i: number, positionals: readonly string[], endOfOptions: boolean): CallToolResult | null => {
    // Past the end, whether by one or by a skipped flag value.
    const arg = args[i];
    if (arg === undefined) {
      if (positionals.length > 1)
        return fail(`At most one positional argument allowed, got: ${positionals.join(' ')}`);
      const invalid = positionals.find(p => !positional(p));
      return invalid === undefined ? null : fail(`Positional argument not allowed: ${invalid}`);
    }
    if (endOfOptions || !arg.startsWith('-') || arg === '-')
      return step(i + 1, [...positionals, arg], endOfOptions);
    if (arg === '--') return step(i + 1, positionals, true);
    const name = flagName(arg);
    if (booleans.has(name)) return step(i + 1, positionals, false);
    if (values.has(name)) return step(i + (arg.includes('=') ? 1 : 2), positionals, false);
    return fail(`Flag not allowed: ${arg}`);
  };
  return step(0, [], false);
};

const resolve = (args: readonly string[]) => {
  const [first, second] = args;
  const noun = first === undefined ? undefined : NOUNS.get(first);
  if (!noun) return null;
  const verb = second === undefined ? undefined : VERBS[noun]?.get(second);
  return verb
    ? { command: [noun, verb], key: `${noun} ${verb}`, noun, rest: args.slice(2) }
    : { command: [noun], key: noun, noun, rest: args.slice(1) };
};

const ALLOWED = new Set([...LEAVES, ...Object.keys(BARE)]);

// tea substitutes {owner} and {repo} from the repository context; `*` already
// matches them as literal segments.
const API_PATHS = [
  'repos/*/*/commits/*/status',
  'repos/*/*/commits/*/statuses',
  // Bare = directory listing, ** = file or nested path. Files come back as
  // base64 in JSON; raw/** serves them as plain text, since Gitea and
  // Forgejo have no raw Accept media type.
  'repos/*/*/contents',
  'repos/*/*/contents/**',
  'repos/*/*/pulls/*/reviews',
  'repos/*/*/pulls/*/reviews/*/comments',
  'repos/*/*/raw/**',
  // Authenticated viewer identity. Single segment, so user/repos and the
  // like stay blocked.
  'user',
];

// --method / -X: overrides the GET injected below
// --field / -f / --Field / -F / --data / -d: request body, which defaults the
//   method to POST; -F and -d also read @file
// --header / -H: arbitrary HTTP header injection
// --output / -o: writes the response body to a path
const API_BLOCKED_FLAGS = new Set([
  '--data', '-d',
  '--Field', '-F', '--field', '-f',
  '--header', '-H',
  '--method', '-X',
  '--output', '-o',
]);

// contents/** and raw/** accept any depth, so a `.` or `..` segment, plain or
// percent-encoded, could resolve to an endpoint the allowlist never named.
// Undecodable segments are rejected rather than guessed at, and so is a dot or
// separator still encoded after one decode (%252e), which a second decode
// anywhere downstream would resolve.
const isPlainSegment = (segment: string): boolean => {
  try {
    const decoded = decodeURIComponent(segment);
    return !/^\.+$/.test(decoded) && !/[/\\]/.test(decoded) &&
      !/%(2e|2f|5c)/i.test(decoded);
  } catch {
    return false;
  }
};

// The URL parser cuts the path at `#`, so a fragment inside a wildcard
// segment (repos/admin#/x/contents/y) would request a truncated endpoint the
// allowlist never named.
const isAllowedEndpoint = (endpoint: string): boolean =>
  !endpoint.includes('#') &&
  matchesApiPath(endpoint, API_PATHS) &&
  normalizeApiPath(endpoint).split('/').every(isPlainSegment);

const runApi = (args: readonly string[]): Promise<CallToolResult> | CallToolResult => {
  const endpoint = args[1];
  if (!endpoint || endpoint.startsWith('-') || !isAllowedEndpoint(endpoint))
    return rejectApiEndpoint(endpoint, API_PATHS);
  const rest = args.slice(2);
  const rejected =
    rejectFlags(args, BLOCKED_FLAGS) ??
    rejectFlags(args, API_BLOCKED_FLAGS) ??
    rejectRepoPath(rest);
  if (rejected) return rejected;
  // Inject --method GET immediately after the endpoint, before any
  // user-supplied flags, so a `--` in user args cannot turn it positional.
  return exec('tea', ['api', endpoint, '--method', 'GET', ...rest]);
};

export const register = (server: McpServer) =>
  server.tool(
    'tea',
    'Run read-only Gitea/Forgejo CLI commands (--version, --help, branches list, comments list, issues [index]/list, labels list, logins list, milestones issues/list, pulls [index]/list/review-comments, releases list, repos list/search, whoami, api GET: pulls/reviews, commits/status+statuses, contents, raw, user)',
    ArgsSchema,
    async ({ args }) => {
      const [only, ...others] = args;
      const isGlobal = only !== undefined && others.length === 0 && GLOBAL_FLAGS.has(only);
      if (isGlobal) return exec('tea', args);
      if (args[0] === 'api') return runApi(args);

      const resolved = resolve(args);
      if (!resolved || !ALLOWED.has(resolved.key))
        return rejectSubcommand(args, ALLOWED);
      const { command, key, noun, rest } = resolved;

      const rejected =
        rejectFlags(args, BLOCKED_FLAGS) ??
        (NOUN_BLOCKED_FLAGS[noun] && rejectFlags(args, NOUN_BLOCKED_FLAGS[noun])) ??
        rejectRepoPath(rest) ??
        (BARE[key] && rejectBareArgs(rest, BARE[key]));
      if (rejected) return rejected;

      // Run under canonical names so what executes is what was validated.
      return exec('tea', [...command, ...rest]);
    },
  );
