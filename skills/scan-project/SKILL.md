---
name: scan-project
description: Detect a project's real tooling across ten language ecosystems (JavaScript, Python, Rust, Go, Java, Ruby, PHP, .NET, Dart, Elixir) — ready-to-run lint/test/build/format commands, package managers, task runners (make/just/task), git hooks, linters, frameworks, monorepo tools, test runners, VCS host, and git conventions (current/default/integration branch, branch naming prefixes, commit message format, dirty tree) — by scanning its filesystem and git history instead of guessing or hardcoding assumptions. Use before running any build or lint command, creating a branch, writing a commit message, checking git hooks, or referencing project-specific tooling in a workflow meant to work across different projects.
---

# Scan Project Conventions

Generic ticket/workflow skills (e.g. a "start new ticket" or "close ticket" workflow) often need to know project-specific details: which package manager to use, what the pre-commit hook actually runs, whether ESLint uses flat config or legacy `.eslintrc`, what framework/monorepo tool is in play, which Git host (GitLab/GitHub/Bitbucket) the project uses, which branch feature work is cut from, how branches are named, and what shape commit messages take.

Rather than hardcoding these assumptions per-project (which breaks the moment a workflow is reused elsewhere) or asking the user every time, call the `get_project_profile` MCP tool from this plugin's `project-scanner` server to get real, verified answers by scanning the actual filesystem.

## When to use

Call this once at the start of any generic workflow that needs to reference project-specific tooling — before assuming a package manager, before checking what a git hook runs, before writing ESLint config edits, or before deciding whether a framework-specific step applies.

## Tool: `get_project_profile`

> Tool name and parameters are `snake_case`; the returned profile uses `camelCase` field names, matching the `package.json` keys it reports on.

**Parameters:**
- `workspace_path` (optional string) — absolute path to the project root. Always pass the actual workspace root explicitly rather than relying on the default.
- `ticket_keys` (optional string array) — ticket keys to look up against existing branches, e.g. `["PROJ-716", "PROJ-241"]`. Populates `git.ticketBranches`. Pass the ticket you're starting **and** its parent epic: the first tells you whether a branch already exists so you don't create a duplicate, the second tells you whether the epic has a branch to cut from. Matching happens in code and is exact — `PROJ-24` will not match `feature/PROJ-241`.

**Returns** a JSON profile:

**Read `commands` first.** It answers "how do I lint/test/build here" in one field for
any ecosystem. The per-tool fields below exist for when you need to know *which*
linter's rules a fix has to satisfy, not just how to invoke it.

