# JiraFlow

An end-to-end Jira ticket workflow plugin for any AI assistant (Antigravity, Kiro, Claude Code, Cursor, Windsurf, VS Code):

- **`jira-create`**: create standardized, high-quality tickets with team templates, component detection, parent epic linking, and active sprint vs backlog placement.
- **`jira-pull`**: start working on a ticket with automated branch setup, active sprint verification, scope confirmation, status transition, and time estimates.
- **`jira-push`**: wrap up and close work with pre-push validation, clean commits, push, MR/PR creation, Jira transition, and worklog time tracking.

Its distinguishing feature is that **nothing project-specific is hardcoded.** Fast,
deterministic helper scripts inspect the local git repository and derive the package manager, git hooks,
integration branch, branch naming prefixes, commit convention, VCS host, detected Jira project keys, and MR templates, so the
same workflow behaves correctly across different codebases instead of assuming
`npm`, `main`, GitLab, and conventional commits.

For detailed workflow steps, see the skills in [`skills/`](skills/) ([`jira-create`](skills/jira-create/SKILL.md), [`jira-pull`](skills/jira-pull/SKILL.md), [`jira-push`](skills/jira-push/SKILL.md)).

> 🚀 **Team Getting Started**: Follow the step-by-step [Team Setup & Installation Guide](SETUP.md) to set up Git, `glab` / `gh`, and Jira MCP in under 5 minutes.

---

## 🎯 Why JiraFlow? (Problems We Faced & How It Solves Them)

### 🛠️ `jira-create` — Standardized Ticket Creation

- ❌ **The Problem We Faced:**
  - Vague, 3-word tickets like *"Button broken"* or *"Fix API"* with zero reproduction steps, missing device/OS context, and no acceptance criteria.
  - Tickets created in isolation without being linked to an Epic, without components, and left wandering in the backlog instead of the active sprint.
  - Developers waste hours in back-and-forth messages just trying to understand what the ticket requires before writing any code.

- 💡 **How It Solves It:**
  - **Enforces standard templates:** Automatically structures tickets with *Steps to Reproduce*, *Expected vs. Actual*, and *Acceptance Criteria*.
  - **Auto-detects context:** Inspects the repository to suggest matching components, queries Jira for the parent Epic, and offers to add the ticket directly into the team’s current active sprint.
  - **Ready to code:** The ticket is created with all metadata filled in, ready for instant onboarding with `jira-pull`.

---

### 📥 `jira-pull` — Ticket Onboarding & Branch Setup

- ❌ **The Problem We Faced:**
  - Every developer names branches differently (`fix-button`, `test-bug`, `PROJ-1234-some-random-slug`).
  - Developers accidentally cut branches from stale or wrong bases (e.g. cutting from `main` instead of `develop`).
  - Developers cutting branches prematurely for bugs or QA tickets that are already resolved on remote, invalid, or test-only, cluttering git with abandoned branches.
  - People start coding without assigning the ticket to themselves in Jira or forgetting to move it to *In Progress*.
  - On QA-rejected tickets, developers accidentally checkout an old branch that was already merged, resulting in messy git history.

- 💡 **How It Solves It:**
  - **Auto-detects Git conventions:** Runs an automatic check (`git-prep.mjs`) that inspects your repo to detect the integration branch (`develop` or `main`), commit conventions, and branch prefixes (`fix/`, `feature/`).
  - **Investigation & Reproduction Gate:** For bugs and QA-reported defects, pulls latest remote base first and investigates before cutting any branch. If already resolved or no code change is needed, it closes/comments on Jira with zero git pollution.
  - **Prevents merge mistakes:** Alerts you immediately if the ticket’s previous branch was already merged, proposing a clean fresh QA-fix branch instead.
  - **One-click board sync:** Assigns the ticket to you, moves it to *In Progress*, sets the time estimate, and switches branches safely in a single turn.

---

### 📤 `jira-push` — Verification, Push & MR Creation

- ❌ **The Problem We Faced:**
  - Developers accidentally pushing secret files (`.env`, private keys, or 100MB build artifacts) to GitLab/GitHub.
  - Out-of-sync branches: Pushing code after days of work only to discover merge conflicts or broken CI pipelines because new commits were merged into `develop`.
  - Forgetting to run linters/tests, discovering CI pipeline failures 15 minutes after pushing.
  - Forgetting to log time (worklog) in Jira, forgetting to transition the ticket to *In Review*, and forgetting to tag reviewers on the MR.
  - Writing tedious, empty MR descriptions like *"fixed bug"*.

