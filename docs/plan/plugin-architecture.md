# Plugin Architecture

Design document for making @readonly-mcp/core extensible with third-party tools.

## Problem

Adding a new tool today requires editing files inside this repo (create
`tools/<name>.mjs`, re-export from `tools/index.mjs`). External consumers
cannot add tools without forking. The goal is to allow N tools from N authors
while preserving the security guarantees documented in `index.mjs`.

## Approach: Descriptor-Based Plugin API

Plugins never receive the MCP `server` object. Instead, they export a
**descriptor** that the core loader validates and registers on their behalf.

### Plugin contract

A plugin is an ESM module whose default export is a descriptor (or array of
descriptors):

```js
import { ArgsSchema, matchesAllowlist, rejectSubcommand, rejectBlockedFlags } from "@readonly-mcp/core/allowlist";
import { exec, fail } from "@readonly-mcp/core/exec";

const SUBCOMMANDS = new Set(["get", "describe", "logs"]);
const BLOCKED_FLAGS = new Set(["--delete", "--force"]);

/** @type {import("@readonly-mcp/core").ToolDescriptor} */
export default {
  name: "kubectl",
  description: "Read-only kubectl commands: get, describe, logs",
  schema: ArgsSchema,
  async handler({ args }) {
    if (!matchesAllowlist(args, SUBCOMMANDS))
      return rejectSubcommand(args, SUBCOMMANDS);
    const rejected = rejectBlockedFlags(args, BLOCKED_FLAGS);
    if (rejected) return rejected;
    return exec("kubectl", args);
  },
};
```

Tools with custom schema fields spread `ArgsSchema` into a larger object:

```js
import { z } from "zod";
import { ArgsSchema } from "@readonly-mcp/core/allowlist";

export default {
  name: "mytool",
  description: "...",
  schema: { command: z.string(), ...ArgsSchema },
  async handler({ command, args }) { /* ... */ },
};
```

Handlers must return the MCP content response shape:

```js
// Success
{ content: [{ type: "text", text: "output" }] }

// Error
{ content: [{ type: "text", text: "message" }], isError: true }
```

Use `text()` and `fail()` from `@readonly-mcp/core/exec` to produce these.

### Built-in tool migration

Built-in tools (`tools/*.mjs`) will be converted to the descriptor format.
Each file's `export const register = (server) => server.tool(...)` becomes
`export default { name, description, schema, handler }`. The loader handles
one format — no dual-path registration.

### Core loader

The core replaces the static barrel import (`tools/index.mjs`) with a dynamic
loader that:

1. Scans `tools/*.mjs` for built-in tools (same as today, minus the barrel)
1. Scans additional directories for external plugins (see Discovery below)
1. Validates each descriptor against a schema (name, description, schema,
   handler must be present; name must match `/^[a-z][a-z0-9_-]*$/`)
1. Rejects duplicate names (first registration wins; built-ins load first)
1. Wraps each `handler` in a try/catch so a throwing or rejecting plugin
   returns an `isError` response instead of crashing the server
1. Calls `server.tool(name, description, schema, wrappedHandler)` on the
   plugin's behalf
1. Logs load-time failures (syntax errors, missing dependencies) to stderr
   and continues — a broken plugin does not prevent the server from starting

Plugins never see or touch the `server` instance.

### Discovery

External plugins are discovered from multiple sources. When names collide,
the first source wins (highest priority first):

1. Built-in tools (`tools/*.mjs` in this repo)
1. `READONLY_MCP_PLUGINS` environment variable (paths separated by
   `path.delimiter` — semicolon on Windows, colon on Unix)
1. `~/.config/readonly-mcp/plugins/` (user-level directory)
1. Sibling `@readonly-mcp/plugin-*` packages (convention-based, see below)

Directories (sources 2 and 3) are scanned for `*.mjs` files. Subdirectories
are not traversed (flat structure). Each file is loaded via dynamic `import()`
and its default export is validated as a descriptor:

```js
import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const loadFromDirectory = async (dir) => {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return []; // directory does not exist
  }
  const plugins = [];
  for (const entry of entries.filter((e) => e.endsWith(".mjs"))) {
    try {
      const mod = await import(pathToFileURL(path.join(dir, entry)).href);
      const descriptors = Array.isArray(mod.default)
        ? mod.default
        : [mod.default];
      plugins.push(...descriptors);
    } catch (err) {
      console.error(`Failed to load plugin ${entry}: ${err.message}`);
    }
  }
  return plugins;
};
```