| Field | Description |
|---|---|
| `commands.lint` / `.test` / `.build` / `.format` | `{ command, source }` or `null`. **The command to actually run.** Resolves via task-runner target → package script → ecosystem default, so it works on a Rust or Python repo as well as a JS one. `source` says where it came from (`Makefile:lint`, `package.json:scripts.lint`, `ruff (pyproject.toml)`) |
| `ecosystems` | `[{ id, detectedFrom }]` — every stack present: `javascript`, `python`, `rust`, `go`, `java`, `ruby`, `php`, `dotnet`, `dart`, `elixir`. Empty array for an unrecognised stack |
| `taskRunners` | `[{ tool, file, invoke, targets[] }]` for `make` / `just` / `task`. `targets` is parsed from the file, so you can check a target exists before calling it |
| `packageManagers` | `[{ ecosystem, name, source, runPrefix }]` — one per ecosystem. `runPrefix` is `null` for `cargo`/`go`/`maven`/`gradle`/`dotnet`, which have no user-scripts concept: use `commands` for those, never `runPrefix + name` |
| `packageManager.name` | **Deprecated.** First of `packageManagers`, JS preferred. `pnpm` \| `yarn` \| `bun` \| `npm` \| `null` |
| `packageManager.runCommandPrefix` | **Deprecated.** e.g. `"pnpm run"` — prefix to run any script from `scripts` |
| `gitHooks.manager` | `husky` \| `pre-commit` \| `lefthook` \| `overcommit` \| `native-git-hooks` \| `null` |
| `gitHooks.declarative` | `true` for `pre-commit`/`lefthook`/`overcommit` — the content is **YAML describing** hooks, not a script. Read it to see what will run; don't try to execute it |
| `gitHooks.configFile` | Which config file the declarative manager uses |
| `gitHooks.preCommitContent` / `prePushContent` | Hook script contents for husky/native. For declarative managers both hold the same config file text |
| `stagedFormatter.tool` | `lint-staged` \| `pretty-quick` \| `null` |
| `eslint.format` | `flat` \| `legacy` \| `null` |
| `linters` | `[{ ecosystem, tool, detectedFrom }]` across every stack: `eslint`, `prettier`, `biome`, `ruff`, `black`, `flake8`, `mypy`, `isort`, `pylint`, `clippy`, `rustfmt`, `golangci-lint`, `gofmt`, `ktlint`, `spotless`, `checkstyle`, `rubocop`, `php-cs-fixer`, `phpcs`, `phpstan`, `dotnet-format`, `dart-format`, `mix-format`, `credo` |
| `frameworks` | Array — **every** framework present. `angular`, `next`, `nuxt`, `sveltekit`, `vue`, `react`, `django`, `fastapi`, `flask`, `rails`, `spring`, `actix`, `axum`, `laravel`, `symfony`, `aspnet`, `flutter`, `phoenix`. A polyglot monorepo genuinely has several |
| `framework` | **Deprecated.** First entry of `frameworks`. Only correct on a single-stack repo |
| `monorepoTools` | Array — these coexist. `nx`, `turborepo`, `lerna`, `pnpm-workspaces`, `npm-workspaces`, `rush`, `cargo-workspaces`, `go-workspaces`, `melos` |
| `monorepoTool` | **Deprecated.** First entry of `monorepoTools` |
| `vcs.host` | `gitlab` \| `github` \| `bitbucket` \| `unknown` \| `null` |
| `vcs.remoteUrl` | The actual `git remote origin` URL |
| `mrTemplate.kind` | `gitlab-mr` \| `github-pr` \| `null` — which template convention the repo uses |
| `mrTemplate.dir` / `.files` | Where the templates live and their filenames. Several entries means the repo offers named templates (`Bugfix.md`, `Feature.md`…) |
| `mrTemplate.defaultFile` | The one to use without asking: GitLab's `Default.md`, or a lone template. `null` when several exist and none is the default — ask the user which |
| `mrTemplate.content` | Full text of the default template, ready to fill in. `null` when there's no template or no clear default. **Use this instead of writing a generic MR body** — it carries the sections and checklists the team requires |
| `testRunners` | `[{ ecosystem, tool, command }]` across every stack. `command` is ready to run: `vitest run`, `pytest`, `cargo test`, `go test ./...`, `mvn test`, `bundle exec rspec`, `dotnet test`, `flutter test`, `mix test` |
| `testRunner` | **Deprecated.** First entry of `testRunners`, JS preferred |
| `scripts` | Relevant `package.json` scripts (lint/build/test/format/check/e2e). JavaScript only — use `commands` for other ecosystems |

### Git state and conventions (`git`)

