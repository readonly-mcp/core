# @readonly-mcp/server — Agent Guide

Security-hardened MCP server providing read-only CLI access for AI agents.
See `README.md` for the full security model and tool reference.

## Architecture

```
index.ts            Server entry point (security rationale in header comment)
lib/
  allowlist.ts      Allowlist matching, flag blocking, JSON array coercion
  exec.ts           Sandboxed command execution (execFile, no shell)
tools/
  index.ts          Tool registry (barrel export)
  <tool>.ts         One file per CLI tool (git, gh, az, npm, pnpm, chezmoi, acli, shell, tea)
scripts/
  stage-package.ts  Stages the npm package in dist/source (`pnpm run build`)
test/
  <tool>.test.ts    Per-tool security + functionality tests
  shell-injection.test.ts   Cross-tool injection attack tests
  builders.ts       Arbitrary test-data builders (faker)
  helpers.ts        Shared test utilities
```

## Security Principles

These are non-negotiable. Every change must preserve them:

- **Allowlists, not denylists** — commands/subcommands must be explicitly permitted
- **`execFile`, no shell** — prevents metacharacter injection
- **Prefix flag matching** — defeats CLI flag abbreviation bypass
- **No `cwd` parameter** — except when validated against an enumerable trusted source
  (see `cwd` exception criteria in `index.ts` header)

## Adding a New Tool

1. Create `tools/<name>.ts` — export a function that takes a `McpServer` and
   registers the tool via `server.tool()`
1. Define a `SUBCOMMANDS` set of allowed subcommands
1. Define `BLOCKED_FLAGS` for any flags that could mutate state, leak secrets,
   or enable SSRF
1. Use `rejectSubcommand()` and `rejectBlockedFlags()` from `lib/allowlist.ts`
1. Use `exec()` from `lib/exec.ts` — never `child_process` directly
1. Re-export from `tools/index.ts`
1. Add tests in `test/<name>.test.ts` covering allowed commands, blocked
   subcommands, blocked flags, and injection attempts. Write each `vi.mock`
   path with the module's `.ts` specifier: vitest matches it exactly, and a
   stale path silently leaves the real module in place.

## Adding Subcommands to an Existing Tool

1. Add the subcommand to the tool's `SUBCOMMANDS` set
1. If the subcommand has sub-subcommands (e.g., `git stash list`), add an
   allowed-subs set and validate in the handler
1. Add tests for the new subcommand — both positive and negative cases

## Testing

Run the full suite before every commit:

```bash
pnpm test
```

Tests validate the security boundary, not just functionality. Every blocked
flag, blocked subcommand, and injection vector has a corresponding test.
If you add a new restriction, add a test that proves it blocks the attack.
If you relax a restriction, justify it in the commit message.

Generate incidental values (owners, ids, file names, output text) from
`test/builders.ts` (`import * as build from "./builders.ts"`) or from
`@faker-js/faker` for raw primitives, and capture each in a local the
assertion references. Write a value literally when the code under test
branches on it: an allowlisted subcommand, a blocked flag, the prefix
relation between two flags, the shape of an attack. Give `it.for` rows that
carry generated values an explicit `name` rather than deriving it from their
args, so test names stay the same across runs.

## Formatting

See `.editorconfig`. TypeScript, ESM only. Import relative modules by their
`.ts` path: Node runs the sources directly, and `tsc` resolves a `.js`
specifier that Node then cannot find.
