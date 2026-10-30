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
  stage-package.mjs Stages the npm package in dist/source (`pnpm run build`)
test/
  <tool>.test.mjs   Per-tool security + functionality tests
  shell-injection.test.mjs   Cross-tool injection attack tests
  helpers.mjs       Shared test utilities
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
1. Add tests in `test/<name>.test.mjs` covering allowed commands, blocked
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

## Formatting

See `.editorconfig`. ESM only (`.mjs`).
