/**
 * project-scanner — detection layer
 *
 * Scans a project's filesystem to detect real, project-specific conventions
 * (package manager, git hooks, linter, framework, monorepo tool, VCS host,
 * review checklist location, git branch/commit conventions) so that generic
 * skills can adapt instead of hardcoding assumptions.
 *
 * Pure logic, no transport: every function here takes a path and returns plain
 * data. `server.js` owns the MCP/JSON-RPC layer and is the process entry point.
 * Keeping them separate means this file can be imported and asserted on directly
 * (see test.mjs) without spawning a process or performing a protocol handshake.
 *
 * No external dependencies — only Node.js built-ins.
 */

import { accessSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const GIT_TIMEOUT_MS = 5000;

// Matches a Jira-style ticket key: PROJ-1234
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+)-(\d+)\b/;
// Matches a conventional-commit subject: type(scope)!: description
// Captures only what callers use: 1 = type, 2 = scope.
// `\s+\S` (disjoint classes) replaces the old `\s+(.+)$`, where `\s` and `.`
// overlapped and let the engine re-split a whitespace run many ways on failure.
const CONVENTIONAL_RE = /^([a-z]+)(?:\(([^)]*)\))?!?:\s+\S/;

// ---------- Filesystem helpers ----------

function exists(p) {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readFileSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function readJsonSafe(p) {
  const raw = readFileSafe(p);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstExisting(root, candidates) {
  for (const c of candidates) {
    if (exists(join(root, c))) return c;
  }
  return null;
}

// ---------- Package manager / tooling detection ----------

/**
 * How to invoke a named script for each package manager.
 *
 * `null` means the manager has no script-running concept — `cargo`, `go` and
 * `dotnet` expose fixed subcommands (`cargo test`) rather than user-defined
 * scripts, so callers must use `commands` instead of building `prefix + name`.
 * Returning null rather than a guess keeps that distinction visible.
 */
const RUN_PREFIXES = {
  pnpm: "pnpm run",
  yarn: "yarn",
  bun: "bun run",
  npm: "npm run",
  uv: "uv run",
  poetry: "poetry run",
  pdm: "pdm run",
  pipenv: "pipenv run",
  pip: null,
  cargo: null,
  go: null,
  maven: null,
  gradle: null,
  bundler: "bundle exec",
  composer: "composer run-script",
  nuget: null,
  pub: "dart run",
  hex: "mix",
};

export function runCommandPrefix(managerName) {
  return RUN_PREFIXES[managerName] ?? null;
}

/**
 * Package managers in use, one per ecosystem present.
 *
 * An array because a polyglot repo genuinely has several: pnpm for the
 * frontend, uv for the Python service. Each entry records what proved it, so a
 * caller can tell a lockfile-backed answer from a weaker marker-only guess.
 */
/**
 * JavaScript package manager: an explicit `packageManager` field wins over
 * lockfile inference, which in turn wins over the npm-compatible default.
 */
function detectJsPackageManager(root, pkgJson) {
  if (pkgJson && typeof pkgJson.packageManager === "string") {
    const m = pkgJson.packageManager.match(/^([a-z]+)@/i);
    if (m) return { name: m[1].toLowerCase(), source: "package.json:packageManager" };
  }

  const eco = ECOSYSTEMS.find((e) => e.id === "javascript");
  for (const [file, manager] of eco.lockfiles) {
    if (exists(join(root, file))) return { name: manager, source: `lockfile:${file}` };
  }

  // package.json with no lockfile and no field still means npm-compatible.
  return { name: "npm", source: "package.json" };
}

// Fallback manager per ecosystem when no lockfile is present, used only when
// the marker alone (e.g. Cargo.toml, go.mod) is what proved the ecosystem.
const MARKER_DEFAULT_MANAGERS = {
  python: "pip",
  rust: "cargo",
  go: "go",
  ruby: "bundler",
  php: "composer",
  dotnet: "nuget",
  dart: "pub",
  elixir: "hex",
};

/**
 * Non-JS package manager for one ecosystem: lockfile first, then a
 * marker-based fallback (Gradle/Maven are disambiguated by which build file
 * exists; everything else uses MARKER_DEFAULT_MANAGERS).
 */
function detectEcosystemPackageManager(root, eco, marker) {
  for (const [file, manager] of eco.lockfiles) {
    if (exists(join(root, file))) return { name: manager, source: `lockfile:${file}` };
  }

  if (eco.id === "java") {
    const name = marker === "pom.xml" ? "maven" : "gradle";
    return { name, source: marker };
  }

  return { name: MARKER_DEFAULT_MANAGERS[eco.id] ?? null, source: marker ?? "*.csproj|*.sln" };
}

export function detectPackageManagers(root, pkgJson) {
  const managers = [];

  if (exists(join(root, "package.json"))) {
    const js = detectJsPackageManager(root, pkgJson);
    managers.push({ ecosystem: "javascript", ...js, runPrefix: runCommandPrefix(js.name) });
  }

  // --- Everything else: lockfile first, then fall back to the marker ---
  for (const eco of ECOSYSTEMS) {
    if (eco.id === "javascript") continue;

    const marker = eco.markers.find((m) => exists(join(root, m)));
    const isDotnet = eco.id === "dotnet" && hasFileMatching(root, /\.(csproj|fsproj|vbproj|sln)$/i);
    if (!marker && !isDotnet) continue;

    const hit = detectEcosystemPackageManager(root, eco, marker);
    if (hit?.name) {
      managers.push({ ecosystem: eco.id, ...hit, runPrefix: runCommandPrefix(hit.name) });
    }
  }

  return managers;
}

/**
 * Backwards-compatible single package manager.
 *
 * Returns the JavaScript one when present, else the first detected. Kept so the
 * existing `packageManager` profile field keeps working; new callers should read
 * `packageManagers` and `commands` instead.
 */
function detectPackageManager(root, pkgJson) {
  const all = detectPackageManagers(root, pkgJson);
  if (all.length === 0) return { name: null, source: null };
  const js = all.find((m) => m.ecosystem === "javascript");
  const pick = js ?? all[0];
  return { name: pick.name, source: pick.source };
}

/**
 * Config-file hook managers, checked before native `.git/hooks`.
 *
 * `pre-commit` (the Python framework) is the notable addition beyond husky —
 * it is the de facto standard in Python repos and its config declares the hooks
 * rather than shipping executable scripts, so `preCommitContent` is YAML rather
 * than shell. Callers should treat the content as *declarative*: read it to see
 * what will run, don't try to execute it.
 */
const HOOK_CONFIG_MANAGERS = [
  { manager: "pre-commit", files: [".pre-commit-config.yaml", ".pre-commit-config.yml"], declarative: true },
  { manager: "lefthook", files: ["lefthook.yml", "lefthook.yaml", ".lefthook.yml"], declarative: true },
  { manager: "overcommit", files: [".overcommit.yml"], declarative: true },
];

function detectGitHooks(root) {
  const result = {
    manager: null,
    preCommit: null,
    prePush: null,
    hooksDir: null,
    configFile: null,
    declarative: false,
  };

  // husky ships real scripts per hook, so each is read individually.
  if (exists(join(root, ".husky"))) {
    result.manager = "husky";
    result.hooksDir = ".husky";
    result.preCommit = readFileSafe(join(root, ".husky", "pre-commit"));
    result.prePush = readFileSafe(join(root, ".husky", "pre-push"));
    return result;
  }

  // Declarative managers keep every hook in one config file. Both preCommit and
  // prePush get that same content, since the file describes both stages and the
  // caller needs it either way.
  for (const cfg of HOOK_CONFIG_MANAGERS) {
    const file = cfg.files.find((f) => exists(join(root, f)));
    if (!file) continue;
    const content = readFileSafe(join(root, file));
    result.manager = cfg.manager;
    result.hooksDir = ".";
    result.configFile = file;
    result.declarative = true;
    result.preCommit = content;
    result.prePush = content;
    return result;
  }

  const gitHooksDir = join(root, ".git", "hooks");
  const nativePreCommit = join(gitHooksDir, "pre-commit");
  const nativePrePush = join(gitHooksDir, "pre-push");
  if (exists(nativePreCommit) || exists(nativePrePush)) {
    result.manager = "native-git-hooks";
    result.hooksDir = ".git/hooks";
    result.preCommit = readFileSafe(nativePreCommit);
    result.prePush = readFileSafe(nativePrePush);
  }
  return result;
}

const LINT_STAGED_CONFIG_FILES = [
  ".lintstagedrc",
  ".lintstagedrc.json",
  ".lintstagedrc.js",
  ".lintstagedrc.mjs",
  ".lintstagedrc.yaml",
  ".lintstagedrc.yml",
];

/** True when `name` appears in either dependencies or devDependencies. */
function hasDependency(pkgJson, name) {
  return Boolean(pkgJson?.devDependencies?.[name] ?? pkgJson?.dependencies?.[name]);
}

/** Name of the first package.json script whose command mentions `needle`. */
function findScriptUsing(pkgJson, needle) {
  const scripts = Object.entries(pkgJson?.scripts ?? {});
  const match = scripts.find(([, cmd]) => typeof cmd === "string" && cmd.includes(needle));
  return match ? match[0] : null;
}

function detectStagedFormatter(root, pkgJson) {
  const foundLintStaged = firstExisting(root, LINT_STAGED_CONFIG_FILES);
  const hasLintStagedField = pkgJson?.["lint-staged"] != null;

  if (foundLintStaged || hasLintStagedField || hasDependency(pkgJson, "lint-staged")) {
    return {
      tool: "lint-staged",
      configFile: foundLintStaged ?? (hasLintStagedField ? "package.json:lint-staged" : null),
    };
  }

  if (hasDependency(pkgJson, "pretty-quick")) {
    return { tool: "pretty-quick", scriptName: findScriptUsing(pkgJson, "pretty-quick") };
  }

  return { tool: null };
}

function detectEslintConfig(root) {
  const flat = firstExisting(root, ["eslint.config.js", "eslint.config.mjs", "eslint.config.ts", "eslint.config.cjs"]);
  if (flat) return { format: "flat", file: flat };
  const legacy = firstExisting(root, [
    ".eslintrc.json",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    ".eslintrc",
  ]);
  if (legacy) return { format: "legacy", file: legacy };
  return { format: null, file: null };
}

/**
 * Every framework present, not just the first match.
 *
 * This was previously a single string, which is simply wrong in a monorepo: an
 * Angular frontend beside a FastAPI backend has two frameworks, and reporting
 * one hides the other from any skill deciding which code a ticket touches.
 *
 * JavaScript frameworks are mutually exclusive in practice (a package rarely
 * has both Angular and Next), so the JS block still picks one winner — but a
 * non-JS framework in the same repo is added alongside it.
 */
export function detectFrameworks(root, pkgJson) {
  const deps = { ...pkgJson?.dependencies, ...pkgJson?.devDependencies };
  const found = [];

  // --- JavaScript: first match wins, most specific first ---
  const jsChecks = [
    ["angular", () => exists(join(root, "angular.json")) || deps["@angular/core"]],
    ["next", () => exists(join(root, "next.config.js")) || exists(join(root, "next.config.mjs")) || deps["next"]],
    ["nuxt", () => deps["nuxt"] || exists(join(root, "nuxt.config.ts")) || exists(join(root, "nuxt.config.js"))],
    ["sveltekit", () => deps["@sveltejs/kit"] || exists(join(root, "svelte.config.js"))],
    ["vue", () => deps["vite"] && deps["vue"]],
    ["react", () => deps["react"] && deps["react-dom"]],
    ["vue", () => deps["vue"]],
  ];
  for (const [name, test] of jsChecks) {
    if (test()) {
      found.push(name);
      break;
    }
  }

  // --- Python: dependency declarations live in several possible files ---
  const pyFiles = ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"];
  const pyMentions = (needle) => pyFiles.some((f) => fileMentions(root, f, needle));
  if (exists(join(root, "manage.py")) || pyMentions("django")) found.push("django");
  if (pyMentions("fastapi")) found.push("fastapi");
  if (pyMentions("flask")) found.push("flask");

  // --- Ruby ---
  if (exists(join(root, "config", "application.rb")) || fileMentions(root, "Gemfile", "rails")) {
    found.push("rails");
  }

  // --- Java / Kotlin ---
  const javaFiles = ["pom.xml", "build.gradle", "build.gradle.kts"];
  if (javaFiles.some((f) => fileMentions(root, f, "springframework") || fileMentions(root, f, "spring-boot"))) {
    found.push("spring");
  }

  // --- Rust web frameworks ---
  if (fileMentions(root, "Cargo.toml", "actix-web")) found.push("actix");
  if (fileMentions(root, "Cargo.toml", "axum")) found.push("axum");

  // --- PHP ---
  if (fileMentions(root, "composer.json", "laravel/framework")) found.push("laravel");
  if (fileMentions(root, "composer.json", "symfony/framework-bundle")) found.push("symfony");

  // --- .NET ---
  if (hasFileMatching(root, /\.(csproj|fsproj|vbproj)$/i)) found.push("aspnet");

  // --- Dart ---
  if (fileMentions(root, "pubspec.yaml", "flutter")) found.push("flutter");

  // --- Elixir ---
  if (fileMentions(root, "mix.exs", "phoenix")) found.push("phoenix");

  return [...new Set(found)];
}

/**
 * Backwards-compatible single framework.
 *
 * Returns the first detected. Kept so the existing `framework` profile field
 * keeps working during the transition; new callers should read `frameworks`.
 */
function detectFramework(root, pkgJson) {
  return detectFrameworks(root, pkgJson)[0] ?? null;
}

/**
 * Linters and formatters, keyed by ecosystem.
 *
 * Reported separately from `commands` because knowing *which* linter a repo uses
 * is useful even when the command to run it comes from a Makefile — a fix has to
 * satisfy ruff's rules, not some generic notion of "lint".
 */
/** JavaScript linters/formatters: eslint, prettier, biome. */
function detectJsLinters(root, deps) {
  const found = [];
  const eslint = detectEslintConfig(root);
  if (eslint.file) found.push({ ecosystem: "javascript", tool: "eslint", detectedFrom: eslint.file });
  else if (deps["eslint"]) found.push({ ecosystem: "javascript", tool: "eslint", detectedFrom: "package.json" });

  const prettierConfig = firstExisting(root, [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"]);
  if (deps["prettier"] || prettierConfig) {
    found.push({ ecosystem: "javascript", tool: "prettier", detectedFrom: prettierConfig ?? "package.json" });
  }
  if (deps["@biomejs/biome"] || exists(join(root, "biome.json"))) {
    found.push({
      ecosystem: "javascript",
      tool: "biome",
      detectedFrom: exists(join(root, "biome.json")) ? "biome.json" : "package.json",
    });
  }
  return found;
}

// Tool name -> substring to look for in Python dependency files.
const PYTHON_LINTER_MARKERS = [
  ["ruff", "ruff"],
  ["black", "black"],
  ["flake8", "flake8"],
  ["mypy", "mypy"],
  ["isort", "isort"],
  ["pylint", "pylint"],
];

/** Python linters/formatters: ruff, black, flake8, mypy, isort, pylint. */
function detectPythonLinters(root) {
  const found = [];
  const pyFiles = ["pyproject.toml", "setup.cfg", "requirements.txt", "tox.ini"];
  const pyFrom = (needle) => pyFiles.find((f) => fileMentions(root, f, needle));
  for (const [tool, marker] of PYTHON_LINTER_MARKERS) {
    const from = pyFrom(marker) ?? (exists(join(root, `.${tool}.cfg`)) ? `.${tool}.cfg` : null);
    if (from) found.push({ ecosystem: "python", tool, detectedFrom: from });
  }
  if (exists(join(root, ".ruff.toml")) && !found.some((f) => f.tool === "ruff")) {
    found.push({ ecosystem: "python", tool: "ruff", detectedFrom: ".ruff.toml" });
  }
  return found;
}

/** Rust: clippy/rustfmt ship with the toolchain, so config presence is a bonus. */
function detectRustLinters(root) {
  if (!exists(join(root, "Cargo.toml"))) return [];
  return [
    { ecosystem: "rust", tool: "clippy", detectedFrom: "Cargo.toml" },
    {
      ecosystem: "rust",
      tool: "rustfmt",
      detectedFrom: exists(join(root, "rustfmt.toml")) ? "rustfmt.toml" : "Cargo.toml",
    },
  ];
}

/** Go: golangci-lint (if configured) plus gofmt, which ships with the toolchain. */
function detectGoLinters(root) {
  if (!exists(join(root, "go.mod"))) return [];
  const found = [];
  const golangci = firstExisting(root, [".golangci.yml", ".golangci.yaml", ".golangci.toml"]);
  if (golangci) found.push({ ecosystem: "go", tool: "golangci-lint", detectedFrom: golangci });
  found.push({ ecosystem: "go", tool: "gofmt", detectedFrom: "go.mod" });
  return found;
}

/** Java / Kotlin: ktlint, spotless, checkstyle, detected from build files. */
function detectJavaLinters(root) {
  const found = [];
  const javaFiles = ["pom.xml", "build.gradle", "build.gradle.kts"];
  const hasTool = (needle) => javaFiles.some((f) => fileMentions(root, f, needle));
  if (hasTool("ktlint")) found.push({ ecosystem: "java", tool: "ktlint", detectedFrom: "build file" });
  if (hasTool("spotless")) found.push({ ecosystem: "java", tool: "spotless", detectedFrom: "build file" });
  if (hasTool("checkstyle")) found.push({ ecosystem: "java", tool: "checkstyle", detectedFrom: "build file" });
  return found;
}

/** Ruby: rubocop. */
function detectRubyLinters(root) {
  if (!fileMentions(root, "Gemfile", "rubocop") && !exists(join(root, ".rubocop.yml"))) return [];
  return [
    {
      ecosystem: "ruby",
      tool: "rubocop",
      detectedFrom: exists(join(root, ".rubocop.yml")) ? ".rubocop.yml" : "Gemfile",
    },
  ];
}

/** PHP: php-cs-fixer, phpcs, phpstan, detected from composer.json. */
function detectPhpLinters(root) {
  const found = [];
  if (fileMentions(root, "composer.json", "friendsofphp/php-cs-fixer")) {
    found.push({ ecosystem: "php", tool: "php-cs-fixer", detectedFrom: "composer.json" });
  }
  if (fileMentions(root, "composer.json", "squizlabs/php_codesniffer")) {
    found.push({ ecosystem: "php", tool: "phpcs", detectedFrom: "composer.json" });
  }
  if (fileMentions(root, "composer.json", "phpstan/phpstan")) {
    found.push({ ecosystem: "php", tool: "phpstan", detectedFrom: "composer.json" });
  }
  return found;
}

/** .NET / Dart / Elixir: formatters that ship with the SDK. */
function detectSdkFormatterLinters(root) {
  const found = [];
  if (hasFileMatching(root, /\.(csproj|fsproj|vbproj|sln)$/i)) {
    found.push({ ecosystem: "dotnet", tool: "dotnet-format", detectedFrom: "*.csproj|*.sln" });
  }
  if (exists(join(root, "pubspec.yaml"))) found.push({ ecosystem: "dart", tool: "dart-format", detectedFrom: "pubspec.yaml" });
  if (exists(join(root, "mix.exs"))) found.push({ ecosystem: "elixir", tool: "mix-format", detectedFrom: "mix.exs" });
  if (exists(join(root, ".credo.exs"))) found.push({ ecosystem: "elixir", tool: "credo", detectedFrom: ".credo.exs" });
  return found;
}

/**
 * Linters and formatters, keyed by ecosystem, across every supported language.
 *
 * Each ecosystem's detection lives in its own helper above; this function only
 * orchestrates them, which keeps its own cognitive complexity low regardless of
 * how many ecosystems get added over time.
 */
export function detectLinters(root, pkgJson) {
  const deps = { ...pkgJson?.dependencies, ...pkgJson?.devDependencies };
  return [
    ...detectJsLinters(root, deps),
    ...detectPythonLinters(root),
    ...detectRustLinters(root),
    ...detectGoLinters(root),
    ...detectJavaLinters(root),
    ...detectRubyLinters(root),
    ...detectPhpLinters(root),
    ...detectSdkFormatterLinters(root),
  ];
}

/** Markdown files in a directory, sorted. Empty array if it isn't a readable directory. */
function listMarkdown(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Single-file PR template locations GitHub recognises, in precedence order.
const GITHUB_PR_TEMPLATE_FILES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "pull_request_template.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];

/**
 * Detect the repo's own MR/PR description template.
 *
 * Matters because a team's template usually carries required sections and
 * checklists (affected apps, review steps, ticket link) that a generic
 * Summary/Changes/Testing body would silently replace. Same principle as every
 * other field here: use what the repo actually has rather than assuming.
 */
const NO_MR_TEMPLATE = { kind: null, dir: null, files: [], defaultFile: null, content: null };

function detectMrTemplate(root) {
  return (
    detectGitlabMrTemplateDir(root) ??
    detectGithubPrTemplateDir(root) ??
    detectGithubPrTemplateFile(root) ??
    NO_MR_TEMPLATE
  );
}

/** Shape one detected template location into the result the scanner reports. */
function mrTemplateResult(kind, root, dir, files, defaultFile) {
  return {
    kind,
    dir,
    files,
    defaultFile,
    content: defaultFile ? readFileSafe(join(root, dir, defaultFile)) : null,
  };
}

// --- GitLab: .gitlab/merge_request_templates/*.md ---
function detectGitlabMrTemplateDir(root) {
  const dir = ".gitlab/merge_request_templates";
  const files = listMarkdown(join(root, dir));
  if (files.length === 0) return null;

  // GitLab auto-applies Default.md when present; otherwise a lone file is the de facto default.
  const named = files.find((f) => f.toLowerCase() === "default.md");
  const defaultFile = named ?? (files.length === 1 ? files[0] : null);
  return mrTemplateResult("gitlab-mr", root, dir, files, defaultFile);
}

// --- GitHub: a directory of named templates ---
function detectGithubPrTemplateDir(root) {
  const dir = ".github/PULL_REQUEST_TEMPLATE";
  const files = listMarkdown(join(root, dir));
  if (files.length === 0) return null;

  const defaultFile = files.length === 1 ? files[0] : null;
  return mrTemplateResult("github-pr", root, dir, files, defaultFile);
}

// --- GitHub: a single template file ---
function detectGithubPrTemplateFile(root) {
  const rel = GITHUB_PR_TEMPLATE_FILES.find((candidate) => exists(join(root, candidate)));
  if (!rel) return null;

  const slash = rel.lastIndexOf("/");
  const dir = slash === -1 ? "." : rel.slice(0, slash);
  const file = rel.slice(slash + 1);
  return mrTemplateResult("github-pr", root, dir, [file], file);
}

// ---------- Review checklist / AI instruction file detection ----------

/**
 * Known AI-IDE instruction locations. Each entry is [relativePath, kindLabel].
 *
 * Split into two tables by shape, not by a flag: REVIEW_CHECKLIST_DIRS entries
 * are directories whose markdown files get listed; REVIEW_CHECKLIST_FILES
 * entries are exact files. A path belongs in one table or the other, never
 * both — `.junie` is a directory entry, so `.junie/guidelines.md` must not also
 * appear as a file entry or the same location gets reported twice.
 *
 * Both tables are exported so test.mjs can iterate them: adding a tool here
 * automatically brings it under test.
 *
 * The list is intentionally comprehensive — checking a non-existent path
 * costs one stat call, so breadth is cheap. Sources:
 *   Kiro:       .kiro/steering/*.md
 *   Cursor:     .cursor/rules/*.mdc
 *   Cline:      .clinerules/*.md (dir) or .clinerules (root file, legacy)
 *   Trae:       .trae/rules/*.md
 *   GitHub:     .github/instructions/*.instructions.md, .github/copilot-instructions.md
 *   Junie:      .junie/ (dir — covers guidelines.md)
 *   Augment:    .augment/ (dir)
 *   Claude:     CLAUDE.md
 *   Gemini:     GEMINI.md
 *   Codex/Std:  AGENTS.md
 *   Qwen:       QWEN.md
 *   Warp:       WARP.md
 *   Windsurf:   .windsurfrules
 *   Cursor leg: .cursorrules
 */
export const REVIEW_CHECKLIST_DIRS = [
  [".kiro/steering", "kiro"],
  [".cursor/rules", "cursor"],
  [".clinerules", "cline"],
  [".trae/rules", "trae"],
  [".github/instructions", "github-copilot"],
  [".junie", "junie"],
  [".augment", "augment"],
];

export const REVIEW_CHECKLIST_FILES = [
  ["AGENTS.md", "agents-md"],
  ["CLAUDE.md", "claude-code"],
  ["GEMINI.md", "gemini-cli"],
  ["QWEN.md", "qwen-code"],
  ["WARP.md", "warp"],
  [".windsurfrules", "windsurf"],
  [".cursorrules", "cursor-legacy"],
  [".github/copilot-instructions.md", "github-copilot"],
];

/**
 * Pattern keywords to search for in file names when the precise lookup
 * finds nothing. Only markdown files in the repo root and one level of
 * dot-directories are considered.
 */
export const CHECKLIST_NAME_PATTERNS = [
  /review/i,
  /checklist/i,
  /self[_-]?review/i,
  /code[_-]?review/i,
  /pre[_-]?push/i,
  /pre[_-]?commit/i,
];

/** List files in a dir (non-recursive). Returns [] on failure. */
function listFiles(dir) {
  try {
    return readdirSync(dir).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** True when a file name looks like a markdown document. */
function isMarkdownFile(name) {
  return name.endsWith(".md") || name.endsWith(".mdc") || name.endsWith(".markdown");
}

/** List markdown files in a dir (non-recursive). Returns [] on failure. */
function listMarkdownFiles(dir) {
  return listFiles(dir).filter(isMarkdownFile);
}

/** True when a file name matches one of the review/checklist name patterns. */
function matchesChecklistName(name) {
  return CHECKLIST_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Search a directory for markdown files whose name matches a review/checklist
 * pattern. Returns the first match as { file, content } or null.
 */
function findChecklistByPattern(dir) {
  const file = listMarkdownFiles(dir).find(matchesChecklistName);
  if (!file) return null;
  return { file, content: readFileSafe(join(dir, file)) };
}

/**
 * Pass 1: directory-based AI-instruction locations.
 * Appends to `allSources` and returns the first pattern-matched checklist, or null.
 */
function scanChecklistDirs(root, allSources) {
  let best = null;
  for (const [relDir, kind] of REVIEW_CHECKLIST_DIRS) {
    const absDir = join(root, relDir);
    const files = listMarkdownFiles(absDir);
    if (files.length === 0) continue;

    allSources.push({ source: kind, dir: relDir, files });

    if (!best) {
      const match = findChecklistByPattern(absDir);
      if (match) {
        best = { source: kind, dir: relDir, file: match.file, content: match.content };
      }
    }
  }
  return best;
}

/**
 * Pass 2: single-file AI-instruction locations.
 * Appends to `allSources` and returns the first name-matched checklist, or null.
 */
function scanChecklistFiles(root, allSources) {
  let best = null;
  for (const [relFile, kind] of REVIEW_CHECKLIST_FILES) {
    const absFile = join(root, relFile);
    if (!exists(absFile)) continue;

    const slash = relFile.lastIndexOf("/");
    const dir = slash === -1 ? "." : relFile.slice(0, slash);
    const fileName = slash === -1 ? relFile : relFile.slice(slash + 1);

    allSources.push({ source: kind, dir, files: [fileName] });

    if (!best && matchesChecklistName(fileName)) {
      best = { source: kind, dir, file: fileName, content: readFileSafe(absFile) };
    }
  }
  return best;
}

/**
 * Pass 3: pattern fallback across root-level markdown and one level of
 * dot-directories (e.g. .github/, .docs/). Returns a checklist or null.
 */
function findChecklistFallback(root) {
  const rootMatch = findChecklistByPattern(root);
  if (rootMatch) {
    return { source: "pattern-match", dir: ".", file: rootMatch.file, content: rootMatch.content };
  }

  const dotDirs = listFiles(root).filter((entry) => entry.startsWith(".") && entry !== ".git");
  for (const entry of dotDirs) {
    // findChecklistByPattern tolerates non-directories and unreadable paths.
    const match = findChecklistByPattern(join(root, entry));
    if (match) {
      return { source: "pattern-match", dir: entry, file: match.file, content: match.content };
    }
  }
  return null;
}

/**
 * Detect AI-IDE instruction files that may contain a self-review checklist.
 *
 * Returns:
 *   {
 *     found: true/false,
 *     source: "kiro" | "cursor" | "agents-md" | ... | "pattern-match" | null,
 *     dir: relative dir or null,
 *     files: string[] — all instruction files found at this location,
 *     checklistFile: string | null — the specific file matching review/checklist keywords,
 *     checklistContent: string | null — its full text (inlined for the skill to use directly),
 *     allSources: { source, dir, files }[] — every AI-instruction location that exists
 *   }
 *
 * The skill uses `checklistContent` directly when non-null. When null but
 * `found` is true, instruction files exist but none matched review keywords —
 * the skill can still search their content or ask the user which one applies.
 * When `found` is false, no AI instruction files were detected at all.
 */
function detectReviewChecklist(root) {
  const allSources = [];

  // Both passes always run so `allSources` lists every location that exists.
  const dirChecklist = scanChecklistDirs(root, allSources);
  const fileChecklist = scanChecklistFiles(root, allSources);

  // First pattern-matched checklist wins: dirs, then single files, then fallback.
  const bestChecklist = dirChecklist ?? fileChecklist ?? findChecklistFallback(root);

  if (allSources.length === 0 && !bestChecklist) {
    return {
      found: false,
      source: null,
      dir: null,
      files: [],
      checklistFile: null,
      checklistContent: null,
      allSources: [],
    };
  }

  const fallbackSource = allSources[0];
  return {
    found: true,
    source: bestChecklist?.source ?? fallbackSource?.source ?? null,
    dir: bestChecklist?.dir ?? fallbackSource?.dir ?? null,
    files: bestChecklist ? [bestChecklist.file] : fallbackSource?.files ?? [],
    checklistFile: bestChecklist?.file ?? null,
    checklistContent: bestChecklist?.content ?? null,
    allSources,
  };
}

// ---------- Ecosystem detection ----------

/**
 * Language/stack ecosystems, each identified by marker files.
 *
 * Deliberately an array rather than a single value: a real repo is often
 * polyglot (a TypeScript frontend beside a Python service), and picking one
 * winner would hide the rest. Order here is only display order.
 *
 * Each entry: { id, markers[], lockfiles[] }. A marker alone is enough to
 * claim the ecosystem; lockfiles refine which package manager is in use and
 * are consumed by detectPackageManagers.
 */
export const ECOSYSTEMS = [
  {
    id: "javascript",
    markers: ["package.json"],
    lockfiles: [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lockb", "bun"],
      ["bun.lock", "bun"],
      ["package-lock.json", "npm"],
    ],
  },
  {
    id: "python",
    markers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
    lockfiles: [
      ["uv.lock", "uv"],
      ["poetry.lock", "poetry"],
      ["pdm.lock", "pdm"],
      ["Pipfile.lock", "pipenv"],
    ],
  },
  { id: "rust", markers: ["Cargo.toml"], lockfiles: [["Cargo.lock", "cargo"]] },
  { id: "go", markers: ["go.mod"], lockfiles: [["go.sum", "go"]] },
  {
    id: "java",
    markers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
    lockfiles: [],
  },
  { id: "ruby", markers: ["Gemfile"], lockfiles: [["Gemfile.lock", "bundler"]] },
  { id: "php", markers: ["composer.json"], lockfiles: [["composer.lock", "composer"]] },
  { id: "dotnet", markers: ["global.json"], lockfiles: [["packages.lock.json", "nuget"]] },
  { id: "dart", markers: ["pubspec.yaml"], lockfiles: [["pubspec.lock", "pub"]] },
  { id: "elixir", markers: ["mix.exs"], lockfiles: [["mix.lock", "hex"]] },
];

/** True when the directory holds a file matching `pattern`. */
function hasFileMatching(dir, pattern) {
  try {
    return readdirSync(dir).some((f) => pattern.test(f));
  } catch {
    return false;
  }
}

/**
 * Which ecosystems this repo contains.
 *
 * .NET is special-cased: projects are identified by `*.csproj`/`*.sln` rather
 * than a fixed filename, so a glob is required. `global.json` alone is a weak
 * signal (it only pins an SDK version) and is not always present.
 */
export function detectEcosystems(root) {
  const found = [];

  for (const eco of ECOSYSTEMS) {
    const marker = eco.markers.find((m) => exists(join(root, m)));
    if (marker) {
      found.push({ id: eco.id, detectedFrom: marker });
      continue;
    }
    if (eco.id === "dotnet" && hasFileMatching(root, /\.(csproj|fsproj|vbproj|sln)$/i)) {
      found.push({ id: eco.id, detectedFrom: "*.csproj|*.sln" });
    }
  }

  return found;
}

// ---------- Cross-ecosystem task runners ----------

/**
 * Generic task runners, checked before any ecosystem-specific tooling.
 *
 * These matter more than they look. Python, Go, Rust and C++ projects
 * overwhelmingly expose `make lint` / `make test`, so a single Makefile parse
 * resolves commands for stacks whose linters this scanner knows nothing about.
 * That is what keeps `commands` useful outside JavaScript without carrying ten
 * ecosystems' worth of linter trivia.
 */
const TASK_RUNNERS = [
  { tool: "make", files: ["Makefile", "makefile", "GNUmakefile"], invoke: "make" },
  { tool: "just", files: ["justfile", "Justfile", ".justfile"], invoke: "just" },
  { tool: "task", files: ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml"], invoke: "task" },
];

/**
 * Target names from a Makefile.
 *
 * Matches `name:` at line start, excluding pattern rules (`%`), variable
 * assignments (`name := ...`, caught by requiring the colon not be followed by
 * `=`), and `.PHONY`-style special targets.
 */
function parseMakeTargets(content) {
  if (!content) return [];
  const targets = new Set();
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:(?!=)/);
    if (m) targets.add(m[1]);
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

/** Recipe names from a justfile — `name:` or `name arg1 arg2:` at line start. */
function parseJustTargets(content) {
  if (!content) return [];
  const targets = new Set();
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s[^:]*)?:(?!=)/);
    if (m) targets.add(m[1]);
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

/**
 * Task names from a Taskfile.
 *
 * Deliberately shallow: keys indented exactly two spaces under a top-level
 * `tasks:` block. Parsing YAML properly would mean a dependency, and this
 * server is zero-dependency by design. A missed task degrades to "no command
 * found", which the skills already handle.
 */
function parseTaskfileTargets(content) {
  if (!content) return [];
  const targets = new Set();
  let inTasks = false;
  for (const line of content.split("\n")) {
    if (/^tasks:\s*$/.test(line)) {
      inTasks = true;
      continue;
    }
    if (inTasks) {
      if (/^\S/.test(line)) break; // dedented out of the tasks block
      const m = line.match(/^ {2}([A-Za-z0-9][A-Za-z0-9._:-]*)\s*:/);
      if (m) targets.add(m[1]);
    }
  }
  return [...targets].sort((a, b) => a.localeCompare(b));
}

function parseTargets(tool, content) {
  if (tool === "make") return parseMakeTargets(content);
  if (tool === "just") return parseJustTargets(content);
  return parseTaskfileTargets(content);
}

/** Detect every generic task runner present, with its available targets. */
export function detectTaskRunners(root) {
  const found = [];
  for (const runner of TASK_RUNNERS) {
    const file = runner.files.find((f) => exists(join(root, f)));
    if (!file) continue;
    const content = readFileSafe(join(root, file));
    found.push({
      tool: runner.tool,
      file,
      invoke: runner.invoke,
      targets: parseTargets(runner.tool, content),
    });
  }
  return found;
}

// ---------- Unified task command resolution ----------

/**
 * The tasks a workflow actually needs to run.
 *
 * Target names checked per task, in preference order. `check` sits last for
 * lint because it is usually the heavier lint-and-build combination — correct
 * as a fallback, wasteful as a first choice.
 */
const TASK_ALIASES = {
  lint: ["lint", "lint:all", "eslint", "check"],
  test: ["test", "tests", "unit", "test:unit"],
  build: ["build", "compile", "dist"],
  format: ["format", "fmt", "prettier", "format:write"],
};

/**
 * Resolve one task to a runnable command.
 *
 * Precedence, and the reasoning for it:
 *   1. Generic task runner target (`make lint`) — if a repo defines one, it is
 *      the team's intended entry point and usually wraps the rest.
 *   2. Package-script (`pnpm run lint`) — the JavaScript equivalent.
 *   3. Ecosystem default (`cargo clippy`) — correct but unaware of local
 *      conventions, so it goes last.
 *
 * Returns `{ command, source }`, or null when nothing resolves. Null is a
 * legitimate answer: the skills already treat "no command found" as "say so and
 * skip" rather than inventing one.
 */
function resolveTaskCommand(task, { taskRunners, pkgJson, runPrefix, ecosystemDefaults }) {
  const aliases = TASK_ALIASES[task] ?? [task];

  for (const alias of aliases) {
    for (const runner of taskRunners) {
      if (runner.targets.includes(alias)) {
        return { command: `${runner.invoke} ${alias}`, source: `${runner.file}:${alias}` };
      }
    }
  }

  if (pkgJson?.scripts && runPrefix) {
    for (const alias of aliases) {
      if (typeof pkgJson.scripts[alias] === "string") {
        return { command: `${runPrefix} ${alias}`, source: `package.json:scripts.${alias}` };
      }
    }
  }

  const fallback = ecosystemDefaults[task];
  if (fallback) return fallback;

  return null;
}

/**
 * Last-resort commands per task, derived from detected tooling.
 *
 * Only consulted when no task-runner target and no package script matched, so
 * these never override a repo's own conventions. Built from what was actually
 * found — a detected `ruff` produces `ruff check`, an absent one produces
 * nothing rather than a hopeful guess.
 *
 * First ecosystem wins per task, following the order of ECOSYSTEMS, so a
 * primarily-JavaScript repo doesn't get a Python lint command.
 */
function buildEcosystemCommandDefaults(ecosystems, linters, testRunners) {
  const defaults = {};
  const ids = ecosystems.map((e) => e.id);

  const setOnce = (task, command, source) => {
    if (!defaults[task] && command) defaults[task] = { command, source };
  };

  // --- lint / format from detected linters, in ecosystem order ---
  const lintCommands = {
    ruff: "ruff check .",
    flake8: "flake8",
    pylint: "pylint .",
    clippy: "cargo clippy",
    "golangci-lint": "golangci-lint run",
    rubocop: "bundle exec rubocop",
    phpstan: "vendor/bin/phpstan analyse",
    phpcs: "vendor/bin/phpcs",
    ktlint: "gradle ktlintCheck",
    spotless: "gradle spotlessCheck",
    credo: "mix credo",
    eslint: null, // JS lint is covered by package scripts; a bare eslint call would miss config
    biome: "biome check .",
  };
  const formatCommands = {
    ruff: "ruff format .",
    black: "black .",
    rustfmt: "cargo fmt",
    gofmt: "gofmt -w .",
    prettier: null, // same reasoning as eslint
    biome: "biome format --write .",
    "dotnet-format": "dotnet format",
    "dart-format": "dart format .",
    "mix-format": "mix format",
    spotless: "gradle spotlessApply",
  };

  for (const id of ids) {
    for (const l of linters.filter((x) => x.ecosystem === id)) {
      setOnce("lint", lintCommands[l.tool], `${l.tool} (${l.detectedFrom})`);
      setOnce("format", formatCommands[l.tool], `${l.tool} (${l.detectedFrom})`);
    }
  }

  // --- test from detected runners ---
  for (const id of ids) {
    const runner = testRunners.find((r) => r.ecosystem === id);
    if (runner) setOnce("test", runner.command, `${runner.tool} (${id})`);
  }

  // --- build: fixed per ecosystem ---
  const buildCommands = {
    rust: "cargo build",
    go: "go build ./...",
    dotnet: "dotnet build",
    elixir: "mix compile",
    dart: "dart compile exe .",
  };
  for (const id of ids) setOnce("build", buildCommands[id], id);

  return defaults;
}

/** Resolve lint/test/build/format for this project. */
export function detectCommands(root, pkgJson, opts = {}) {
  const taskRunners = opts.taskRunners ?? detectTaskRunners(root);
  const runPrefix = opts.runPrefix ?? null;
  const ecosystemDefaults = opts.ecosystemDefaults ?? {};

  const commands = {};
  for (const task of Object.keys(TASK_ALIASES)) {
    commands[task] = resolveTaskCommand(task, { taskRunners, pkgJson, runPrefix, ecosystemDefaults });
  }
  return commands;
}

// ---------- Monorepo / test runner ----------

/**
 * Every monorepo tool present.
 *
 * Was a single value, which lost real information: nx and pnpm-workspaces
 * routinely coexist (nx for task orchestration, pnpm for dependency linking),
 * and returning only the first match made the second invisible. Cargo and Go
 * workspaces are included so non-JS monorepos register at all.
 */
export function detectMonorepoTools(root) {
  const found = [];

  if (exists(join(root, "nx.json"))) found.push("nx");
  if (exists(join(root, "turbo.json"))) found.push("turborepo");
  if (exists(join(root, "lerna.json"))) found.push("lerna");
  if (exists(join(root, "pnpm-workspace.yaml"))) found.push("pnpm-workspaces");
  if (exists(join(root, "rush.json"))) found.push("rush");

  // npm/yarn workspaces are declared inside package.json rather than by a file.
  const pkg = readJsonSafe(join(root, "package.json"));
  if (pkg?.workspaces) found.push("npm-workspaces");

  if (fileMentions(root, "Cargo.toml", "[workspace]")) found.push("cargo-workspaces");
  if (exists(join(root, "go.work"))) found.push("go-workspaces");
  if (exists(join(root, "melos.yaml"))) found.push("melos");

  return found;
}

/**
 * Backwards-compatible single monorepo tool.
 *
 * New callers should read `monorepoTools`.
 */
function detectMonorepoTool(root) {
  return detectMonorepoTools(root)[0] ?? null;
}

/** Case-insensitive substring check against a file's contents. */
function fileMentions(root, relPath, needle) {
  const content = readFileSafe(join(root, relPath));
  return content ? content.toLowerCase().includes(needle.toLowerCase()) : false;
}

/** Dependency-driven JS test runner; first match wins (extras are usually e2e add-ons). */
function detectJsTestRunner(deps) {
  const jsRunners = [
    ["vitest", "vitest run"],
    ["jest", "jest"],
    ["@playwright/test", "playwright test"],
    ["cypress", "cypress run"],
    ["karma", "karma start"],
    ["mocha", "mocha"],
  ];
  for (const [dep, cmd] of jsRunners) {
    if (deps[dep]) {
      return { ecosystem: "javascript", tool: dep === "@playwright/test" ? "playwright" : dep, command: cmd };
    }
  }
  return null;
}

/** Python: pytest is near-universal; fall back to unittest. */
function detectPythonTestRunner(root) {
  const hasPyProjectMarkers =
    exists(join(root, "pyproject.toml")) || exists(join(root, "setup.py")) || exists(join(root, "setup.cfg"));

  if (hasPyProjectMarkers) {
    const mentionsPytest =
      fileMentions(root, "pyproject.toml", "pytest") ||
      fileMentions(root, "setup.cfg", "pytest") ||
      fileMentions(root, "requirements.txt", "pytest") ||
      exists(join(root, "pytest.ini")) ||
      exists(join(root, "tox.ini"));
    return mentionsPytest
      ? { ecosystem: "python", tool: "pytest", command: "pytest" }
      : { ecosystem: "python", tool: "unittest", command: "python -m unittest" };
  }

  if (exists(join(root, "pytest.ini"))) {
    return { ecosystem: "python", tool: "pytest", command: "pytest" };
  }

  return null;
}

function detectRustTestRunner(root) {
  return exists(join(root, "Cargo.toml")) ? { ecosystem: "rust", tool: "cargo-test", command: "cargo test" } : null;
}

function detectGoTestRunner(root) {
  return exists(join(root, "go.mod")) ? { ecosystem: "go", tool: "go-test", command: "go test ./..." } : null;
}

function detectJavaTestRunner(root) {
  if (exists(join(root, "pom.xml"))) {
    return { ecosystem: "java", tool: "maven-surefire", command: "mvn test" };
  }
  if (exists(join(root, "build.gradle")) || exists(join(root, "build.gradle.kts"))) {
    return { ecosystem: "java", tool: "gradle-test", command: "gradle test" };
  }
  return null;
}

function detectRubyTestRunner(root) {
  if (!exists(join(root, "Gemfile"))) return null;
  const rspec = fileMentions(root, "Gemfile", "rspec");
  return rspec
    ? { ecosystem: "ruby", tool: "rspec", command: "bundle exec rspec" }
    : { ecosystem: "ruby", tool: "rake-test", command: "bundle exec rake test" };
}

function detectPhpTestRunner(root) {
  return exists(join(root, "composer.json"))
    ? { ecosystem: "php", tool: "phpunit", command: "vendor/bin/phpunit" }
    : null;
}

function detectDotnetTestRunner(root) {
  const hasProjectFile = hasFileMatching(root, /\.(csproj|fsproj|vbproj|sln)$/i) || exists(join(root, "global.json"));
  return hasProjectFile ? { ecosystem: "dotnet", tool: "dotnet-test", command: "dotnet test" } : null;
}

function detectDartTestRunner(root) {
  if (!exists(join(root, "pubspec.yaml"))) return null;
  const flutter = fileMentions(root, "pubspec.yaml", "flutter");
  return flutter
    ? { ecosystem: "dart", tool: "flutter-test", command: "flutter test" }
    : { ecosystem: "dart", tool: "dart-test", command: "dart test" };
}

function detectElixirTestRunner(root) {
  return exists(join(root, "mix.exs")) ? { ecosystem: "elixir", tool: "mix-test", command: "mix test" } : null;
}

/**
 * Test runners across every ecosystem present.
 *
 * An array for the same reason as frameworks: a polyglot repo runs vitest and
 * pytest, and reporting one would misdescribe the other half of the codebase.
 * Each entry carries the command to invoke it, because for most non-JS stacks
 * the runner *is* a command rather than a dependency to look up.
 */
export function detectTestRunners(root, pkgJson) {
  const deps = { ...pkgJson?.dependencies, ...pkgJson?.devDependencies };

  const detectors = [
    () => detectJsTestRunner(deps),
    () => detectPythonTestRunner(root),
    () => detectRustTestRunner(root),
    () => detectGoTestRunner(root),
    () => detectJavaTestRunner(root),
    () => detectRubyTestRunner(root),
    () => detectPhpTestRunner(root),
    () => detectDotnetTestRunner(root),
    () => detectDartTestRunner(root),
    () => detectElixirTestRunner(root),
  ];

  return detectors.map((detect) => detect()).filter(Boolean);
}

/**
 * Backwards-compatible single test runner.
 *
 * Prefers the JavaScript runner to preserve prior behaviour, else the first
 * detected. New callers should read `testRunners`.
 */
function detectTestRunner(root, pkgJson) {
  const all = detectTestRunners(root, pkgJson);
  if (all.length === 0) return null;
  const js = all.find((r) => r.ecosystem === "javascript");
  return (js ?? all[0]).tool;
}

function collectUsefulScripts(pkgJson) {
  if (!pkgJson?.scripts) return {};
  const interesting = ["lint", "format", "test", "build", "check", "prettier", "e2e"];
  const found = {};
  for (const [name, cmd] of Object.entries(pkgJson.scripts)) {
    if (interesting.some((keyword) => name.toLowerCase().includes(keyword))) {
      found[name] = cmd;
    }
  }
  return found;
}

// ---------- Git detection ----------

// Absolute locations git is installed to, checked in order. Resolving to an
// absolute path avoids relying on PATH, which a caller could have modified to
// shadow `git` with an attacker-controlled executable.
const GIT_CANDIDATES =
  process.platform === "win32"
    ? [
        String.raw`C:\Program Files\Git\cmd\git.exe`,
        String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
        String.raw`C:\Program Files\Git\bin\git.exe`,
        // Git for Windows installed per-user rather than system-wide
        join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "cmd", "git.exe"),
        // Chocolatey
        String.raw`C:\ProgramData\chocolatey\bin\git.exe`,
        // Scoop (per-user, and the shim directory)
        join(process.env.USERPROFILE ?? "", "scoop", "apps", "git", "current", "cmd", "git.exe"),
        join(process.env.USERPROFILE ?? "", "scoop", "shims", "git.exe"),
      ]
    : [
        "/usr/bin/git",
        "/usr/local/bin/git",
        "/opt/homebrew/bin/git", // Apple Silicon Homebrew
        "/home/linuxbrew/.linuxbrew/bin/git", // Linuxbrew
        "/usr/local/git/bin/git", // Xcode / standalone installer
        "/bin/git",
      ];

let gitBinCache;

/**
 * Resolve the git executable to an absolute path once and reuse it.
 * `PROJECT_SCANNER_GIT_PATH` allows an explicit override for non-standard
 * installs. Falls back to a bare `git` (PATH lookup) only when nothing else
 * is found, so the scanner still works on unusual setups.
 */
function gitBin() {
  if (gitBinCache !== undefined) return gitBinCache;
  const override = process.env.PROJECT_SCANNER_GIT_PATH;
  if (override && exists(override)) {
    gitBinCache = override;
  } else {
    gitBinCache = GIT_CANDIDATES.find(exists) ?? "git";
  }
  return gitBinCache;
}

/**
 * Run a git command without a shell (execFileSync), so arguments containing
 * `%`, quotes or spaces are passed through verbatim on every platform.
 * Returns trimmed stdout, or null if git is missing / the command failed.
 */
function gitOut(root, args) {
  try {
    return execFileSync(gitBin(), args, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(root) {
  return gitOut(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/**
 * Hostname of a git remote URL, lowercased. Handles both scp-like syntax
 * (`git@host:org/repo.git`) and real URLs (`https://`, `ssh://`).
 * Returns "" when the shape isn't recognised.
 */
function remoteHostname(url) {
  const scp = /^[^/@]+@([^:/]+):/.exec(url);
  if (scp) return scp[1].toLowerCase();
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function detectVcsHost(root) {
  const url = gitOut(root, ["config", "--get", "remote.origin.url"]);
  if (!url) return { host: null, remoteUrl: null };

  // Match on the hostname only. Matching the whole URL misreads repositories
  // whose org/name contains a competitor's name, e.g.
  // github.com/acme/gitlab-migration is GitHub, not GitLab.
  const host = remoteHostname(url);
  if (host.includes("gitlab")) return { host: "gitlab", remoteUrl: url };
  if (host.includes("github")) return { host: "github", remoteUrl: url };
  if (host.includes("bitbucket")) return { host: "bitbucket", remoteUrl: url };

  // Self-hosted instances often don't include the product name in the URL.
  // Fall back to checking for CI/CD config files that are host-specific.
  if (exists(join(root, ".gitlab-ci.yml")) || exists(join(root, ".gitlab"))) {
    return { host: "gitlab", remoteUrl: url };
  }
  if (exists(join(root, ".github"))) return { host: "github", remoteUrl: url };
  if (exists(join(root, "bitbucket-pipelines.yml"))) return { host: "bitbucket", remoteUrl: url };

  return { host: "unknown", remoteUrl: url };
}

/** Strip the remote name from a remote-tracking branch: "origin/feature/X" -> "feature/X" */
function stripRemote(name) {
  const idx = name.indexOf("/");
  return idx === -1 ? name : name.slice(idx + 1);
}

function listBranches(root) {
  const local = [];
  const remote = [];

  const localRaw = gitOut(root, ["branch", "--list"]);
  if (localRaw) {
    for (const line of localRaw.split("\n")) {
      const name = line.replace(/^\*?\s*\+?\s*/, "").trim();
      if (!name || name.startsWith("(")) continue; // "(HEAD detached at ...)"
      local.push(name);
    }
  }

  const remoteRaw = gitOut(root, ["branch", "-r", "--list"]);
  if (remoteRaw) {
    for (const line of remoteRaw.split("\n")) {
      const raw = line.trim();
      if (!raw || raw.includes("->")) continue; // skip "origin/HEAD -> origin/main"
      remote.push(stripRemote(raw));
    }
  }

  return { local, remote };
}

/**
 * Detect the repo's default branch (what origin/HEAD points at) and the branch
 * feature work should actually be cut from. Git Flow repos branch off `develop`,
 * which is usually NOT origin/HEAD — so these two are reported separately.
 */
function detectBranchTargets(root, branches) {
  const known = new Set([...branches.remote, ...branches.local]);

  let defaultBranch = null;
  const symRef = gitOut(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (symRef) {
    defaultBranch = stripRemote(symRef.replace("refs/remotes/", ""));
  }
  if (!defaultBranch) {
    for (const candidate of ["main", "master", "trunk"]) {
      if (known.has(candidate)) {
        defaultBranch = candidate;
        break;
      }
    }
  }

  let integrationBranch = defaultBranch;
  let integrationSource = defaultBranch ? "default-branch" : null;
  for (const candidate of ["develop", "development", "dev"]) {
    if (known.has(candidate)) {
      integrationBranch = candidate;
      integrationSource = `found-branch:${candidate}`;
      break;
    }
  }

  return { defaultBranch, integrationBranch, integrationSource };
}

/**
 * Find every branch already referencing a ticket key. Done in code rather than
 * by handing a caller the whole branch list: a repo can easily carry 80+
 * branches, and `PROJ-24` must not match `feature/PROJ-241`.
 */String.raw`\$&`
function matchBranchesForKey(names, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // Trailing (?!\d) stops a shorter key matching a longer number.
  const re = new RegExp(String.raw`(^|[^A-Za-z0-9])${escaped}(?!\d)`, "i");
  return names.filter((n) => re.test(n));
}

/**
 * For each requested ticket key, report whether a branch for it already exists.
 * Lets the workflow avoid creating a duplicate branch, and lets it discover
 * whether a ticket's parent epic already has a branch to cut from.
 */
function detectTicketBranches(branches, ticketKeys) {
  if (!Array.isArray(ticketKeys) || ticketKeys.length === 0) return null;

  const result = {};
  for (const rawKey of ticketKeys) {
    if (typeof rawKey !== "string" || rawKey.trim() === "") continue;
    const key = rawKey.trim();
    const local = matchBranchesForKey(branches.local, key);
    const remote = matchBranchesForKey(branches.remote, key);
    result[key] = {
      exists: local.length > 0 || remote.length > 0,
      local,
      remote,
      // Local but not pushed — safe to switch to, but nothing to pull.
      localOnly: local.length > 0 && remote.length === 0,
      // On the remote but not checked out — needs a fetch/checkout.
      remoteOnly: remote.length > 0 && local.length === 0,
    };
  }
  return result;
}

/** Infer the repo's branch naming convention from branches that actually exist. */
function detectBranchNaming(branches) {
  const reserved = new Set(["main", "master", "trunk", "develop", "development", "dev", "HEAD"]);
  const names = [...new Set([...branches.remote, ...branches.local])].filter((n) => !reserved.has(n));

  const prefixCounts = {};
  let ticketKeyUpper = 0;
  let ticketKeyLower = 0;

  for (const name of names) {
    const slash = name.indexOf("/");
    if (slash > 0) {
      const prefix = name.slice(0, slash);
      prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    }
    if (TICKET_KEY_RE.test(name)) ticketKeyUpper++;
    else if (/\b[a-z][a-z0-9]+-\d+\b/.test(name)) ticketKeyLower++;
  }

  const observedPrefixes = Object.entries(prefixCounts)
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count);

  const withTicketKey = ticketKeyUpper + ticketKeyLower;
  let ticketKeyCase = null;
  if (withTicketKey > 0) ticketKeyCase = ticketKeyUpper >= ticketKeyLower ? "upper" : "lower";

  return {
    sampleSize: names.length,
    observedPrefixes,
    dominantPrefixes: observedPrefixes.slice(0, 4).map((p) => p.prefix),
    usesTicketKeyInBranch: names.length > 0 ? withTicketKey / names.length >= 0.5 : null,
    ticketKeyCase,
    samples: names.slice(0, 5),
  };
}

// A subject that leads with a bare ticket key, e.g. "PROJ-1234: fix the thing"
const TICKET_KEY_PREFIX_RE = /^[A-Z][A-Z0-9]+-\d+\s*[:\-—]/;

// How many of the newest commits count as "recent" when judging the convention.
const RECENT_COMMIT_WINDOW = 15;

/**
 * Result for a repo with no readable history. Built fresh each call (rather than
 * shared) and with the same key set as the populated result, so consumers see a
 * stable shape whether or not there are commits.
 */
function emptyCommitConvention() {
  return {
    pattern: null,
    sampleSize: 0,
    conventionalRatio: null,
    recentConventionalRatio: null,
    scopedCount: 0,
    observedTypes: [],
    usesTicketKeyInScope: null,
    suggestedFormat: null,
    samples: [],
    author: null,
  };
}

/** `git log --oneline` lines -> just the subject text, blanks dropped. */
function parseCommitSubjects(raw) {
  return raw
    .split("\n")
    .map((line) => {
      const space = line.indexOf(" ");
      return space === -1 ? "" : line.slice(space + 1).trim();
    })
    .filter(Boolean);
}

/** Count how many subjects follow each recognised style. */
function tallyCommitStyles(subjects) {
  const tally = { conventional: 0, scoped: 0, ticketKeyInScope: 0, ticketKeyPrefix: 0, types: {} };

  for (const subject of subjects) {
    const m = CONVENTIONAL_RE.exec(subject);
    if (!m) {
      if (TICKET_KEY_PREFIX_RE.test(subject)) tally.ticketKeyPrefix++;
      continue;
    }

    const [, type, scope] = m;
    tally.conventional++;
    tally.types[type] = (tally.types[type] ?? 0) + 1;

    if (!scope) continue;
    tally.scoped++;
    if (TICKET_KEY_RE.test(scope)) tally.ticketKeyInScope++;
  }

  return tally;
}

/**
 * Commit conventions get adopted over time, so the newest commits are more
 * representative than the whole window. A repo that switched to conventional
 * commits recently would otherwise be outvoted by its own history.
 */
function pickCommitPattern(tally, total, recentRatio) {
  if (tally.conventional / total >= 0.6 || recentRatio >= 0.6) return "conventional-commits";
  if (tally.ticketKeyPrefix / total >= 0.6) return "ticket-key-prefix";
  return "mixed-or-freeform";
}

/**
 * Of the commits that actually carry a scope, is that scope usually a ticket key?
 * Dividing by all conventional commits instead would let unscoped ones
 * (`fix: something`) dilute a question they aren't part of.
 */
function usesTicketKeyScope(tally) {
  if (tally.scoped === 0) return null;
  return tally.ticketKeyInScope / tally.scoped >= 0.5;
}

function pickSuggestedFormat(pattern, tally) {
  if (pattern === "ticket-key-prefix") return "{TICKET-KEY}: short description";
  if (pattern !== "conventional-commits") return null;

  if (usesTicketKeyScope(tally)) return "{type}({TICKET-KEY}): short description";
  if (tally.scoped / Math.max(tally.conventional, 1) >= 0.5) return "{type}({scope}): short description";
  return "{type}: short description";
}

/**
 * Below this many commits by the author, their "convention" isn't evidence of a
 * habit. It matters because this power writes commits itself: with n=1, the only
 * sample can be a commit this very workflow generated, so a suggestion derived
 * from it would be circular — the tool confirming its own default. Observed for
 * real on a repo where the author had exactly one commit.
 *
 * The default of 5 is a judgement call, so it's overridable via
 * PROJECT_SCANNER_MIN_AUTHOR_SAMPLE rather than requiring a code edit to
 * disagree with it. Values below 1 are ignored.
 */
function minAuthorSample() {
  const raw = Number.parseInt(process.env.PROJECT_SCANNER_MIN_AUTHOR_SAMPLE ?? "", 10);
  return Number.isInteger(raw) && raw >= 1 ? raw : 5;
}

/**
 * The convention for one specific author. A repo can be mixed overall while an
 * individual contributor is perfectly consistent — in that case their own
 * history predicts what they want far better than the repo average does.
 */
function detectAuthorConvention(root, authorEmail) {
  if (!authorEmail) return null;

  const raw = gitOut(root, ["log", "--no-merges", "--no-decorate", "--oneline", "-n", "40", `--author=${authorEmail}`]);
  if (!raw) return null;

  const subjects = parseCommitSubjects(raw);
  if (subjects.length === 0) return null;

  const tally = tallyCommitStyles(subjects);
  const ratio = tally.conventional / subjects.length;
  const pattern = pickCommitPattern(tally, subjects.length, ratio);
  const threshold = minAuthorSample();
  const enoughEvidence = subjects.length >= threshold;

  return {
    sampleSize: subjects.length,
    pattern,
    conventionalRatio: Number(ratio.toFixed(2)),
    usesTicketKeyInScope: usesTicketKeyScope(tally),
    // Withheld below MIN_AUTHOR_SAMPLE so a caller can't mistake one or two
    // commits for an established habit. The raw numbers above stay visible so
    // the caller can still see what little evidence exists.
    suggestedFormat: enoughEvidence ? pickSuggestedFormat(pattern, tally) : null,
    lowConfidence: !enoughEvidence,
    minSampleForSuggestion: threshold,
    samples: subjects.slice(0, 3),
  };
}

/** Infer the commit message convention from recent history. */
function detectCommitConvention(root, authorEmail) {
  const raw = gitOut(root, ["log", "--no-merges", "--no-decorate", "--oneline", "-n", "40"]);
  if (!raw) return emptyCommitConvention();

  const subjects = parseCommitSubjects(raw);
  const total = subjects.length;
  if (total === 0) return emptyCommitConvention();

  const tally = tallyCommitStyles(subjects);

  // `git log` returns newest first, so the head of the list is the recent window.
  const recent = subjects.slice(0, RECENT_COMMIT_WINDOW);
  const recentRatio = recent.length > 0 ? tallyCommitStyles(recent).conventional / recent.length : 0;

  const pattern = pickCommitPattern(tally, total, recentRatio);

  return {
    pattern, // "conventional-commits" | "ticket-key-prefix" | "mixed-or-freeform" | null
    sampleSize: total,
    conventionalRatio: Number((tally.conventional / total).toFixed(2)),
    recentConventionalRatio: Number(recentRatio.toFixed(2)), // over the newest commits only
    scopedCount: tally.scoped,
    observedTypes: Object.entries(tally.types)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    usesTicketKeyInScope: usesTicketKeyScope(tally),
    suggestedFormat: pickSuggestedFormat(pattern, tally),
    samples: subjects.slice(0, 5),
    // Same analysis restricted to the current git user. Use this when the
    // repo-wide `suggestedFormat` is null but the user is self-consistent.
    author: detectAuthorConvention(root, authorEmail),
  };
}

function detectGit(root, ticketKeys) {
  if (!isGitRepo(root)) {
    return {
      isGitRepo: false,
      currentBranch: null,
      detached: null,
      currentBranchTicketKey: null,
      currentBranchProjectPrefix: null,
      defaultBranch: null,
      integrationBranch: null,
      integrationBranchSource: null,
      branchNaming: null,
      commitConvention: null,
      isDirty: null,
      user: null,
      ticketBranches: null,
    };
  }

  const branches = listBranches(root);
  const targets = detectBranchTargets(root, branches);

  // `--show-current` prints nothing in detached HEAD state.
  const current = gitOut(root, ["branch", "--show-current"]);
  const currentBranch = current && current.length > 0 ? current : null;
  const keyMatch = currentBranch ? currentBranch.match(TICKET_KEY_RE) : null;
  const status = gitOut(root, ["status", "--porcelain"]);

  // The local git *commit* identity. Note this often differs from the VCS host
  // username (e.g. "janedoe" vs the GitLab account "jane.doe"),
  // so it is a hint for display purposes and for scoping `git log --author`,
  // not a reliable MR assignee. Resolve the assignee from the host instead.
  const userName = gitOut(root, ["config", "user.name"]);
  const userEmail = gitOut(root, ["config", "user.email"]);

  return {
    isGitRepo: true,
    currentBranch,
    detached: currentBranch === null,
    currentBranchTicketKey: keyMatch ? keyMatch[0] : null,
    currentBranchProjectPrefix: keyMatch ? keyMatch[1] : null,
    defaultBranch: targets.defaultBranch,
    integrationBranch: targets.integrationBranch,
    integrationBranchSource: targets.integrationSource,
    branchNaming: detectBranchNaming(branches),
    commitConvention: detectCommitConvention(root, userEmail),
    isDirty: status === null ? null : status.length > 0,
    user: { name: userName, email: userEmail },
    // null unless ticket_keys was passed to the tool
    ticketBranches: detectTicketBranches(branches, ticketKeys),
  };
}

// ---------- Scan ----------

/**
 * Build the full project profile.
 *
 * @param {string} [workspacePath] Absolute path to scan. Defaults to process cwd.
 * @param {string[]} [ticketKeys]  Optional ticket keys to match against branches.
 * @returns {object} The profile, or `{ error }` when the path does not exist.
 */
export function scanProject(workspacePath, ticketKeys) {
  const root = resolve(workspacePath || process.cwd());
  if (!exists(root)) {
    return { error: `Path does not exist: ${root}` };
  }

  const pkgJson = readJsonSafe(join(root, "package.json"));

  const packageManager = detectPackageManager(root, pkgJson);
  const packageManagers = detectPackageManagers(root, pkgJson);
  const gitHooks = detectGitHooks(root);
  const ecosystems = detectEcosystems(root);
  const taskRunners = detectTaskRunners(root);
  const linters = detectLinters(root, pkgJson);
  const testRunners = detectTestRunners(root, pkgJson);

  // Last-resort commands, used only when neither a task-runner target nor a
  // package script exists. Derived from what's actually installed rather than
  // assumed: a Rust repo without clippy configured still has `cargo` available.
  const ecosystemDefaults = buildEcosystemCommandDefaults(ecosystems, linters, testRunners);

  const jsPrefix = packageManagers.find((m) => m.ecosystem === "javascript")?.runPrefix ?? null;

  return {
    root,
    ecosystems, // [{ id: "javascript" | "python" | ..., detectedFrom }] — polyglot-aware
    packageManager: {
      name: packageManager.name,
      detectedFrom: packageManager.source,
      runCommandPrefix: runCommandPrefix(packageManager.name), // e.g. "pnpm run"
    },
    packageManagers, // one per ecosystem: [{ ecosystem, name, source, runPrefix }]
    taskRunners, // [{ tool: "make" | "just" | "task", file, invoke, targets[] }]
    commands: detectCommands(root, pkgJson, {
      taskRunners,
      runPrefix: jsPrefix,
      ecosystemDefaults,
    }), // { lint, test, build, format } each { command, source } or null
    gitHooks: {
      manager: gitHooks.manager, // "husky" | "pre-commit" | "lefthook" | "native-git-hooks" | null
      hooksDir: gitHooks.hooksDir,
      configFile: gitHooks.configFile, // set for declarative managers
      declarative: gitHooks.declarative, // true → content describes hooks, don't execute it
      hasPreCommit: !!gitHooks.preCommit,
      hasPrePush: !!gitHooks.prePush,
      preCommitContent: gitHooks.preCommit,
      prePushContent: gitHooks.prePush,
    },
    stagedFormatter: detectStagedFormatter(root, pkgJson), // { tool: "lint-staged" | "pretty-quick" | null }
    eslint: detectEslintConfig(root), // { format: "flat" | "legacy" | null, file }
    linters, // [{ ecosystem, tool, detectedFrom }] across every stack present
    framework: detectFramework(root, pkgJson), // DEPRECATED: first of `frameworks`
    frameworks: detectFrameworks(root, pkgJson), // ["angular", "fastapi", ...] — polyglot-aware
    monorepoTool: detectMonorepoTool(root), // DEPRECATED: first of `monorepoTools`
    monorepoTools: detectMonorepoTools(root), // ["nx", "pnpm-workspaces", ...] — these coexist
    vcs: detectVcsHost(root), // { host: "gitlab" | "github" | "bitbucket" | "unknown" | null, remoteUrl }
    mrTemplate: detectMrTemplate(root), // the repo's own MR/PR description template, if it has one
    reviewChecklist: detectReviewChecklist(root), // AI-IDE instruction files containing a self-review checklist
    git: detectGit(root, ticketKeys), // branch state, conventions, dirty flag, ticket-branch lookup
    testRunner: detectTestRunner(root, pkgJson), // DEPRECATED: first of `testRunners`
    testRunners, // [{ ecosystem, tool, command }] across every stack present
    scripts: collectUsefulScripts(pkgJson), // relevant package.json scripts
  };
}