- 💡 **How It Solves It:**
  - **Pre-push safety guard:** Runs `pre-push-check.mjs` to block leaks of `.env` files or secret tokens before Git touches the remote server.
  - **Base Refresh & Conflict Gate:** Checks if your branch is behind the base branch (`develop`/`main`) and offers a clean rebase or merge, resolving conflicts locally before pushing so MRs merge green.
  - **Smart reviewer lookup:** Automatically finds who actively works on these files in the repo and suggests them as reviewers on GitLab/GitHub.
  - **Full automatic wrap-up:** Pushes the branch, generates an MR with a clean description, logs your work hours to Jira, and moves the ticket to *In Review*.

---

This plugin is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/`). It works seamlessly across Windows, macOS,
and Linux on Antigravity, Kiro, Claude Code, Cursor, Windsurf, and VS Code.

## Requirements

| Requirement         | Needed for                                        | Notes                                                                                                         |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node`              | Running bundled helper scripts (`git-prep`, etc.) | Zero dependencies, nothing to install                                                                         |
| `git`               | Everything                                        | Standard Git install on PATH                                                                                  |
| Jira MCP server     | Reading tickets, transitions, estimates, worklogs | **Not bundled** — connect via official Atlassian Remote MCP (`mcp-remote`). See [SETUP.md](SETUP.md)          |
| `glab` CLI          | Creating merge requests on GitLab                 | **Required** for MR creation on GitLab. See [SETUP.md](SETUP.md)                                              |
| `gh` CLI            | Creating pull requests on GitHub                  | **Required** for PR creation on GitHub (if using GitHub)                                                      |

Bundled helper scripts (`git-prep.mjs`, etc.) ship directly with this plugin. Everything else is deliberately left to your own configuration — reasoning under Setup.

## Install

Install JiraFlow for your preferred AI coding environment:

