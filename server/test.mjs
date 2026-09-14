#!/usr/bin/env node
/**
 * Regression test for the project-scanner MCP server.
 *
 * Builds throwaway fixture directories with known contents, drives the server
 * over real JSON-RPC (initialize + tools/call), and asserts on the returned
 * profile. Because it exercises the actual stdio contract that mcp.json depends
 * on, it stays valid across internal refactors: if the file is split into
 * modules, this test must still pass unchanged.
 *
 * Zero dependencies — Node built-ins only, matching the server itself.
 *
 * Run:  node test.mjs      (or: npm test)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Direct import of the detection layer — no process, no protocol handshake.
// This is only possible because scanner.js is separate from server.js.
import { scanProject, REVIEW_CHECKLIST_DIRS, REVIEW_CHECKLIST_FILES, CHECKLIST_NAME_PATTERNS } from "./scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(__dirname, "server.js");

// ---------- Tiny assertion harness ----------

let passed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n      expected: ${e}\n      actual:   ${a}`);
}

function truthy(label, actual) {
  if (actual) passed++;
  else failures.push(`${label}\n      expected truthy, got: ${JSON.stringify(actual)}`);
}

function falsy(label, actual) {
  if (!actual) passed++;
  else failures.push(`${label}\n      expected falsy, got: ${JSON.stringify(actual)}`);
}

// ---------- Fixture helpers ----------

const tempRoots = [];

function newFixture(name) {
  const dir = mkdtempSync(join(tmpdir(), `scanner-${name}-`));
  tempRoots.push(dir);
  return dir;
}

/** Write a file, creating parent directories as needed. */
function put(root, relPath, content = "") {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function cleanup() {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

// ---------- Server driver ----------

/** Serialize a sequence of JSON-RPC messages into the newline-delimited stdin the server expects. */
function buildJsonRpcInput(messages) {
  return messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
}

/**
 * Parse newline-delimited JSON-RPC messages from server stdout.
 *
 * Blank and non-JSON lines are skipped rather than treated as errors — the
 * server may emit incidental log output alongside protocol messages.
 */
function parseRpcMessages(stdout) {
  const messages = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      /* not a JSON-RPC line — ignore */
    }
  }
  return messages;
}

// Use the absolute path to the running Node binary rather than the bare
// "node" string, so the child process doesn't depend on PATH resolution.
function runServer(input) {
  return execFileSync(process.execPath, [SERVER], { input, encoding: "utf8", timeout: 20000 });
}

function initializeMessage(id = 0) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "regression-test", version: "1.0.0" },
    },
  };
}

/** Pull the tools/call result (id 1) out of a get_project_profile response, or throw. */
function extractProfile(messages) {
  const response = messages.find((msg) => msg.id === 1);
  if (!response) throw new Error("no profile in response");
  if (response.error) throw new Error(`server error: ${JSON.stringify(response.error)}`);

  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error("tools/call response had no content text");
  return JSON.parse(text);
}

/**
 * Spawn the server, perform the MCP handshake, call get_project_profile,
 * and return the parsed profile object.
 */
function scan(workspacePath, ticketKeys) {
  const args = { workspace_path: workspacePath };
  if (ticketKeys) args.ticket_keys = ticketKeys;

  const input = buildJsonRpcInput([
    initializeMessage(0),
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_project_profile", arguments: args },
    },
  ]);

  const messages = parseRpcMessages(runServer(input));
  const sawInitialize = messages.some((msg) => msg.id === 0 && msg.result);
  if (!sawInitialize) throw new Error("no initialize response");

  return extractProfile(messages);
}

/**
 * Send a bare initialize with an arbitrary protocolVersion and return the
 * result object. Used to exercise negotiation, which the `scan` helper can't
 * reach because it always sends one fixed version.
 *
 * Pass `omit` to leave protocolVersion out entirely, as older clients do.
 */
function initialize(requestedVersion) {
  const params = {
    capabilities: {},
    clientInfo: { name: "regression-test", version: "1.0.0" },
  };
  if (requestedVersion !== "omit") params.protocolVersion = requestedVersion;

  const input = buildJsonRpcInput([{ jsonrpc: "2.0", id: 1, method: "initialize", params }]);
  const messages = parseRpcMessages(runServer(input));

  const response = messages.find((msg) => msg.id === 1);
  if (!response) throw new Error("no initialize response");
  if (response.error) throw new Error(`initialize errored: ${JSON.stringify(response.error)}`);
  return response.result;
}

