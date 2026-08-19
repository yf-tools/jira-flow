#!/usr/bin/env node
/**
 * project-scanner MCP server — transport layer
 *
 * Zero-dependency MCP server speaking raw JSON-RPC over stdio
 * (newline-delimited). This file owns only the protocol: framing, method
 * dispatch, and the tool schema. All filesystem detection lives in
 * `scanner.js`, which is pure and independently testable.
 *
 * This is the process entry point referenced by mcp.json.
 *
 * No external dependencies — only Node.js built-ins.
 */

import { scanProject } from "./scanner.js";

/**
 * Protocol versions this server can speak, newest first.
 *
 * MCP requires the server to *negotiate*: if the client's requested version is
 * supported, echo it back; otherwise reply with a version the server does
 * support and let the client decide whether to continue. Replying with a fixed
 * version regardless of the request looks like agreement while actually being a
 * unilateral choice, which is how a client ends up sending messages in a shape
 * the server never agreed to.
 *
 * The wire format has been stable across these revisions for the surface this
 * server uses (initialize, tools/list, tools/call, ping), so supporting all
 * three costs nothing beyond honest advertisement.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Version used when the client doesn't ask for one, or asks for something unknown. */
const PREFERRED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** The oldest version still accepted — kept for clients that never send one. */
const FALLBACK_PROTOCOL_VERSION = "2024-11-05";

const SERVER_NAME = "project-scanner";
const SERVER_VERSION = "1.3.0";

/**
 * Resolve the version to reply with.
 *
 * @param {unknown} requested The client's `params.protocolVersion`, if any.
 * @returns {string} A version this server actually supports.
 */
function negotiateProtocolVersion(requested) {
  // No version sent: older clients omit it. Answer with the conservative one
  // rather than the newest, since a client that didn't ask is unlikely to
  // handle the latest revision.
  if (typeof requested !== "string" || requested.length === 0) {
    return FALLBACK_PROTOCOL_VERSION;
  }
  // Exact support: echo it back. This is the agreement the client asked for.
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  // Unknown version. Offer our newest and let the client decide — per spec it
  // may either proceed on this version or disconnect.
  return PREFERRED_PROTOCOL_VERSION;
}

const TOOLS = [
  {
    name: "get_project_profile",
    description:
      "Scans a project directory and returns detected conventions across every language ecosystem present. Returns `commands` (ready-to-run lint/test/build/format resolved via task-runner target, then package script, then ecosystem default, each with provenance) — read this first instead of assembling a command yourself. Also returns: ecosystems (javascript, python, rust, go, java, ruby, php, dotnet, dart, elixir), package managers per ecosystem (pnpm/yarn/bun/npm, uv/poetry/pdm/pipenv/pip, cargo, go, maven/gradle, bundler, composer, nuget, pub, hex), cross-ecosystem task runners (make/just/task with parsed targets), git hooks (husky, pre-commit, lefthook, overcommit, native), staged-file formatter, linters and formatters per ecosystem (eslint/prettier/biome, ruff/black/mypy/flake8, clippy/rustfmt, golangci-lint/gofmt, ktlint/spotless, rubocop, php-cs-fixer/phpstan, and SDK formatters), frameworks and monorepo tools as ARRAYS since a polyglot repo has several, test runners per ecosystem with invocation commands, VCS host (gitlab/github/bitbucket), the repo's own merge/pull request description template, AI-IDE instruction files with review checklist detection (searches .kiro/steering, .cursor/rules, .clinerules, .trae/rules, .github/instructions, .junie, .augment, AGENTS.md, CLAUDE.md, GEMINI.md, QWEN.md, WARP.md, .windsurfrules, .cursorrules, .github/copilot-instructions.md — with pattern fallback for unknown tools), plus git state and conventions (current branch and its ticket key, default and integration branch, branch naming prefixes, commit message convention, dirty working tree). The singular framework/monorepoTool/testRunner fields are deprecated aliases for the first array entry. Use this before assuming any project-specific command, branch name, commit format, or MR description.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_path: {
          type: "string",
          description: "Absolute path to the project root to scan. Defaults to the server process cwd if omitted.",
        },
        ticket_keys: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional ticket keys (e.g. ["PROJ-716", "PROJ-241"]) to look up against existing branches. Returns git.ticketBranches keyed by ticket, each with exists/local/remote/localOnly/remoteOnly. Pass both the ticket you are starting AND its parent epic: the first tells you whether a branch already exists so you do not create a duplicate, the second tells you whether the epic has a branch to cut from. Matching is exact, so PROJ-24 will not match PROJ-241.',
        },
      },
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }

  // Notifications carry no id and require no response.
  if (typeof method === "string" && method.startsWith("notifications/")) return;

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === "get_project_profile") {
      let profile;
      try {
        profile = scanProject(args.workspace_path, args.ticket_keys);
      } catch (err) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Scan failed: ${err.message}` }],
            isError: true,
          },
        });
        return;
      }
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] },
      });
      return;
    }

    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
    return;
  }

  // Unknown method — only answer if it was a request (has an id)
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore malformed lines
    }
    try {
      handleRequest(msg);
    } catch (err) {
      if (msg?.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: `Internal error: ${err.message}` },
        });
      }
    }
  }
});

process.stdin.on("end", () => process.exit(0));