| Field | Description |
|---|---|
| `git.isGitRepo` | `false` for a non-repo directory; every other git field is then `null` |
| `git.currentBranch` | Current branch name, or `null` in detached HEAD |
| `git.detached` | `true` when HEAD is detached |
| `git.currentBranchTicketKey` | Ticket key embedded in the branch name, e.g. `PROJ-1234` |
| `git.currentBranchProjectPrefix` | Just the prefix, e.g. `PROJ` — use to catch project mismatches |
| `git.defaultBranch` | What `origin/HEAD` points at, e.g. `main` |
| `git.integrationBranch` | Where feature work should branch from and merge back into. Prefers an existing `develop`/`development`/`dev` over `defaultBranch`, because Git Flow repos branch off `develop` even though `origin/HEAD` points at `main` |
| `git.integrationBranchSource` | Why that branch was chosen (`default-branch` or `found-branch:develop`) |
| `git.branchNaming.observedPrefixes` | Real prefix counts across existing branches, e.g. `[{prefix:"feature",count:12},{prefix:"fix",count:5}]` |
| `git.branchNaming.dominantPrefixes` | Top prefixes, ready to offer the user as branch-type options |
| `git.branchNaming.usesTicketKeyInBranch` | Whether this repo embeds ticket keys in branch names at all |
| `git.branchNaming.ticketKeyCase` | `upper` \| `lower` \| `null` — match the repo's casing |
| `git.commitConvention.pattern` | `conventional-commits` \| `ticket-key-prefix` \| `mixed-or-freeform` \| `null` |
| `git.commitConvention.suggestedFormat` | A ready-to-use template, e.g. `{type}({TICKET-KEY}): short description`. `null` means no convention could be inferred — ask the user rather than inventing one |
| `git.commitConvention.observedTypes` | Which conventional types this repo actually uses, with counts |
| `git.commitConvention.conventionalRatio` | Fraction of the whole sample matching conventional commits |
| `git.commitConvention.recentConventionalRatio` | Same fraction over the newest commits only. Conventions get adopted over time, so a repo that switched recently shows a low overall ratio but a high recent one — either signal being strong is enough to report `conventional-commits` |
| `git.commitConvention.scopedCount` | How many conventional commits carry a scope at all |
| `git.commitConvention.usesTicketKeyInScope` | Of the commits that carry a scope, whether that scope is usually a ticket key. `null` when nothing is scoped — which is different from `false`, meaning "scoped, but not with ticket keys" |
| `git.commitConvention.samples` | Recent subject lines, for when you need to judge style yourself |
| `git.commitConvention.author` | The same analysis restricted to the current git user, or `null` if they have no commits here. A repo can be mixed overall while one contributor is perfectly consistent — when repo-wide `suggestedFormat` is `null`, check this before asking the user |
| `git.commitConvention.author.lowConfidence` | `true` when the author has fewer than `minSampleForSuggestion` commits here. In that case `author.suggestedFormat` is deliberately `null`: this power writes commits itself, so with one or two samples the only evidence can be a commit the workflow generated, and a suggestion from it would be circular. `sampleSize`, `pattern` and `conventionalRatio` stay visible so you can see how thin the evidence is |
| `git.commitConvention.author.minSampleForSuggestion` | The threshold used, so callers don't hardcode it. Defaults to 5; override with the `PROJECT_SCANNER_MIN_AUTHOR_SAMPLE` env var |
| `git.user` | `{name, email}` from git config. This is the **commit** identity and often differs from the VCS host username (e.g. `janedoe` vs the GitLab account `jane.doe`), so don't use it as an MR assignee — resolve that from the host |
| `git.isDirty` | `true` when the working tree has uncommitted changes |
| `git.ticketBranches` | `null` unless `ticket_keys` was passed. Otherwise an object keyed by ticket key, each with `exists`, `local[]`, `remote[]`, `localOnly`, `remoteOnly`. Use it to avoid creating a branch that already exists, and to find out whether a parent epic has a branch worth cutting from. `localOnly` means don't try to pull; `remoteOnly` means check out tracking the remote |

Branch naming and commit convention are inferred from what's already in the repo (`git branch`, `git log`), so they reflect real practice rather than a documented ideal. Both report `sampleSize` — treat a low sample size as weak evidence and confirm with the user.

## Example call

```
get_project_profile({ workspace_path: "/absolute/path/to/project" })
```

Example response (truncated):
```json
{
  "ecosystems": [
    { "id": "javascript", "detectedFrom": "package.json" },
    { "id": "python", "detectedFrom": "pyproject.toml" }
  ],
  "commands": {
    "lint": { "command": "make lint", "source": "Makefile:lint" },
    "test": { "command": "pnpm run test", "source": "package.json:scripts.test" },
    "build": { "command": "make build", "source": "Makefile:build" },
    "format": { "command": "ruff format .", "source": "ruff (pyproject.toml)" }
  },
  "taskRunners": [
    { "tool": "make", "file": "Makefile", "invoke": "make", "targets": ["build", "lint", "test"] }
  ],
  "packageManagers": [
    { "ecosystem": "javascript", "name": "pnpm", "source": "lockfile:pnpm-lock.yaml", "runPrefix": "pnpm run" },
    { "ecosystem": "python", "name": "uv", "source": "lockfile:uv.lock", "runPrefix": "uv run" }
  ],
  "packageManager": { "name": "pnpm", "runCommandPrefix": "pnpm run" },
  "gitHooks": { "manager": "husky", "declarative": false, "hasPreCommit": true, "preCommitContent": "...pnpm run prettier:staged..." },
  "stagedFormatter": { "tool": "pretty-quick", "scriptName": "prettier:staged" },
  "eslint": { "format": "flat", "file": "eslint.config.js" },
  "linters": [
    { "ecosystem": "javascript", "tool": "eslint", "detectedFrom": "eslint.config.js" },
    { "ecosystem": "python", "tool": "ruff", "detectedFrom": "pyproject.toml" }
  ],
  "frameworks": ["angular", "fastapi"],
  "framework": "angular",
  "monorepoTools": ["nx", "pnpm-workspaces"],
  "monorepoTool": "nx",
  "testRunners": [
    { "ecosystem": "javascript", "tool": "vitest", "command": "vitest run" },
    { "ecosystem": "python", "tool": "pytest", "command": "pytest" }
  ],
  "vcs": { "host": "gitlab", "remoteUrl": "https://git.example.com/org/repo.git" },
  "git": {
    "isGitRepo": true,
    "currentBranch": "feature/PROJ-1003",
    "detached": false,
    "currentBranchTicketKey": "PROJ-1003",
    "currentBranchProjectPrefix": "PROJ",
    "defaultBranch": "main",
    "integrationBranch": "develop",
    "integrationBranchSource": "found-branch:develop",
    "branchNaming": {
      "observedPrefixes": [{ "prefix": "feature", "count": 1 }, { "prefix": "fix", "count": 1 }],
      "dominantPrefixes": ["feature", "fix"],
      "usesTicketKeyInBranch": true,
      "ticketKeyCase": "upper"
    },
    "commitConvention": {
      "pattern": "conventional-commits",
      "suggestedFormat": "{type}({TICKET-KEY}): short description",
      "observedTypes": [{ "type": "feat", "count": 1 }, { "type": "fix", "count": 1 }]
    },
    "isDirty": true
  },
  "testRunner": "jest",
  "scripts": { "lint": "...", "build": "...", "prettier:staged": "pretty-quick --staged" }
}
```