/** Also verify tools/list advertises the tool with snake_case params. */
function listTools() {
  const input = buildJsonRpcInput([initializeMessage(0), { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);

  const messages = parseRpcMessages(runServer(input));
  const response = messages.find((msg) => msg.id === 1 && msg.result);
  if (!response) throw new Error("no tools/list response");
  return response.result.tools;
}

// ---------- The profile contract ----------

// Every key the skills read. A refactor that drops one of these breaks a skill
// silently, so the set is asserted explicitly rather than spot-checked.
const REQUIRED_KEYS = [
  "root",
  "packageManager",
  "gitHooks",
  "stagedFormatter",
  "eslint",
  "framework",
  "monorepoTool",
  "vcs",
  "mrTemplate",
  "reviewChecklist",
  "git",
  "testRunner",
  "scripts",
];

// ---------- Test cases ----------

function testToolSchema() {
  const tools = listTools();
  eq("tools/list returns exactly one tool", tools.length, 1);
  eq("tool is named get_project_profile", tools[0].name, "get_project_profile");

  const props = tools[0].inputSchema?.properties ?? {};
  truthy("schema exposes workspace_path (snake_case)", "workspace_path" in props);
  truthy("schema exposes ticket_keys (snake_case)", "ticket_keys" in props);
  falsy("schema does NOT expose camelCase workspacePath", "workspacePath" in props);
}

/** A realistic monorepo: pnpm + husky + lint-staged + Angular + Nx + Kiro steering. */
function testFullFixture() {
  const root = newFixture("full");

  put(
    root,
    "package.json",
    JSON.stringify({
      name: "fixture-full",
      packageManager: "pnpm@9.1.0",
      scripts: {
        lint: "nx run-many -t lint",
        "lint:web": "nx lint web",
        check: "pnpm lint && pnpm build",
        build: "nx run-many -t build",
        test: "vitest run",
        format: "prettier --write .",
      },
      devDependencies: {
        "@angular/core": "^18.0.0",
        "lint-staged": "^15.2.0",
        eslint: "^9.0.0",
        vitest: "^2.0.0",
      },
    }),
  );
  put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  put(root, ".husky/pre-commit", "pnpm lint-staged\n");
  put(root, ".husky/pre-push", "pnpm run check\n");
  put(root, "angular.json", "{}");
  put(root, "nx.json", "{}");
  put(root, "eslint.config.mjs", "export default [];");
  put(root, ".lintstagedrc.json", '{"*.ts":"prettier --write"}');
  put(root, ".gitlab/merge_request_templates/Default.md", "## Summary\n\n## Testing\n");
  put(root, ".kiro/steering/code-review.md", "---\ninclusion: manual\n---\n\n# Checklist\n\n- Check RTL\n");
  put(root, ".kiro/steering/ui-development.md", "# UI rules\n");

  const p = scan(root);

  for (const k of REQUIRED_KEYS) {
    truthy(`full: profile has "${k}"`, k in p);
  }

  eq("full: packageManager.name", p.packageManager.name, "pnpm");
  eq("full: packageManager.detectedFrom", p.packageManager.detectedFrom, "package.json:packageManager");
  eq("full: packageManager.runCommandPrefix", p.packageManager.runCommandPrefix, "pnpm run");

  eq("full: gitHooks.manager", p.gitHooks.manager, "husky");
  eq("full: gitHooks.hooksDir", p.gitHooks.hooksDir, ".husky");
  eq("full: gitHooks.hasPreCommit", p.gitHooks.hasPreCommit, true);
  eq("full: gitHooks.hasPrePush", p.gitHooks.hasPrePush, true);
  truthy("full: prePushContent is inlined", p.gitHooks.prePushContent?.includes("check"));

  eq("full: stagedFormatter.tool", p.stagedFormatter.tool, "lint-staged");
  eq("full: stagedFormatter.configFile", p.stagedFormatter.configFile, ".lintstagedrc.json");

  eq("full: eslint.format", p.eslint.format, "flat");
  eq("full: eslint.file", p.eslint.file, "eslint.config.mjs");

  eq("full: framework", p.framework, "angular");
  eq("full: monorepoTool", p.monorepoTool, "nx");
  eq("full: testRunner", p.testRunner, "vitest");

  eq("full: mrTemplate.kind", p.mrTemplate.kind, "gitlab-mr");
  eq("full: mrTemplate.defaultFile", p.mrTemplate.defaultFile, "Default.md");
  truthy("full: mrTemplate.content is inlined", p.mrTemplate.content?.includes("Summary"));

  // reviewChecklist tier 1: a review-named file inside a known instruction dir
  eq("full: reviewChecklist.found", p.reviewChecklist.found, true);
  eq("full: reviewChecklist.source", p.reviewChecklist.source, "kiro");
  eq("full: reviewChecklist.dir", p.reviewChecklist.dir, ".kiro/steering");
  eq("full: reviewChecklist.checklistFile", p.reviewChecklist.checklistFile, "code-review.md");
  truthy(
    "full: reviewChecklist.checklistContent is inlined",
    p.reviewChecklist.checklistContent?.includes("Check RTL"),
  );
  eq("full: reviewChecklist.allSources length", p.reviewChecklist.allSources.length, 1);
  eq("full: reviewChecklist.allSources[0].files length", p.reviewChecklist.allSources[0].files.length, 2);

  truthy("full: scripts includes lint", "lint" in p.scripts);
}

/** npm + React, an AGENTS.md that does NOT match review keywords (tier 2). */
function testAgentsMdOnly() {
  const root = newFixture("agents");

  put(
    root,
    "package.json",
    JSON.stringify({
      name: "fixture-agents",
      dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
    }),
  );
  put(root, "package-lock.json", "{}");
  put(root, "AGENTS.md", "# Agent guidance\n\nUse pnpm.\n");

  const p = scan(root);

  eq("agents: packageManager.name", p.packageManager.name, "npm");
  eq("agents: packageManager.detectedFrom", p.packageManager.detectedFrom, "lockfile:package-lock.json");
  eq("agents: packageManager.runCommandPrefix", p.packageManager.runCommandPrefix, "npm run");
  eq("agents: framework", p.framework, "react");
  eq("agents: gitHooks.manager", p.gitHooks.manager, null);
  eq("agents: monorepoTool", p.monorepoTool, null);
  eq("agents: testRunner", p.testRunner, null);
  eq("agents: mrTemplate.kind", p.mrTemplate.kind, null);

  // Instruction file exists, but its name doesn't match a review keyword.
  eq("agents: reviewChecklist.found", p.reviewChecklist.found, true);
  eq("agents: reviewChecklist.source", p.reviewChecklist.source, "agents-md");
  eq("agents: reviewChecklist.checklistFile", p.reviewChecklist.checklistFile, null);
  eq("agents: reviewChecklist.checklistContent", p.reviewChecklist.checklistContent, null);
  eq("agents: allSources length", p.reviewChecklist.allSources.length, 1);
  eq("agents: allSources[0].source", p.reviewChecklist.allSources[0].source, "agents-md");
}

/** Cursor rules dir with a self-review file — a non-Kiro host. */
function testCursorFixture() {
  const root = newFixture("cursor");

  put(root, "package.json", JSON.stringify({ name: "fixture-cursor", devDependencies: { jest: "^29.0.0" } }));
  put(root, "yarn.lock", "");
  put(root, ".cursor/rules/self-review.mdc", "---\nalwaysApply: true\n---\n\nCheck imports\n");
  put(root, ".cursor/rules/style.mdc", "Style rules\n");

  const p = scan(root);

  eq("cursor: packageManager.name", p.packageManager.name, "yarn");
  eq("cursor: packageManager.runCommandPrefix", p.packageManager.runCommandPrefix, "yarn");
  eq("cursor: testRunner", p.testRunner, "jest");

  eq("cursor: reviewChecklist.found", p.reviewChecklist.found, true);
  eq("cursor: reviewChecklist.source", p.reviewChecklist.source, "cursor");
  eq("cursor: reviewChecklist.dir", p.reviewChecklist.dir, ".cursor/rules");
  eq("cursor: reviewChecklist.checklistFile", p.reviewChecklist.checklistFile, "self-review.mdc");
  truthy("cursor: checklistContent inlined from .mdc", p.reviewChecklist.checklistContent?.includes("Check imports"));
}

/** No known instruction location — only a root file matching a review pattern (tier 3). */
function testPatternFallback() {
  const root = newFixture("pattern");

  put(root, "package.json", JSON.stringify({ name: "fixture-pattern" }));
  put(root, "CODE_REVIEW.md", "# Code review checklist\n\n- No console.log\n");

  const p = scan(root);

  eq("pattern: reviewChecklist.found", p.reviewChecklist.found, true);
  eq("pattern: reviewChecklist.source", p.reviewChecklist.source, "pattern-match");
  eq("pattern: reviewChecklist.dir", p.reviewChecklist.dir, ".");
  eq("pattern: reviewChecklist.checklistFile", p.reviewChecklist.checklistFile, "CODE_REVIEW.md");
  truthy("pattern: checklistContent inlined", p.reviewChecklist.checklistContent?.includes("No console.log"));
  eq("pattern: allSources is empty (no known location matched)", p.reviewChecklist.allSources.length, 0);
}

/** Nothing at all — every optional field must degrade to null/false, not throw. */
function testEmptyFixture() {
  const root = newFixture("empty");
  const p = scan(root);

  for (const k of REQUIRED_KEYS) {
    truthy(`empty: profile still has "${k}"`, k in p);
  }

  eq("empty: packageManager.name", p.packageManager.name, null);
  eq("empty: packageManager.runCommandPrefix", p.packageManager.runCommandPrefix, null);
  eq("empty: gitHooks.manager", p.gitHooks.manager, null);
  eq("empty: stagedFormatter.tool", p.stagedFormatter.tool, null);
  eq("empty: eslint.format", p.eslint.format, null);
  eq("empty: framework", p.framework, null);
  eq("empty: monorepoTool", p.monorepoTool, null);
  eq("empty: testRunner", p.testRunner, null);
  eq("empty: mrTemplate.kind", p.mrTemplate.kind, null);

  eq("empty: reviewChecklist.found", p.reviewChecklist.found, false);
  eq("empty: reviewChecklist.source", p.reviewChecklist.source, null);
  eq("empty: reviewChecklist.checklistFile", p.reviewChecklist.checklistFile, null);
  eq("empty: reviewChecklist.allSources", p.reviewChecklist.allSources, []);

  // Not a git repo: git detection must return a shape, not blow up.
  truthy("empty: git object present", typeof p.git === "object" && p.git !== null);
  truthy("empty: git has currentBranch key", "currentBranch" in p.git);
}

/** A bad path must return a structured error rather than crashing the server. */
function testMissingPath() {
  const missing = join(tmpdir(), `scanner-does-not-exist-${Date.now()}`);
  const p = scan(missing);
  truthy("missing path: returns an error field", typeof p.error === "string");
  truthy("missing path: error names the path", p.error?.includes("does not exist"));
}

/** Native git hooks (no husky) resolve to the .git/hooks branch. */
function testNativeHooks() {
  const root = newFixture("native");
  put(root, "package.json", JSON.stringify({ name: "fixture-native" }));
  put(root, ".git/hooks/pre-commit", "#!/bin/sh\necho native\n");

  const p = scan(root);
  eq("native: gitHooks.manager", p.gitHooks.manager, "native-git-hooks");
  eq("native: gitHooks.hooksDir", p.gitHooks.hooksDir, ".git/hooks");
  eq("native: gitHooks.hasPreCommit", p.gitHooks.hasPreCommit, true);
  eq("native: gitHooks.hasPrePush", p.gitHooks.hasPrePush, false);
}

/**
 * The transport and the detection layer must agree.
 *
 * Calls scanProject() directly and compares against the same scan driven over
 * JSON-RPC. If they ever diverge, the protocol layer is mutating the profile —
 * which it has no business doing.
 */
function testDirectImportMatchesTransport() {
  const root = newFixture("direct");
  put(root, "package.json", JSON.stringify({ name: "fixture-direct", devDependencies: { next: "^14.0.0" } }));
  put(root, "pnpm-lock.yaml", "");
  put(root, "next.config.mjs", "export default {};");
  put(root, "CLAUDE.md", "# Guidance\n");
  put(root, ".kiro/steering/pre-push-checklist.md", "- Run tests\n");

  const direct = scanProject(root);
  const viaTransport = scan(root);

  eq("direct: framework detected without a process", direct.framework, "next");
  eq("direct: packageManager detected without a process", direct.packageManager.name, "pnpm");
  eq("direct: checklist found via .kiro/steering", direct.reviewChecklist.checklistFile, "pre-push-checklist.md");

  // The transport must be a pure pass-through of the detection layer.
  eq("direct === transport (whole profile)", direct, viaTransport);
}

// ---------- Lookup-table coverage ----------

/**
 * Every entry in REVIEW_CHECKLIST_DIRS must be reachable.
 *
 * Drives the exported table rather than a hand-written list, so adding a tool
 * to the scanner automatically brings it under test. This proves each entry is
 * *reachable and correctly labelled* — it cannot prove the path string is right,
 * because the fixture is created at whatever path the table says. That job
 * belongs to testDocumentedPathsSpec below.
 */
function testEveryDirLocationReachable() {
  for (const [relDir, kind] of REVIEW_CHECKLIST_DIRS) {
    const root = newFixture("dir");
    put(root, `${relDir}/code-review.md`, "# Checklist\n\n- Something\n");

    const p = scanProject(root);

    eq(`dirs[${relDir}]: found`, p.reviewChecklist.found, true);
    eq(`dirs[${relDir}]: source label`, p.reviewChecklist.source, kind);
    eq(`dirs[${relDir}]: dir`, p.reviewChecklist.dir, relDir);
    eq(`dirs[${relDir}]: checklistFile`, p.reviewChecklist.checklistFile, "code-review.md");
    truthy(`dirs[${relDir}]: content inlined`, p.reviewChecklist.checklistContent?.includes("Something"));
  }
}

/** Every entry in REVIEW_CHECKLIST_FILES must be reachable and reported in allSources. */
function testEveryFileLocationReachable() {
  for (const [relFile, kind] of REVIEW_CHECKLIST_FILES) {
    const root = newFixture("file");
    put(root, relFile, "# Instructions\n");

    const p = scanProject(root);

    eq(`files[${relFile}]: found`, p.reviewChecklist.found, true);
    const labels = p.reviewChecklist.allSources.map((s) => s.source);
    truthy(`files[${relFile}]: allSources includes "${kind}"`, labels.includes(kind));
  }
}

/**
 * The tables must contain the paths each vendor documents.
 *
 * This list is transcribed independently from the vendor docs rather than
 * derived from the scanner, so a typo in the scanner's table fails here. The
 * duplication is deliberate — computing the expected value from the code under
 * test would make the assertion vacuous.
 */
function testDocumentedPathsSpec() {
  const documentedDirs = [
    [".kiro/steering", "kiro"],
    [".cursor/rules", "cursor"],
    [".clinerules", "cline"],
    [".trae/rules", "trae"],
    [".github/instructions", "github-copilot"],
    [".junie", "junie"],
    [".augment", "augment"],
  ];
  const documentedFiles = [
    ["AGENTS.md", "agents-md"],
    ["CLAUDE.md", "claude-code"],
    ["GEMINI.md", "gemini-cli"],
    ["QWEN.md", "qwen-code"],
    ["WARP.md", "warp"],
    [".windsurfrules", "windsurf"],
    [".cursorrules", "cursor-legacy"],
    [".github/copilot-instructions.md", "github-copilot"],
  ];

  const actualDirs = REVIEW_CHECKLIST_DIRS.map(([p, k]) => `${p}=>${k}`).sort((a, b) => a.localeCompare(b));
  const actualFiles = REVIEW_CHECKLIST_FILES.map(([p, k]) => `${p}=>${k}`).sort((a, b) => a.localeCompare(b));

  // Set equality in both directions: a missing entry and a stray one both fail.
  eq(
    "spec: dir table matches documented paths",
    actualDirs,
    documentedDirs.map(([p, k]) => `${p}=>${k}`).sort((a, b) => a.localeCompare(b)),
  );
  eq(
    "spec: file table matches documented paths",
    actualFiles,
    documentedFiles.map(([p, k]) => `${p}=>${k}`).sort((a, b) => a.localeCompare(b)),
  );

  // A path must live in exactly one table, or the same location reports twice.
  const dirPaths = REVIEW_CHECKLIST_DIRS.map(([p]) => p);
  const overlapping = REVIEW_CHECKLIST_FILES.filter(([f]) => dirPaths.some((d) => f.startsWith(`${d}/`)));
  eq("spec: no file entry sits inside a dir entry", overlapping, []);
}

/**
 * Every name pattern must actually fire.
 *
 * Filenames here deliberately exercise the optional-separator branch of each
 * regex (`self_review`, `prepush`) — nothing else in the suite does, so `[_-]?`
 * was previously untested.
 */
function testEveryNamePatternFires() {
  const cases = [
    ["review-notes.md", /review/i],
    ["checklist.md", /checklist/i],
    ["self_review.md", /self[_-]?review/i],
    ["code_review.md", /code[_-]?review/i],
    ["prepush.md", /pre[_-]?push/i],
    ["pre-commit-notes.md", /pre[_-]?commit/i],
  ];

  // Guard: the case list must cover the whole exported pattern list.
  eq("patterns: one fixture per pattern", cases.length, CHECKLIST_NAME_PATTERNS.length);
  for (const [, re] of cases) {
    const known = CHECKLIST_NAME_PATTERNS.some((p) => p.source === re.source && p.flags === re.flags);
    truthy(`patterns: /${re.source}/ is in the exported list`, known);
  }

  for (const [fileName, re] of cases) {
    const root = newFixture("pat");
    put(root, `.kiro/steering/${fileName}`, "content\n");

    const p = scanProject(root);
    eq(`patterns: /${re.source}/ matched via ${fileName}`, p.reviewChecklist.checklistFile, fileName);
  }
}

// ---------- Multi-ecosystem detection ----------

/**
 * Marker files that must make each ecosystem register.
 *
 * Transcribed independently of ECOSYSTEMS for the same reason as the checklist
 * spec: deriving the expectation from the table under test proves nothing.
 */
const ECOSYSTEM_MARKERS = [
  ["javascript", "package.json", "{}"],
  ["python", "pyproject.toml", "[project]\nname = \"x\"\n"],
  ["rust", "Cargo.toml", "[package]\nname = \"x\"\n"],
  ["go", "go.mod", "module example.com/x\n"],
  ["java", "pom.xml", "<project></project>"],
  ["ruby", "Gemfile", "source 'https://rubygems.org'\n"],
  ["php", "composer.json", "{}"],
  ["dart", "pubspec.yaml", "name: x\n"],
  ["elixir", "mix.exs", "defmodule X.MixProject do\nend\n"],
];

function testEveryEcosystemDetected() {
  for (const [id, marker, content] of ECOSYSTEM_MARKERS) {
    const root = newFixture(`eco-${id}`);
    put(root, marker, content);

    const p = scanProject(root);
    const ids = p.ecosystems.map((e) => e.id);
    truthy(`ecosystem[${id}]: detected from ${marker}`, ids.includes(id));
    const entry = p.ecosystems.find((e) => e.id === id);
    eq(`ecosystem[${id}]: records what proved it`, entry?.detectedFrom, marker);
  }

  // .NET is glob-identified rather than fixed-filename, so it needs its own case.
  const root = newFixture("eco-dotnet");
  put(root, "App.csproj", "<Project></Project>");
  const p = scanProject(root);
  truthy("ecosystem[dotnet]: detected from *.csproj", p.ecosystems.map((e) => e.id).includes("dotnet"));
}

/** A polyglot repo must report every ecosystem, not just the first. */
function testPolyglotRepo() {
  const root = newFixture("polyglot");

  // Angular frontend
  put(root, "package.json", JSON.stringify({ name: "front", devDependencies: { "@angular/core": "^18.0.0" } }));
  put(root, "pnpm-lock.yaml", "");
  put(root, "angular.json", "{}");
  put(root, "nx.json", "{}");
  put(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  // FastAPI backend in the same repo
  put(root, "pyproject.toml", "[project]\nname = \"api\"\ndependencies = [\"fastapi\", \"ruff\"]\n");
  put(root, "uv.lock", "");

  const p = scanProject(root);

  const ecoIds = p.ecosystems.map((e) => e.id);
  truthy("polyglot: javascript detected", ecoIds.includes("javascript"));
  truthy("polyglot: python detected", ecoIds.includes("python"));

  // Frameworks must be an array holding both, not one winner.
  truthy("polyglot: frameworks includes angular", p.frameworks.includes("angular"));
  truthy("polyglot: frameworks includes fastapi", p.frameworks.includes("fastapi"));
  truthy("polyglot: frameworks has 2+ entries", p.frameworks.length >= 2);

  // This is the bug the array fixes — the old single field can only hold one.
  eq("polyglot: deprecated framework field is first entry", p.framework, p.frameworks[0]);

  // nx and pnpm-workspaces coexist; the old single field lost the second.
  truthy("polyglot: monorepoTools includes nx", p.monorepoTools.includes("nx"));
  truthy("polyglot: monorepoTools includes pnpm-workspaces", p.monorepoTools.includes("pnpm-workspaces"));

  // One package manager per ecosystem.
  const pmEco = p.packageManagers.map((m) => m.ecosystem);
  truthy("polyglot: packageManagers covers javascript", pmEco.includes("javascript"));
  truthy("polyglot: packageManagers covers python", pmEco.includes("python"));
  eq(
    "polyglot: python manager is uv (from uv.lock)",
    p.packageManagers.find((m) => m.ecosystem === "python")?.name,
    "uv"
  );
  eq(
    "polyglot: js manager is pnpm (from pnpm-lock.yaml)",
    p.packageManagers.find((m) => m.ecosystem === "javascript")?.name,
    "pnpm"
  );
}

/** Package manager resolution per ecosystem, driven by lockfile. */
function testPackageManagersPerEcosystem() {
  const cases = [
    ["python", "pyproject.toml", "[project]\n", "uv.lock", "uv", "uv run"],
    ["python", "pyproject.toml", "[project]\n", "poetry.lock", "poetry", "poetry run"],
    ["python", "pyproject.toml", "[project]\n", "pdm.lock", "pdm", "pdm run"],
    ["python", "Pipfile", "[packages]\n", "Pipfile.lock", "pipenv", "pipenv run"],
    ["rust", "Cargo.toml", "[package]\n", "Cargo.lock", "cargo", null],
    ["go", "go.mod", "module x\n", "go.sum", "go", null],
    ["ruby", "Gemfile", "source 'x'\n", "Gemfile.lock", "bundler", "bundle exec"],
    ["php", "composer.json", "{}", "composer.lock", "composer", "composer run-script"],
    ["dart", "pubspec.yaml", "name: x\n", "pubspec.lock", "pub", "dart run"],
    ["elixir", "mix.exs", "defmodule X do end\n", "mix.lock", "hex", "mix"],
  ];

  for (const [eco, marker, markerBody, lockfile, expectedName, expectedPrefix] of cases) {
    const root = newFixture(`pm-${expectedName}`);
    put(root, marker, markerBody);
    put(root, lockfile, "");

    const p = scanProject(root);
    const m = p.packageManagers.find((x) => x.ecosystem === eco);
    eq(`pm[${expectedName}]: name from ${lockfile}`, m?.name, expectedName);
    eq(`pm[${expectedName}]: source records the lockfile`, m?.source, `lockfile:${lockfile}`);
    eq(`pm[${expectedName}]: runPrefix`, m?.runPrefix ?? null, expectedPrefix);
  }

  // Maven vs Gradle are told apart by which build file exists.
  const mvn = newFixture("pm-maven");
  put(mvn, "pom.xml", "<project></project>");
  eq(
    "pm[maven]: pom.xml means maven",
    scanProject(mvn).packageManagers.find((m) => m.ecosystem === "java")?.name,
    "maven"
  );

  const gradle = newFixture("pm-gradle");
  put(gradle, "build.gradle.kts", "plugins {}\n");
  eq(
    "pm[gradle]: build.gradle.kts means gradle",
    scanProject(gradle).packageManagers.find((m) => m.ecosystem === "java")?.name,
    "gradle"
  );
}

/** Test runner resolution per ecosystem. */
function testTestRunnersPerEcosystem() {
  const cases = [
    ["python", { "pyproject.toml": "[project]\ndependencies = [\"pytest\"]\n" }, "pytest", "pytest"],
    ["rust", { "Cargo.toml": "[package]\n" }, "cargo-test", "cargo test"],
    ["go", { "go.mod": "module x\n" }, "go-test", "go test ./..."],
    ["java", { "pom.xml": "<project></project>" }, "maven-surefire", "mvn test"],
    ["java", { "build.gradle": "plugins {}\n" }, "gradle-test", "gradle test"],
    ["ruby", { Gemfile: "gem 'rspec'\n" }, "rspec", "bundle exec rspec"],
    ["php", { "composer.json": "{}" }, "phpunit", "vendor/bin/phpunit"],
    ["dart", { "pubspec.yaml": "name: x\ndependencies:\n  flutter:\n" }, "flutter-test", "flutter test"],
    ["elixir", { "mix.exs": "defmodule X do end\n" }, "mix-test", "mix test"],
  ];

  for (const [eco, files, expectedTool, expectedCmd] of cases) {
    const root = newFixture(`tr-${expectedTool}`);
    for (const [f, body] of Object.entries(files)) put(root, f, body);

    const p = scanProject(root);
    const r = p.testRunners.find((x) => x.ecosystem === eco);
    eq(`testRunner[${expectedTool}]: tool`, r?.tool, expectedTool);
    eq(`testRunner[${expectedTool}]: command`, r?.command, expectedCmd);
  }
}

/** Linter detection per ecosystem. */
function testLintersPerEcosystem() {
  const root = newFixture("linters");
  put(root, "pyproject.toml", "[tool.ruff]\n[tool.black]\n[tool.mypy]\n");
  put(root, "Cargo.toml", "[package]\n");
  put(root, "go.mod", "module x\n");
  put(root, ".golangci.yml", "linters:\n");
  put(root, "Gemfile", "gem 'rubocop'\n");
  put(root, ".rubocop.yml", "");

  const p = scanProject(root);
  const tools = p.linters.map((l) => l.tool);

  for (const expected of ["ruff", "black", "mypy", "clippy", "rustfmt", "golangci-lint", "gofmt", "rubocop"]) {
    truthy(`linters: ${expected} detected`, tools.includes(expected));
  }
  // Every entry must say where it came from — a bare tool name isn't actionable.
  truthy(
    "linters: every entry records detectedFrom",
    p.linters.every((l) => typeof l.detectedFrom === "string" && l.detectedFrom.length > 0)
  );
  truthy(
    "linters: every entry records its ecosystem",
    p.linters.every((l) => typeof l.ecosystem === "string")
  );
}

// ---------- Task runners and command resolution ----------

function testTaskRunnerParsing() {
  // Makefile: real targets only — no pattern rules, no variable assignments.
  const mk = newFixture("make");
  put(
    mk,
    "Makefile",
    [
      "CC := gcc",
      "VERSION = 1.0",
      ".PHONY: lint test",
      "",
      "lint:",
      "\truff check .",
      "test:",
      "\tpytest",
      "build-all:",
      "\techo building",
      "%.o: %.c",
      "\t$(CC) -c $<",
    ].join("\n")
  );
  const mkRunner = scanProject(mk).taskRunners.find((r) => r.tool === "make");
  eq("make: file", mkRunner?.file, "Makefile");
  eq("make: invoke", mkRunner?.invoke, "make");
  truthy("make: lint target found", mkRunner?.targets.includes("lint"));
  truthy("make: test target found", mkRunner?.targets.includes("test"));
  truthy("make: hyphenated target found", mkRunner?.targets.includes("build-all"));
  falsy("make: variable assignment not a target (CC)", mkRunner?.targets.includes("CC"));
  falsy("make: variable assignment not a target (VERSION)", mkRunner?.targets.includes("VERSION"));
  falsy("make: pattern rule not a target", mkRunner?.targets.some((t) => t.includes("%")));

  // justfile: recipes may take arguments before the colon.
  const just = newFixture("just");
  put(just, "justfile", ["lint:", "    ruff check .", "test filter='':", "    pytest {{filter}}", ""].join("\n"));
  const justRunner = scanProject(just).taskRunners.find((r) => r.tool === "just");
  eq("just: invoke", justRunner?.invoke, "just");
  truthy("just: plain recipe found", justRunner?.targets.includes("lint"));
  truthy("just: recipe with args found", justRunner?.targets.includes("test"));

  // Taskfile: two-space keys under `tasks:`, stopping at dedent.
  const task = newFixture("task");
  put(
    task,
    "Taskfile.yml",
    ["version: '3'", "", "tasks:", "  lint:", "    cmds:", "      - ruff check .", "  test:", "    cmds:", "      - pytest", "", "vars:", "  FOO: bar"].join("\n")
  );
  const taskRunner = scanProject(task).taskRunners.find((r) => r.tool === "task");
  eq("task: invoke", taskRunner?.invoke, "task");
  truthy("task: lint found", taskRunner?.targets.includes("lint"));
  truthy("task: test found", taskRunner?.targets.includes("test"));
  falsy("task: stops at dedent (vars not a task)", taskRunner?.targets.includes("FOO"));
}

/**
 * Command resolution precedence.
 *
 * The ordering claim is the thing worth testing: a repo's own task runner must
 * beat a package script, which must beat an ecosystem default. Get this backwards
 * and the scanner starts overriding team conventions with generic guesses.
 */
function testCommandPrecedence() {
  // Tier 1 — task runner wins over an equally-named package script.
  const both = newFixture("cmd-both");
  put(both, "package.json", JSON.stringify({ name: "x", scripts: { lint: "eslint ." } }));
  put(both, "pnpm-lock.yaml", "");
  put(both, "Makefile", "lint:\n\tmake-lint-ran\n");
  const bothCmds = scanProject(both).commands;
  eq("precedence: Makefile beats package script", bothCmds.lint.command, "make lint");
  eq("precedence: source names the Makefile target", bothCmds.lint.source, "Makefile:lint");

  // Tier 2 — package script when no task runner target exists.
  const scriptOnly = newFixture("cmd-script");
  put(scriptOnly, "package.json", JSON.stringify({ name: "x", scripts: { lint: "eslint ." } }));
  put(scriptOnly, "pnpm-lock.yaml", "");
  const scriptCmds = scanProject(scriptOnly).commands;
  eq("precedence: falls to package script", scriptCmds.lint.command, "pnpm run lint");
  eq("precedence: source names the script", scriptCmds.lint.source, "package.json:scripts.lint");

  // Tier 3 — ecosystem default when neither exists.
  const ecoOnly = newFixture("cmd-eco");
  put(ecoOnly, "pyproject.toml", "[tool.ruff]\n");
  const ecoCmds = scanProject(ecoOnly).commands;
  eq("precedence: falls to ecosystem default", ecoCmds.lint.command, "ruff check .");
  truthy("precedence: source names the tool", ecoCmds.lint.source?.includes("ruff"));

  // Nothing at all resolves to null — a legitimate answer the skills handle.
  const bare = newFixture("cmd-bare");
  put(bare, "README.md", "# nothing here\n");
  const bareCmds = scanProject(bare).commands;
  eq("precedence: no lint command found → null", bareCmds.lint, null);
  eq("precedence: no test command found → null", bareCmds.test, null);
}

/** Commands must resolve on a repo the scanner knows no linters for. */
function testCommandsWorkOnUnknownStack() {
  const root = newFixture("cmd-unknown");
  // A C++ project: no ecosystem entry, no linter knowledge — only a Makefile.
  put(root, "CMakeLists.txt", "project(x)\n");
  put(root, "Makefile", ["lint:", "\tclang-tidy src/*.cpp", "test:", "\tctest", "build:", "\tcmake --build ."].join("\n"));

  const p = scanProject(root);
  eq("unknown stack: ecosystems is empty", p.ecosystems, []);
  // This is the whole point of Phase 1 — commands still resolve.
  eq("unknown stack: lint resolves via Makefile", p.commands.lint.command, "make lint");
  eq("unknown stack: test resolves via Makefile", p.commands.test.command, "make test");
  eq("unknown stack: build resolves via Makefile", p.commands.build.command, "make build");
}

/** Declarative hook managers (pre-commit, lefthook) must be recognised. */
function testDeclarativeHookManagers() {
  const preCommit = newFixture("hooks-precommit");
  put(preCommit, "pyproject.toml", "[project]\n");
  put(
    preCommit,
    ".pre-commit-config.yaml",
    ["repos:", "  - repo: https://github.com/astral-sh/ruff-pre-commit", "    hooks:", "      - id: ruff"].join("\n")
  );
  const pc = scanProject(preCommit).gitHooks;
  eq("hooks: pre-commit manager detected", pc.manager, "pre-commit");
  eq("hooks: configFile recorded", pc.configFile, ".pre-commit-config.yaml");
  eq("hooks: flagged declarative", pc.declarative, true);
  truthy("hooks: content inlined", pc.preCommitContent?.includes("ruff"));
  eq("hooks: hasPreCommit true", pc.hasPreCommit, true);

  const lefthook = newFixture("hooks-lefthook");
  put(lefthook, "lefthook.yml", "pre-commit:\n  commands:\n    lint:\n      run: golangci-lint run\n");
  const lh = scanProject(lefthook).gitHooks;
  eq("hooks: lefthook manager detected", lh.manager, "lefthook");
  eq("hooks: lefthook flagged declarative", lh.declarative, true);

  // husky must still win when both exist — it ships executable scripts.
  const both = newFixture("hooks-both");
  put(both, ".husky/pre-commit", "pnpm lint-staged\n");
  put(both, ".pre-commit-config.yaml", "repos: []\n");
  eq("hooks: husky takes precedence over declarative config", scanProject(both).gitHooks.manager, "husky");
  eq("hooks: husky is not declarative", scanProject(both).gitHooks.declarative, false);
}

// ---------- Protocol version negotiation ----------

/**
 * MCP requires the server to negotiate rather than dictate.
 *
 * The regression this guards: replying with a hardcoded version regardless of
 * the request, which reads as agreement but is a unilateral choice.
 */
function testProtocolNegotiation() {
  // Every advertised version must be echoed back verbatim.
  const supported = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
  for (const v of supported) {
    const result = initialize(v);
    eq(`negotiate: ${v} is echoed back`, result.protocolVersion, v);
  }

  // A version the server doesn't know must NOT be echoed — that would claim
  // support it doesn't have. It must answer with something it can actually speak.
  const future = initialize("2099-01-01");
  truthy("negotiate: unknown future version is not echoed back", future.protocolVersion !== "2099-01-01");
  truthy("negotiate: unknown version falls back to a supported one", supported.has(future.protocolVersion));

  const garbage = initialize("not-a-version");
  truthy("negotiate: malformed version falls back to a supported one", supported.has(garbage.protocolVersion));

  // Clients that omit the field entirely still get a usable handshake.
  const omitted = initialize("omit");
  truthy("negotiate: omitted version falls back to a supported one", supported.has(omitted.protocolVersion));

  // Shape of the handshake must survive negotiation.
  const r = initialize("2025-06-18");
  truthy("negotiate: capabilities.tools present", r.capabilities?.tools !== undefined);
  eq("negotiate: serverInfo.name", r.serverInfo?.name, "project-scanner");
  truthy("negotiate: serverInfo.version is semver", /^\d+\.\d+\.\d+/.test(r.serverInfo?.version ?? ""));
}

/** The server version in the handshake must match server/package.json. */
function testServerVersionMatchesPackage() {
  const { json: pkg } = readServerJson("package.json");
  const r = initialize("2025-06-18");
  eq("serverInfo.version matches package.json", r.serverInfo?.version, pkg.version);
}

// ---------- Agent Plugins manifest conformance ----------

/**
 * Agent Plugins 1.0.0 manifest constraints, transcribed from the published
 * schemas at https://agent-plugins.org/schemas/1.0.0/.
 *
 * Held locally rather than fetched: a test that needs the network fails
 * offline and in CI sandboxes, and the whole point of this suite is that an
 * invalid manifest fails like a broken test. The version in `$schema` is
 * asserted below, so if the plugin ever targets a newer spec these constants
 * have to be revisited deliberately instead of silently going stale.
 */
const AGENT_PLUGINS_VERSION = "1.0.0";

const PLUGIN_SCHEMA = {
  url: `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`,
  required: ["$schema", "name"],
  // additionalProperties: false — anything outside this list is a hard error.
  allowed: [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ],
};

const MCP_SCHEMA = {
  url: `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`,
  required: ["$schema", "mcpServers"],
  allowed: ["$schema", "mcpServers"],
};

/** Read a JSON file from the plugin root (one level above server/). */
function readPluginJson(relPath) {
  const abs = resolve(__dirname, "..", relPath);
  return { abs, json: JSON.parse(readFileSync(abs, "utf8")) };
}

/** Read a JSON file from the server/ directory itself. */
function readServerJson(relPath) {
  const abs = resolve(__dirname, relPath);
  return { abs, json: JSON.parse(readFileSync(abs, "utf8")) };
}

function assertManifest(label, relPath, schema) {
  let json;
  try {
    ({ json } = readPluginJson(relPath));
  } catch (err) {
    failures.push(`${label}: could not read ${relPath} — ${err.message}`);
    return null;
  }

  const keys = Object.keys(json);

  // additionalProperties: false. A typo'd key is the failure mode this catches —
  // it would otherwise be silently ignored by a lenient client and dropped by a
  // strict one, with no signal either way.
  const illegal = keys.filter((k) => !schema.allowed.includes(k));
  eq(`${label}: no keys outside the spec`, illegal, []);

  const missing = schema.required.filter((k) => !keys.includes(k));
  eq(`${label}: all required keys present`, missing, []);

  eq(`${label}: $schema points at the expected spec version`, json.$schema, schema.url);

  return json;
}

function testManifestConformance() {
  const plugin = assertManifest("plugin.json", "plugin.json", PLUGIN_SCHEMA);
  const mcp = assertManifest("mcp.json", "mcp.json", MCP_SCHEMA);
  if (!plugin || !mcp) return;

  // --- plugin.json semantics beyond raw key validity ---
  truthy("plugin.json: name is a non-empty string", typeof plugin.name === "string" && plugin.name.length > 0);
  truthy("plugin.json: name is lowercase-hyphen (portable across clients)", /^[a-z0-9][a-z0-9-]*$/.test(plugin.name));
  truthy("plugin.json: version is semver", /^\d+\.\d+\.\d+/.test(plugin.version ?? ""));

  // --- mcp.json semantics ---
  const servers = Object.entries(mcp.mcpServers ?? {});
  truthy("mcp.json: declares at least one server", servers.length > 0);

  for (const [name, cfg] of servers) {
    truthy(`mcp.json[${name}]: has a transport type`, typeof cfg.type === "string");
    truthy(`mcp.json[${name}]: transport is a spec-recognised value`, ["stdio", "http", "sse"].includes(cfg.type));
    if (cfg.type === "stdio") {
      truthy(`mcp.json[${name}]: stdio server declares a command`, typeof cfg.command === "string");
      truthy(`mcp.json[${name}]: stdio server declares args`, Array.isArray(cfg.args));
      // Portability: an absolute or relative path breaks on another machine.
      const usesPluginRoot = (cfg.args ?? []).some((a) => String(a).includes("${PLUGIN_ROOT}"));
      truthy(`mcp.json[${name}]: paths go through \${PLUGIN_ROOT}`, usesPluginRoot);
    }
  }
}

/** Pull the keyword flow-sequence out of a POWER.md frontmatter block. */
function powerKeywords(text) {
  const m = text.match(/^keywords:\s*\[([\s\S]*?)\]/m);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * POWER.md's frontmatter and plugin.json each carry a keyword list, by hand,
 * describing the same thing. Two hand-maintained copies of one fact drift: a
 * keyword edited in one file and not the other changes activation behaviour
 * without failing anything. Observed — plugin.json carried seven keywords
 * POWER.md never listed, including a punctuation variant cleaned out of one
 * file only.
 */
function testKeywordParity() {
  const pluginRoot = resolve(__dirname, "..");
  const power = readFileSync(join(pluginRoot, "POWER.md"), "utf8");
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "plugin.json"), "utf8")).keywords;
  const declared = powerKeywords(power);

  truthy("keywords: POWER.md declares a keyword list", Array.isArray(declared) && declared.length > 0);
  truthy("keywords: plugin.json declares a keyword list", Array.isArray(manifest) && manifest.length > 0);
  if (!declared || !manifest) return;

  eq("keywords: POWER.md and plugin.json list the same keywords", [...declared].sort(), [...manifest].sort());
  eq("keywords: POWER.md has no duplicates", declared.length, new Set(declared).size);
  eq("keywords: plugin.json has no duplicates", manifest.length, new Set(manifest).size);
}

/** Every path mcp.json points at must actually exist in the package. */
function testMcpEntryPointsExist() {
  const { json: mcp } = readPluginJson("mcp.json");
  const pluginRoot = resolve(__dirname, "..");

  for (const [name, cfg] of Object.entries(mcp.mcpServers ?? {})) {
    for (const arg of cfg.args ?? []) {
      const raw = String(arg);
      if (!raw.includes("${PLUGIN_ROOT}")) continue;
      const resolved = raw.replace("${PLUGIN_ROOT}", pluginRoot).replaceAll("/", sep);
      truthy(`mcp.json[${name}]: entry point exists → ${raw}`, existsSync(resolved));
    }
  }
}

/**
 * Agent Skills frontmatter constraints.
 *
 * The Agent Plugins spec delegates `skills/` to the Agent Skills specification,
 * which requires exactly two fields and constrains both. These are the rules
 * that break distribution silently if violated — a name that doesn't match its
 * directory, or a description over the limit, gets rejected at install time on a
 * client that validates and quietly ignored on one that doesn't.
 */
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
// Lowercase alphanumeric segments joined by single hyphens. This one pattern
// covers every naming rule at once: no uppercase, no underscores, no leading or
// trailing hyphen, no consecutive hyphens.
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Parse the YAML frontmatter block of a SKILL.md into a flat key/value map. */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;

  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return null;

  const fields = {};
  let currentKey = null;
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/);
    if (m) {
      currentKey = m[1];
      fields[currentKey] = m[2];
    } else if (currentKey && /^\s+\S/.test(line)) {
      // Folded continuation of the previous value.
      fields[currentKey] += ` ${line.trim()}`;
    }
  }
  return fields;
}