A plugin can also be an installed npm package. For packages matching the
`@readonly-mcp/plugin-*` convention, the loader discovers sibling packages
using the core's own location — no package manager CLI required:

```js
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import path from "node:path";

const coreDir = path.dirname(fileURLToPath(import.meta.url));
const scopeDir = path.resolve(coreDir, "..");
// Only scan if the parent is actually a @readonly-mcp scope directory
// (not the repo root during development)
if (path.basename(scopeDir) !== "@readonly-mcp") return [];
const entries = await readdir(scopeDir);
const plugins = entries.filter((e) => e.startsWith("plugin-"));
```

This works regardless of how the core was installed (npm, pnpm, yarn, bun)
because all package managers place scoped packages in
`node_modules/@scope/package/`. The core is always at
`node_modules/@readonly-mcp/core/`, so sibling `plugin-*` directories are
one level up. Symlinked stores (pnpm) still expose the expected directory
structure at the `node_modules/` level.

### Version compatibility

Plugins declare `@readonly-mcp/core` as a `peerDependency` in their
`package.json`. The loader checks the installed core version against the
plugin's peer range at load time and warns on mismatch (does not hard-fail,
since most minor changes are backward-compatible).

The descriptor may include an optional `minCoreVersion` field (semver string)
as an escape hatch for plugins that depend on specific core APIs introduced
after 1.0. The loader rejects the plugin with a stderr warning if the running
core version is below `minCoreVersion`.

Full descriptor type:

```ts
interface ToolDescriptor {
  name: string;                          // /^[a-z][a-z0-9_-]*$/
  description: string;
  schema: Record<string, z.ZodTypeAny>;  // Zod schema fields
  handler: (params: Record<string, unknown>) => Promise<ToolResponse>;
  minCoreVersion?: string;               // semver, e.g., "1.2.0"
}
```

### Publishing the core to npm

The core package must be published to npm as `@readonly-mcp/core` so external
plugins can depend on it. This requires:

- Remove `"private": true` from `package.json`
- Add `"exports"` mapping subpath imports to source files:
  ```json
  {
    "exports": {
      ".": "./index.mjs",
      "./allowlist": "./lib/allowlist.mjs",
      "./exec": "./lib/exec.mjs"
    }
  }
  ```
- Add `"files"` to limit the published tarball to runtime code
  (`index.mjs`, `lib/`, `tools/`)
- Create the `@readonly-mcp` npm org (prerequisite — the entire
  convention-based plugin discovery depends on this scope existing)
- Publish to npm under the `@readonly-mcp` scope

ESM module namespace objects are already immutable by spec — exports cannot be
reassigned or deleted by plugin code. The exported *values* (functions) are
stateless, so there is no shared mutable state for plugins to corrupt.

### Standalone flags

Some tools allow `--version`, `--help`, or `-h` as standalone flags (not
subcommands). The core exports a helper for this pattern:

```js
import { isStandaloneFlag } from "@readonly-mcp/core/allowlist";

async handler({ args }) {
  if (isStandaloneFlag(args)) return exec("mytool", args);
  if (!matchesAllowlist(args, SUBCOMMANDS))
    return rejectSubcommand(args, SUBCOMMANDS);
  // ...
}
```

### Plugin author workflow

1. Create a `package.json` with `"type": "module"` and the core as a peer
   dependency:
   ```json
   {
     "name": "@readonly-mcp/plugin-kubectl",
     "version": "1.0.0",
     "type": "module",
     "main": "index.mjs",
     "peerDependencies": {
       "@readonly-mcp/core": "^1.0.0"
     },
     "devDependencies": {
       "@readonly-mcp/core": "^1.0.0"
     }
   }
   ```

1. Create the plugin entry point (`index.mjs`) — see the plugin contract
   example above for the full pattern.

1. Install dev dependencies and write tests.

1. Test locally by dropping `index.mjs` into
   `~/.config/readonly-mcp/plugins/` or setting `READONLY_MCP_PLUGINS`
   to the plugin directory. Restart the MCP server and verify the tool
   appears.