- **Antigravity:** Copy the `jira-flow` directory to `%USERPROFILE%\.gemini\config\plugins\jira-flow` (Windows) or `~/.gemini/config/plugins/jira-flow` (macOS / Linux), or use the Plugins Manager UI.
- **Kiro:** Powers panel → **Add power from Local Path** (or **Add power from GitHub** with `https://github.com/yf-tools/jira-flow.git`).
- **Claude Code:** Load the full plugin directory with `claude --plugin-dir <path-to-jira-flow>`, or copy `skills/jira-create`, `skills/jira-pull`, and `skills/jira-push` into your global `~/.claude/skills/` (or `%USERPROFILE%\.claude\skills\` on Windows) or into your project's `.claude/skills/`.
- **Cursor:** In Settings → Plugins, click **Add plugins from folder** and select `jira-flow`, or copy to `%USERPROFILE%\.cursor\plugins\local\jira-flow`.
- **Windsurf / VS Code:** Place `jira-flow` in your project root or reference `skills/jira-create/SKILL.md`, `skills/jira-pull/SKILL.md`, and `skills/jira-push/SKILL.md` in `.windsurfrules` or `AGENTS.md`.

Verify the plugin is active in your IDE's skills / plugins panel. You can test your setup at any time with a zero-risk dry run:

```text
/jira-pull <YOUR-TICKET-KEY> --dry-run
```

See [SETUP.md](SETUP.md) for full step-by-step instructions across all IDEs and verification.

## Check your setup before the first ticket

```bash
npm run preflight
```

Runs environment diagnostics (Git, Node, `glab` / `gh`, and Atlassian MCP configuration) and verifies that all bundled helper scripts exist and function correctly.

## Automated Tests

Run the test suite using Node's native test runner (zero external dependencies):

```bash
npm test
```

## Setup

Two integrations are **not** bundled. Add them to your IDE's MCP configuration (e.g. Antigravity, Kiro, Claude Code, Cursor, or VS Code), following whatever the current install instructions are for each — this README deliberately doesn't reproduce them, because vendor endpoints and commands change and a stale snippet is worse than none.

What the plugin needs is described below as **capabilities**, not configuration.
Any server or CLI providing them will work.

### 1. Jira — required for anything ticket-related

Any MCP server exposing Jira tools that can:

| Capability                              | Used for                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| Resolve the accessible site / cloud ID  | Every other Jira call needs it                            |
| Fetch an issue                          | Reading scope, issue type, current status, sprint status  |
| Create an issue                         | Standardized ticket creation in `jira-create`             |
| Search issues (JQL)                     | Discovering project's active sprint (`openSprints()`)     |
| List available transitions for an issue | Finding a legal route to In Progress or review            |
| Apply a transition                      | Moving the ticket                                         |
| Edit issue fields                       | Setting estimate, sprint assignment, clearing resolution  |
| Add a comment                           | The summary left for the reviewer                         |
| Add a worklog                           | Logging time spent                                        |

That's the whole surface — nine capabilities. The Atlassian Cloud MCP server
provides them, and so should any equivalent, including one pointed at Jira Data
Center or Server. The skills call whatever Jira tools are present rather than
hardcoding a server name, so a different provider needs no changes here.

### 2. Your Git host — recommended

Needs to be able to:

| Capability                                           | Used for                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Create a merge/pull request                          | The main event in `jira-push`                                             |
| List merge/pull requests filtered by source branch   | Detecting an MR that already exists, so a second run doesn't duplicate it |
| List recent merge/pull requests with their reviewers | Resolving a reviewer's name to a username                                 |
| Report the authenticated username                    | Defaulting the MR assignee correctly                                      |

On GitLab and GitHub the vendor CLIs (`glab`, `gh`) cover all four once
authenticated, and both can also be exposed to your IDE as MCP servers. **MR/PR
creation currently requires the CLI regardless** — see Limitations.

On Bitbucket, expect to create the PR by hand; the workflow falls back to handing
you the link, title and description.

### Why these aren't bundled

Bundling the Atlassian server was tried and reverted:

- It shipped roughly **40 tool definitions** — Confluence CRUD, Compass, Teamwork
  Graph, Loom, search — for the **7 capabilities** above. Those schemas are large
  and cost context on every request, whether or not the session touches a ticket.
- It tied the plugin to **Atlassian Cloud**, breaking Data Center and Server users.
- It created a rigid dependency users cannot cleanly configure or disable across different IDEs, leading to duplicate connections and unnecessary context window bloat.
- Anyone who already had Atlassian configured ended up with **two connections** to
  the same service.

Against that, adding it yourself is a one-off. Optional-and-easy beats
mandatory-and-hard.

## Using it

### 1. Creating a new ticket (`jira-create`)

Say "create ticket", "file bug", "new issue", or "jira-create". The skill detects your project key from the repository, suggests issue type and components, formats the description with structured templates (Steps to Reproduce, Acceptance Criteria), discovers the active sprint, asks whether to place it in the current sprint or backlog, creates the ticket, and offers to start working on it right away.

### 2. Starting work on a ticket (`jira-pull`)

Paste a ticket key or an Atlassian issue URL, with or without other text:

```text
PROJ-1234
```

```text
https://yoursite.atlassian.net/browse/PROJ-1234
```

A bare key or URL means "start working on this ticket" and triggers the `jira-pull` workflow:

- **Investigate & Test First (Zero Wasted Branches):** When starting a Bug, QA defect (`(QA)`), or Spike, it syncs the latest remote base branch (`develop`/`main`) and offers to investigate and test before cutting any branch. If the issue is already resolved on remote or test-only, you can post a verification comment with commit evidence, log your investigation time, and resolve the ticket—**with zero git branches created**. If a code fix is confirmed, it seamlessly cuts the branch and proceeds into implementation.
- **Smart Git Setup:** Automatically detects if you are already standing on the ticket branch, offers to carry over bug reproduction edits, checks active sprint status, and cuts from the authoritative base.
- **One-Click Jira Sync:** Assigns the ticket to you, moves it to *In Progress*, sets the **Start Date** to today (`YYYY-MM-DD`), and records your planned estimate.

### 3. Wrapping up work (`jira-push`)

To finish up, say "close ticket", "jira-push", "wrap up", or "create an MR":

- **Single-Turn Unified Delivery:** Packages your staged diff, commit message, target branch, and suggested reviewers into **one single review screen**. One click on *(Recommended) Approve and execute all* executes commit, sync check, push, and MR creation in a single turn.
- **Base Refresh & Conflict Gate:** Automatically checks if your branch is behind the base branch (`origin/develop`). If new commits were merged while you worked, it offers a clean `git rebase` or `git merge` and guides you through resolving conflicts locally **before** pushing, guaranteeing MRs merge green and pass CI.
- **Smart Reviewers & Existing MR Updates:** Excludes yourself from reviewer candidates, suggests engineers who recently touched the specific files you modified, and updates existing open MRs without duplicate creation errors.
- **Complete Wrap-Up:** Moves Jira to *In Review*, normalizes shorthand worklogs (e.g. `1.5h` → `1h 30m`), and outputs a clean structured closure report.

**If the agent goes straight to fetching the ticket or writing code** without
creating a branch, asking about scope/estimate/branch type, or moving the
ticket to In Progress, it activated the plugin but skipped loading the skill
content (reading `skills/*/SKILL.md` in Antigravity, Claude Code, Cursor, Kiro, etc.).
That step is mandatory before Step 1 of any workflow. If you see this
happen, say so; it means the agent short-circuited the workflow.

To work through review feedback on an MR that already exists, install the
separate [`merge-flow`](https://github.com/yf-tools/merge-flow)
plugin — that's a distinct task from the Jira ticket lifecycle this plugin
covers, so it isn't bundled here.

## Without Jira tools

Everything local still works: branch setup, commit conventions, pre-push checks,
MR/PR handoff. The skills detect that Jira tools are missing or unauthenticated
and ask you to paste the ticket description, then hand you the status and comment
text to apply manually, rather than stalling.

## Limitations

Environment and upstream issues rather than defects here, but you'll hit them:

- **`glab_mr_create` (MCP) doesn't work.** It fails with `fatal: not a git
repository` before reading any parameters, because the glab MCP server has no
  repo working directory and that tool exposes no `repo` flag to compensate.
  `jira-push` uses the `glab` CLI instead, which is why the CLI is required.
- **`glab_api` (MCP) targets `gitlab.com`** regardless of your repo's remote, so
  self-hosted instances need an explicit `hostname` flag or the call returns 401.
  The dedicated tools (`glab_mr_list`, `glab_auth_status`) don't have this problem.
- **`glab_api` can't return JSON arrays** — it rejects them client-side as
  `expected record, received array`. List endpoints need a dedicated `glab_*` tool
  or the CLI.

## Safety behaviour

What it will and won't do on its own:

- Validates the URL/key is actually an Atlassian issue reference before resolving anything — board views, Confluence pages, filter links, and key-shaped strings that aren't tickets (`UTF-8`, `HTTP-404`) are caught immediately
- Stops on a 404 or permission error — never retries with a guessed variant of the key
- Checks the ticket's assignee against you (via `atlassianUserInfo`) — assigned to someone else is flagged as a potential typo, unassigned gets an offer to assign it
- Stops on a ticket already `Done`/`Closed`/`Merged` — starting fresh work on finished work is nearly always a wrong key
- Stops on a ticket `In Progress` under someone else — two people on one ticket is worth a question first
- On closing: stops when the branch's ticket key disagrees with the key the user named — neither wins, because either could be the mistake
- Never creates a ticket in Jira (`jira-create`) without showing you the full preview (Summary, Issue Type, Priority, Sprint, Description) first
- Never modifies or moves sprint assignments without explicit user confirmation; existing active sprints are always preserved
- Never transitions a Jira ticket without confirmation
- Never discards uncommitted work without showing you the diff first, per file
- Never switches branches over a dirty tree without warning
- Never creates an MR without showing you the exact title, description, target,
  assignee and reviewer first
- Never picks `--no-verify` itself; when a pre-push hook runs a full build it hands
  you the choice. If selected, it remains private execution detail and is never
  written to an MR/PR, thread, comment, or Jira update
- Uses one confirmed MR/PR target consistently for diff review and creation
- Shows diagnostics, targeted tests, lint, smoke-test and build evidence before commit
- Discovers review conventions by reading each candidate file's **description** rather than matching on filenames — a checklist called `pre-flight.md` is found as reliably as one called `code-review.md`, and it's offered to you before being applied
- Reports failures as failures — it won't claim a transition or MR succeeded when
  it errored

## Best Practices

- Run `git-prep.mjs` at the start of a ticket workflow before assuming any branch name or commit format
- Nothing project-specific is hardcoded: the Jira prefix comes from the actual ticket key, and the integration branch, branch prefixes, and commit format come from the repository
- Treat `git.integrationBranch` as a candidate, not proof of intent. Existing MR/PR base wins; otherwise use the epic-aware target explicitly confirmed with the user and preserve that `{TARGET}` through review and MR creation
- Ask for explicit confirmation before any Jira status transition — never transition automatically
- Ask before discarding uncommitted work. The only destructive step in these workflows requires showing the diff and getting per-file confirmation first
- The navigation guide in `jira-pull` applies to tickets with a reachable screen or flow; it's skipped for tooling, CI, dependency and pure-refactor work

## Licence

MIT — see [LICENSE](LICENSE).