function testSkillFrontmatterConformance() {
  const skillsDir = resolve(__dirname, "..", "skills");
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  truthy("skills: at least one skill to validate", dirs.length > 0);

  for (const d of dirs) {
    const label = `skill[${d.name}]`;
    const file = join(skillsDir, d.name, "SKILL.md");

    if (!existsSync(file)) {
      failures.push(`${label}: SKILL.md missing`);
      continue;
    }

    const fm = parseFrontmatter(readFileSync(file, "utf8"));
    if (!fm) {
      failures.push(`${label}: no parseable YAML frontmatter`);
      continue;
    }

    // --- name ---
    truthy(`${label}: has name`, typeof fm.name === "string" && fm.name.length > 0);
    // The spec requires an exact match with the containing directory. Get this
    // wrong and the client cannot resolve the skill it just loaded.
    eq(`${label}: name matches its directory`, fm.name, d.name);
    truthy(`${label}: name is lowercase-hyphen only`, SKILL_NAME_PATTERN.test(fm.name ?? ""));
    truthy(`${label}: name within ${SKILL_NAME_MAX} chars`, (fm.name ?? "").length <= SKILL_NAME_MAX);

    // --- description ---
    truthy(`${label}: has description`, typeof fm.description === "string" && fm.description.length > 0);
    const desc = fm.description ?? "";
    truthy(
      `${label}: description within ${SKILL_DESCRIPTION_MAX} chars (is ${desc.length})`,
      desc.length <= SKILL_DESCRIPTION_MAX
    );
    // The description is what the agent uses to decide relevance, so it has to
    // state trigger conditions and not just capability.
    truthy(
      `${label}: description states when to use it`,
      /\b(use when|activate|use before|use this)\b/i.test(desc)
    );
  }
}