1. Publish to npm. Plugins under the `@readonly-mcp` scope get
   convention-based discovery; plugins under other scopes work via the
   env-var or directory-based paths.

### User installation flow

Install a published `@readonly-mcp/plugin-*` package alongside the core
(globally, or in the same project). The core discovers sibling scoped packages
automatically — no additional configuration needed. Restart the MCP server (or
reconnect the client) and the new tool is available.

For plugins outside the `@readonly-mcp` scope, or for local/unpublished
plugins:

- Drop the `.mjs` file into `~/.config/readonly-mcp/plugins/`
- Or add the plugin's directory to `READONLY_MCP_PLUGINS` in the MCP server's
  environment

### What this solves

- Plugins cannot re-register, unregister, or shadow built-in tools (no server
  access)
- Plugins cannot reassign shared security exports (ESM namespace immutability)
- A throwing plugin does not crash the server (try/catch wrapper)
- Plugin authors get the same allowlist/exec helpers as built-in tools
- Adding a tool is: write a file, drop it in a directory (or publish a package)

### What this does NOT solve

The `handler` function runs **in the same Node.js process** as the core. A
malicious handler can:

- `import('child_process')` and exec arbitrary commands
- Read/write the filesystem via `fs`
- Make network requests
- Access `process.env`, `process.exit()`, `globalThis`

**The trust model is identical to installing an npm package.** Users must trust
the plugin code the same way they trust any dependency. This is the same trust
model used by VS Code extensions, ESLint plugins, and MCP servers themselves.

Document this clearly in user-facing docs so plugin consumers understand the
boundary.

## Future Consideration: Process Isolation

The descriptor-based API prevents plugins from misusing the core's API surface
but does not restrict what plugin code can do at the runtime level. Process
isolation addresses this by running each third-party plugin as a **separate
child process**.

### Architecture

The core server becomes a multiplexer:

```
Client <-> Core server (built-in tools + proxy layer)
               |             |            |
          Plugin A       Plugin B     Plugin C
        (child proc)   (child proc)  (child proc)
```

Each plugin is a standalone MCP server (using `@readonly-mcp/core` for
security primitives) that communicates with the core over stdio. The core:

1. Discovers plugin server executables via the same directories as above
1. Spawns each as a child process with `StdioClientTransport`
1. Calls `listTools()` on each plugin server at startup
1. Registers proxy tools on the main server that forward `callTool` requests
   to the appropriate child
1. Namespaces plugin tool names to prevent collisions
   (e.g., `kubectl` from `plugin-kubectl` becomes `kubectl` or
   `plugin-kubectl__kubectl` depending on conflict)

### What this adds over the descriptor-based API

- A plugin crash only kills its own process; the core and other plugins
  continue running
- Plugin processes can be resource-limited (timeout, memory caps) at the OS
  level
- A foundation for future OS-level sandboxing if Node.js or the OS provides it

### What this does NOT add

Node.js has **no usable sandbox mechanism** for restricting spawned processes:

- `vm` module is explicitly not a security mechanism (trivially escapable)
- The Permission Model (`--experimental-permission`, Node 20+) applies to the
  entire process — a plugin child process would need the same
  `--allow-fs-read` and `--allow-child-process` permissions as the core to
  function
- There is no way to restrict what a spawned Node.js process can do without
  OS-level mechanisms (seccomp, namespaces, Windows job objects)

**Process isolation provides crash isolation and a hook point for future OS
sandboxing, but it does not provide security isolation out of the box.** A
malicious plugin running as a child process still has full access to the
filesystem, network, and environment unless the OS restricts it.

### Cost

- One child process per plugin (memory, startup latency, stdio overhead)
- More complex error handling (process crashes, timeouts, reconnection)
- Plugin authors must structure their code as a standalone MCP server, not just
  a descriptor — higher barrier to entry
- The core needs an MCP client implementation to talk to plugin servers

### Recommendation

**Start with the descriptor-based API.** It is sufficient for the current trust
model (plugins are npm packages users explicitly install), cheaper to implement,
and lower friction for plugin authors. Process isolation can be added later as
an opt-in mode for environments that require stronger isolation, without
breaking the plugin contract — a descriptor can be promoted to a standalone
server by wrapping it in a thin MCP server entrypoint.
