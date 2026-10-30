# @readonly-mcp/server

A security-hardened [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI agents read-only access to CLI tools. Designed for auto-allow environments where the allowlist is the sole security boundary against prompt injection.

## Why this exists

Most agent frameworks restrict tool access through prompt instructions or by curating which tools the model sees. These are soft boundaries — a prompt injection that convinces the agent to "use bash instead" or "call this unlisted function" bypasses them entirely. The restriction lives in the model's interpretation, not in code the model cannot influence.

This server moves the boundary to the execution layer. The allowlist is enforced at runtime by the MCP server process: if a command isn't explicitly permitted, the server rejects it before any process is spawned. No amount of creative prompting changes what `execFile` will execute. The agent can request anything — the server decides what actually runs.

The goal is to make auto-allow safe for read-only tools. Without enforcement at the server, auto-allowing an MCP tool is equivalent to giving the agent unrestricted shell access, because the tool's "read-only" contract is only as strong as the model's compliance.

## Security model

- **Allowlists, not denylists** — every command and subcommand must be explicitly permitted
- **No `cwd` parameter** — commands run in the server's working directory only, preventing agents from reading files in arbitrary directories
- **`execFile`, no shell** — prevents shell metacharacter injection (`;`, `&&`, `|`, `$()`, `` ` ``) even when args contain untrusted input
- **Prefix flag matching** — `rejectBlockedFlags` uses prefix matching to defeat CLI flag abbreviation (e.g., npm expands `--reg` to `--registry`). Exact matching would be bypassable.
- **`--registry` blocked** — prevents SSRF / data exfiltration to attacker-controlled registries
- **`--ignore-scripts` injected** — defense-in-depth for npm to block lifecycle scripts. `--no-ignore-scripts` and `--ignore-scripts` are also blocked from user-provided args to prevent last-wins override.
- **`az devops invoke` flag allowlist** — unknown flags are rejected (allowlist, not blocklist), blocking abbreviation bypass
- **Resource limits** — 10 s timeout, 2 MB maxBuffer to prevent runaway commands
- **Windows support** — `bash -c 'exec "$@"'` wrapper preserves `execFile` guarantees for shell utilities

### Excluded by design

| Command / flag | Reason |
|---|---|
| `chezmoi cat-config` | May leak encryption keys, GPG recipient IDs, or other sensitive configuration |
| `chezmoi data` | Leaks template variables that may contain secrets |
| `printenv` / `env` | Leaks environment variables (API keys, tokens) |
| `rg` | Redundant with host `Grep` tool; allows searching arbitrary paths |
| `cat`, `head`, `tail`, `bat`, `diff`, `delta` | Redundant with host `Read` tool; path args duplicate file-read surface area |
| `git diff --no-index` | Reads arbitrary files outside the repo |
| `git --output` / `diff -o` | Writes command output to a file |
| `gh variable get` | Returns plaintext values that may contain internal URLs, hostnames, or quasi-sensitive configuration |
| `tea logins helper` / `git-credential` | Git credential helper protocol answers with the token on stdout |
| `tea notifications` | Not yet confirmed that listing leaves read state untouched |

## Tools

### `shell`

Read-only shell utilities: `basename`, `date`, `dirname`, `eza`, `file`, `jq`, `ls`, `pwd`, `readlink`, `realpath`, `stat`, `wc`, `which`, `whoami`

`jq` blocks file-path arguments, file-reading flags (`--slurpfile`, `--rawfile`, `-f`, `-L`), combined short flags containing file-read characters (e.g., `-rf`, `-nf`), concatenated `-L/path`, and `--flag=val` forms — use stdin piping instead.

**Schema:** `{ command: string, args?: string[] }`

### `git`

Read-only git commands: `blame`, `branch`, `describe`, `diff`, `log`, `ls-files`, `ls-tree`, `merge-base`, `reflog`, `remote`, `rev-parse`, `shortlog`, `show`, `stash`, `status`, `worktree`

Additional restrictions:
- `--output` blocked globally (prefix matching defeats abbreviation)
- `-o` short flag blocked on `diff` only (other commands use `-o` for unrelated flags, e.g., `ls-files -o` = `--others`)
- `--no-index` blocked globally (prefix matching)
- `branch`: destructive flags blocked (`-D`, `-d`, `-m`, `--delete`, `--force`, etc.)
- `stash`: only `list` and `show` sub-subcommands (`--` treated as terminator)
- `worktree`: only `list` (mutating: `add`, `remove`, `move`, `prune`, etc.)
- `reflog`: only `show`, `exists`, and bare invocation (destructive: `delete`, `expire`)
- `remote`: only bare listing, `get-url`, and `show -n` (no network I/O)

**Schema:** `{ args: string[] }`

### `gh`

Read-only GitHub CLI commands: `attestation verify`, `cache list`, `gist list/view`, `issue list/status/view`, `label list`, `pr checks/diff/list/status/view`, `project field-list/item-list/list/view`, `release list/view`, `repo list/view`, `ruleset check/list/view`, `run list/view`, `search code/commits/issues/prs/repos`, `secret list`, `status`, `variable list`, `workflow list/view`

Also supports `--version`, `--help`, `-h` as standalone flags.

**Schema:** `{ args: string[] }`

### `tea`

Read-only Gitea and Forgejo CLI commands: `branches list`, `comments list`, `issues [index]/list`, `labels list`, `logins list`, `milestones issues/list`, `pulls [index]/list/review-comments`, `releases list`, `repos list/search`, `whoami`

Also supports `--version`, `-v`, `--help`, `-h` as standalone flags. Noun and verb aliases (`pr`, `ms`, `ls`, …) are accepted and run under their canonical names.

Additional restrictions:
- Viewing by bare index (`pulls 2`, `issues 5`) accepts only known flags and a single numeric index, because tea dispatches to any positional naming a child command (`pulls --state all merge 2`)
- `milestones issues` rejects its `add`/`remove` children, by name or alias, anywhere in the args
- `--repo` accepts only an `owner/name` slug; local repository paths are rejected
- `--debug`/`--vvv` blocked; `labels --save` blocked (writes a file)
- `logins helper` (alias `git-credential`) excluded: it is a git credential helper that prints the token

`api` is restricted to GET requests against `repos/*/*/pulls/*/reviews`, `repos/*/*/pulls/*/reviews/*/comments`, `repos/*/*/commits/*/status`, `repos/*/*/commits/*/statuses`, `repos/*/*/contents[/**]`, `repos/*/*/raw/**` and `user`. `{owner}` and `{repo}` placeholders are accepted. `--method GET` is injected after the endpoint; request-body flags (`-f`, `-F`, `-d`), `-X`, `-H` and `-o` (writes the response to a file) are blocked, and `.`/`..` segments and encoded separators are rejected, whether plain, percent-encoded or double-encoded, as is any `#` (the URL parser would cut the path there). Use `raw/**` for file contents: `contents/**` returns them base64-encoded in JSON.

**Token exposure the tool cannot block:** Forgejo echoes a rejected token in its error body (`access token does not exist [sha: …]`), so any `tea api` call made with a revoked token prints the credential. No flag causes it.

**Schema:** `{ args: string[] }`

### `az`

Read-only Azure DevOps CLI commands: `devops project/team/extension/service-endpoint/wiki`, `pipelines list/show/build/release/runs/pool/agent`

`devops invoke` is restricted to GET-only requests against build-debugging endpoints (`build/builds`, `build/timeline`, `build/logs`, `build/changes`, `build/artifacts`, `build/leases`, `test/runs`). Unknown flags are rejected (allowlist, not blocklist).

**Schema:** `{ args: string[] }`

### `npm`

Read-only npm commands: `audit`, `bin`, `explain`, `fund`, `ls`, `outdated`, `root`, `search`, `view`

Blocked flags: `--fix`, `--registry`, `--no-ignore-scripts`, `--ignore-scripts`. `--ignore-scripts` is always re-injected by the server.

**Schema:** `{ args: string[] }`

### `pnpm`

Read-only pnpm commands: `audit`, `bin`, `licenses list`, `list`, `outdated`, `root`, `search`, `store status`, `why`

Also supports `--version`, `--help`, `-h` as standalone flags.

Blocked flags: `--fix`, `--registry`

**Schema:** `{ args: string[] }`

### `chezmoi`

Read-only chezmoi commands: `diff`, `doctor`, `managed`, `source-path`, `status`, `target-path`, `verify`

**Schema:** `{ args: string[] }`

### `acli`

Read-only Atlassian CLI commands: `jira board list`, `jira filter list`, `jira project list`, `jira sprint list`, `jira workitem comment list`, `jira workitem list/search/view`

**Schema:** `{ args: string[] }`

## Installation

```bash
pnpm add -g @readonly-mcp/server
```

### Claude Code

```bash
claude mcp add -s user readonly -- readonly-mcp
```

To auto-approve all readonly tools, add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__readonly__*"
    ]
  }
}
```

### VS Code / Copilot

Add to your `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "readonly": {
        "command": "readonly-mcp"
      }
    }
  }
}
```

## Development

```bash
pnpm install   # first time only
pnpm test
```

## Project structure

```
index.mjs           Server entry point
lib/
  allowlist.ts      Allowlist matching and validation
  exec.ts           Sandboxed command execution
tools/
  index.mjs         Tool registry
  acli.ts           Atlassian CLI tool
  az.mjs            Azure DevOps CLI tool
  chezmoi.ts        Chezmoi tool
  gh.mjs            GitHub CLI tool
  git.mjs           Git tool
  npm.ts            npm tool
  pnpm.ts           pnpm tool
  shell.ts          Shell utilities tool
  tea.mjs           Gitea/Forgejo CLI tool
test/               Unit and integration tests (vitest)
```