/** The declared plugin layout must match what Agent Plugins expects. */
function testPluginLayout() {
  const pluginRoot = resolve(__dirname, "..");

  truthy("layout: plugin.json at package root", existsSync(join(pluginRoot, "plugin.json")));
  truthy("layout: mcp.json at package root", existsSync(join(pluginRoot, "mcp.json")));
  truthy("layout: skills/ directory present", existsSync(join(pluginRoot, "skills")));

  // Spec layout is skills/<name>/SKILL.md — a skill folder without one is invisible.
  const skillsDir = join(pluginRoot, "skills");
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  truthy("layout: at least one skill", entries.length > 0);
  for (const d of entries) {
    truthy(`layout: skills/${d.name}/SKILL.md exists`, existsSync(join(skillsDir, d.name, "SKILL.md")));
  }
}

/** A location must never be reported twice in allSources. */
function testNoDuplicateSources() {
  const root = newFixture("dupes");
  // Populate every known location at once — the worst case for double-reporting.
  for (const [relDir] of REVIEW_CHECKLIST_DIRS) put(root, `${relDir}/notes.md`, "x\n");
  for (const [relFile] of REVIEW_CHECKLIST_FILES) put(root, relFile, "x\n");

  const p = scanProject(root);
  const keys = p.reviewChecklist.allSources.map((s) => `${s.source}@${s.dir}`);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);

  eq("no duplicate source@dir in allSources", dupes, []);
  eq(
    "allSources covers every known location",
    p.reviewChecklist.allSources.length,
    REVIEW_CHECKLIST_DIRS.length + REVIEW_CHECKLIST_FILES.length,
  );
}