## How to use the result

- **Prefer `commands.lint` / `.test` / `.build` / `.format` over assembling a command yourself.** It already applied the right precedence and works on every ecosystem. Only fall back to `packageManager.runCommandPrefix` + `scripts` when `commands` returns `null` for the task you need
- Never hardcode `pnpm`/`npm`/`yarn` — and never build `runPrefix + script` for a `cargo`/`go`/`maven`/`gradle`/`dotnet` project. Those have `runPrefix: null` because they have no user-scripts concept; `commands` is the only correct source there
- Before committing, if `gitHooks.preCommitContent` reveals a formatter step, run the equivalent command yourself first (from `stagedFormatter` / `scripts`) so the actual git hook becomes a fast no-op instead of hanging. When `gitHooks.declarative` is `true` the content is YAML listing hooks rather than a script — read it to see what will run, don't execute it
- Use `eslint.format` to know whether to write flat-config or legacy-config syntax if editing lint rules
- Use `vcs.host` to decide whether MR terminology (GitLab) or PR terminology (GitHub) applies, and which CLI (`glab` vs `gh`) is relevant
- Use `frameworks` / `monorepoTools` to decide whether framework-specific steps (e.g. an Angular-only lint helper) are even applicable — skip them entirely if no detected framework matches. **Check the arrays, not the deprecated singular fields**: a repo with an Angular frontend and a FastAPI backend reports both, and `framework` alone would hide half the codebase from you
- Branch off `git.integrationBranch`, not a hardcoded `develop` or `main` — the two differ in Git Flow repos, which is exactly the case that silently produces a branch off the wrong base
- Offer branch types from `git.branchNaming.dominantPrefixes` instead of assuming `feature`/`fix`; a repo using `feat/` or `bugfix/` will reject the assumption at review time, not before
- Write commit messages from `git.commitConvention.suggestedFormat`. If `pattern` is `mixed-or-freeform`, there's no convention to follow — ask the user once rather than inventing one
- Check `git.isDirty` before any checkout or branch switch, and `git.detached` before any commit or push
- Compare `git.currentBranchProjectPrefix` against the ticket you were given: a mismatch usually means the wrong repo or an unfinished branch switch, and is worth stopping over

## Best practices

- Call `get_project_profile` once per session/workflow start rather than re-scanning repeatedly — the project's tooling doesn't change mid-session
- Treat `null` fields as "not detected" — don't assume a default; ask the user or skip that step if a workflow depends on it
- Prefer the raw `preCommitContent`/`prePushContent` over assumptions — parse the actual script to find the real command being run, since hook scripts can be customized beyond the detected `stagedFormatter` tool
- This scans the filesystem only — it does not execute any project code or install anything

## Troubleshooting

**Tool returns `{ "error": "Path does not exist: ..." }`**
The `workspace_path` argument doesn't point to a real directory. Pass the actual absolute workspace root.

**All fields come back `null`**
The path may point to a subdirectory rather than the actual project root (e.g. a monorepo package instead of the repo root). Try scanning the top-level root instead.

**All `git.*` fields are `null` but the project is a git repo**
The scanner shells out to `git`, resolving it to an absolute path from the standard install locations and falling back to a `PATH` lookup. If git is installed somewhere unusual, set `PROJECT_SCANNER_GIT_PATH` to its full path. Check `git --version` first. This also happens when scanning a path inside the repo that isn't the work tree.

**Response has no `git` key at all**
The running server process predates the git-detection feature. Reconnect the `project-scanner` MCP server (MCP Server view in the Kiro feature panel) so it restarts with the current code.

**Server doesn't start / no response**
Confirm Node.js is on PATH (`node --version`). The server has no other dependencies.