function testWorkflowPolicyContracts() {
  const skills = resolve(__dirname, "..", "skills");
  const start = readFileSync(join(skills, "new-ticket", "SKILL.md"), "utf8");
  const close = readFileSync(join(skills, "close-ticket", "SKILL.md"), "utf8");

  for (const phrase of [
    "fields: [\"*all\"]",
    "Original estimate",
    "merge --ff-only",
    "Required validation evidence",
    "Assignment is an explicit action",
    "Assignment consent",
    "Epic Link",
    "Stay here and end ticket setup",
    "one Jira ticket per branch",
    // Transition safety must be a positive test. A denylist of forbidden
    // to.name values invites "not on the list ⇒ safe", which on a board with
    // Cancelled/Archived/Released protects nothing — and the wrong pick here
    // writes a destructive change to a real ticket.
    "The safe test is a positive one",
    "not a safe-list in disguise",
    "When nothing reachable is unambiguously active",
  ]) truthy(`new-ticket: policy contains ${phrase}`, start.includes(phrase));

  for (const phrase of [
    "authoritative `{TARGET}`",
    "git fetch origin {TARGET}",
    "git diff origin/{TARGET}...HEAD",
    "2.2.1 — Run validation before the approval gate",
    "loop back through the definitive staged review",
    "Never write or disclose it",
    "Never re-default to `git.integrationBranch`",
    "treat the names here as examples, not boundaries",
    "absence from that list is never evidence it's safe",
  ]) truthy(`close-ticket: policy contains ${phrase}`, close.includes(phrase));

  falsy("new-ticket: estimate is not mislabeled as logged", start.includes("5h already logged"));
  falsy("new-ticket: dirty work cannot ride through checkout", start.includes("**Leave them**"));
  falsy("new-ticket: stale BASE alias removed", start.includes("`{BASE}`"));
  falsy("new-ticket: multi-ticket branches are not advertised", start.includes("Multiple related fixes"));
  falsy("close-ticket: no MR disclosure for no-verify", close.includes("say plainly in the MR description"));
  falsy(
    "new-ticket: transition safety is not a bare denylist",
    start.includes("select a transition whose `to.name` is `Merged`"),
  );
  falsy(
    "close-ticket: transition safety is not a bare denylist",
    close.includes("choose a transition targeting `Merged`, `Rejected`, `Closed` or `Done` unless"),
  );

  const validation = close.indexOf("### 2.2.1 — Run validation before the approval gate");
  const stagedReview = close.indexOf("### 2.3 — Stage first");
  const commit = close.indexOf("## Step 3 — Commit");
  truthy("close-ticket: validate before staged approval", validation >= 0 && validation < stagedReview);
  truthy("close-ticket: staged approval before commit", stagedReview >= 0 && stagedReview < commit);
}

// ---------- Runner ----------

const suites = [
  ["workflow policy contracts", testWorkflowPolicyContracts],
  ["tool schema", testToolSchema],
  ["full monorepo fixture", testFullFixture],
  ["AGENTS.md only (tier 2)", testAgentsMdOnly],
  ["cursor rules (non-Kiro host)", testCursorFixture],
  ["pattern fallback (tier 3)", testPatternFallback],
  ["empty directory", testEmptyFixture],
  ["missing path", testMissingPath],
  ["native git hooks", testNativeHooks],
  ["direct import matches transport", testDirectImportMatchesTransport],
  ["every dir location reachable", testEveryDirLocationReachable],
  ["every file location reachable", testEveryFileLocationReachable],
  ["documented paths spec", testDocumentedPathsSpec],
  ["every name pattern fires", testEveryNamePatternFires],
  ["no duplicate sources", testNoDuplicateSources],
  ["Agent Plugins manifest conformance", testManifestConformance],
  ["keyword parity", testKeywordParity],
  ["mcp.json entry points exist", testMcpEntryPointsExist],
  ["plugin layout", testPluginLayout],
  ["Agent Skills frontmatter conformance", testSkillFrontmatterConformance],
  ["protocol version negotiation", testProtocolNegotiation],
  ["serverInfo.version matches package.json", testServerVersionMatchesPackage],
  ["every ecosystem detected", testEveryEcosystemDetected],
  ["polyglot repo", testPolyglotRepo],
  ["package managers per ecosystem", testPackageManagersPerEcosystem],
  ["test runners per ecosystem", testTestRunnersPerEcosystem],
  ["linters per ecosystem", testLintersPerEcosystem],
  ["task runner parsing", testTaskRunnerParsing],
  ["command precedence", testCommandPrecedence],
  ["commands work on unknown stack", testCommandsWorkOnUnknownStack],
  ["declarative hook managers", testDeclarativeHookManagers],
];

let crashed = 0;

for (const [name, fn] of suites) {
  try {
    fn();
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    crashed++;
    process.stdout.write(`  CRASH ${name}: ${err.message}\n`);
  }
}

cleanup();

const failedCount = failures.length + crashed;

process.stdout.write(`\n${passed} assertions passed, ${failures.length} failed`);
process.stdout.write(crashed ? `, ${crashed} suite(s) crashed\n` : "\n");

if (failures.length) {
  process.stdout.write("\nFailures:\n");
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
}

process.exit(failedCount > 0 ? 1 : 0);
