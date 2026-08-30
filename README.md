# Jira Ticket Workflow

A Kiro power for the full lifecycle of a Jira ticket: starting one (branch setup,
scope, status transition, estimate) and closing one (pre-push checks, commit,
push, MR/PR, Jira transition, worklog).

Its distinguishing feature is that **nothing project-specific is hardcoded.** A
bundled MCP server scans the repo and derives the package manager, git hooks,
integration branch, branch naming prefixes, commit convention and more, so the
same workflow behaves correctly across different codebases instead of assuming
`npm`, `main`, and conventional commits.

Detection is **not JavaScript-only.** The scanner recognises ten ecosystems
(JavaScript, Python, Rust, Go, Java/Kotlin, Ruby, PHP, .NET, Dart, Elixir) and
reports frameworks, monorepo tools and test runners as _arrays_, because a real
monorepo has an Angular frontend beside a FastAPI service and naming one of them
hides the other. It also resolves a `commands` block — ready-to-run lint, test,
build and format — by checking the repo's own task runner (`make`, `just`,
`task`) before any package script, and a generic default last. That ordering is
what lets the workflow verify a change on a stack whose linters it has never
heard of: if the repo exposes `make lint`, that is the command, whatever language
sits underneath.

For what each step does, see [POWER.md](POWER.md). For known gaps, see
[TODO.md](TODO.md).

This power is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/` + `mcp.json`) rather than anything
Kiro-specific. Kiro is what this was built and tested against, but the same
package format is also read natively by VS Code / GitHub Copilot. Support in
other clients isn't verified here — check what a given client actually
supports before assuming it'll load.

## Requirements

| Requirement         | Needed for                                        | Notes                                                                                                         |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node`              | The bundled `project-scanner` MCP server          | Zero dependencies, nothing to install                                                                         |
| `git`               | Everything                                        | Resolved from standard install locations, not `PATH`. Set `PROJECT_SCANNER_GIT_PATH` if yours lives elsewhere |
| Jira MCP server     | Reading tickets, transitions, estimates, worklogs | **Not bundled** — add it yourself, see Setup. Degrades gracefully without it                                  |
| `glab` CLI          | Creating merge requests on GitLab                 | **Required** for MR creation on GitLab. The `glab_mr_create` MCP tool doesn't work — see Limitations          |
| `gh` CLI            | Creating pull requests on GitHub                  | **Required** for PR creation on GitHub                                                                        |
| Git host MCP server | Finding existing MRs, resolving reviewer names    | **Not bundled** — optional but recommended, see Setup                                                         |

Only `project-scanner` ships with this power. Everything else is deliberately left
to your own configuration — reasoning under Setup.

## Install

**From a GitHub URL** (Kiro's Powers panel → **Add power from GitHub** →
paste the repository URL). For a private repo, whoever you paste it as needs
read access — see the repo's own access settings.

**From a local checkout** — this also works for a private repo you don't
have push access to, once someone's given you read and you've cloned it:

```bash
git clone <repository-url>
```

Then in Kiro: Powers panel → **Add power from Local Path** → select the
cloned directory.

**Do not develop against `~/.kiro/powers/<name>/` directly.** That path is
Kiro's managed slot for the *installed* copy, and it can be overwritten by
Kiro's own install/sync process — clone and edit this repo somewhere else
(e.g. `~/dev/`), then install from that path or from GitHub.

Either way, reconnect from the **MCP Servers** view in the Kiro feature panel.
One entry should appear:

- `power-jira-ticket-workflow-project-scanner` (1 tool)

Verify it by asking Kiro:

> run get_project_profile on this workspace

You should get a JSON profile with `packageManager`, `git`, `vcs` and so on. If
the response has no `git` key, the server process is stale — reconnect it.

## Setup

Two integrations are **not** bundled. Add them to your own Kiro MCP config
(`~/.kiro/settings/mcp.json` for every workspace, `.kiro/settings/mcp.json` for
one), following whatever the current install instructions are for each — this
README deliberately doesn't reproduce them, because vendor endpoints and commands
change and a stale snippet is worse than none.

What the power needs is described below as **capabilities**, not configuration.
Any server or CLI providing them will work.

### 1. Jira — required for anything ticket-related

Any MCP server exposing Jira tools that can:

| Capability                              | Used for                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| Resolve the accessible site / cloud ID  | Every other Jira call needs it                            |
| Fetch an issue                          | Reading scope, issue type, current status                 |
| List available transitions for an issue | Finding a legal route to In Progress or review            |
| Apply a transition                      | Moving the ticket                                         |
| Edit issue fields                       | Setting the time estimate; clearing a blocking resolution |
| Add a comment                           | The summary left for the reviewer                         |
| Add a worklog                           | Logging time spent                                        |

That's the whole surface — seven capabilities. The Atlassian Cloud MCP server
provides them, and so should any equivalent, including one pointed at Jira Data
Center or Server. The skills call whatever Jira tools are present rather than
hardcoding a server name, so a different provider needs no changes here.

### 2. Your Git host — recommended

Needs to be able to:

| Capability                                           | Used for                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Create a merge/pull request                          | The main event in `close-ticket`                                          |
| List merge/pull requests filtered by source branch   | Detecting an MR that already exists, so a second run doesn't duplicate it |
| List recent merge/pull requests with their reviewers | Resolving a reviewer's name to a username                                 |
| Report the authenticated username                    | Defaulting the MR assignee correctly                                      |

On GitLab and GitHub the vendor CLIs (`glab`, `gh`) cover all four once
authenticated, and both can also be exposed to Kiro as MCP servers. **MR/PR
creation currently requires the CLI regardless** — see Limitations.

On Bitbucket, expect to create the PR by hand; the workflow falls back to handing
you the link, title and description.

### Why these aren't bundled

Bundling the Atlassian server was tried and reverted:

- It shipped roughly **40 tool definitions** — Confluence CRUD, Compass, Teamwork
  Graph, Loom, search — for the **7 capabilities** above. Those schemas are large
  and cost context on every request, whether or not the session touches a ticket.
- It tied the power to **Atlassian Cloud**, breaking Data Center and Server users.
- It created a dependency users **cannot cleanly disable**. Kiro's _Disable
  Server_ action fails on power-declared servers (`Server ... not found in any MCP
config file`), `"disabled": true` is invalid in a power's `mcp.json` and gets the
  server skipped with a standing warning, and for `plugin.json`-format powers Kiro
  manages bundled servers internally rather than writing them into your settings,
  so there's nothing to override by name.
- Anyone who already had Atlassian configured ended up with **two connections** to
  the same service.

Against that, adding it yourself is a one-off. Optional-and-easy beats
mandatory-and-hard.

## Using it

Paste a ticket key or an Atlassian issue URL, with or without other text:

```text
PROJ-1234
```

```text
https://yoursite.atlassian.net/browse/PROJ-1234
```

A bare key or URL means "start working on this ticket" and triggers the
`new-ticket` workflow. To finish up, say "close ticket", "wrap up", or "create an
MR".

To work through review feedback on an MR that already exists, install the
separate [`gitlab-mr-review`](https://github.com/yf-tools/gitlab-mr-review)
power — that's a distinct task from the Jira ticket lifecycle this power
covers, so it isn't bundled here.

**After changing anything under `server/`, reconnect `project-scanner`.** The
running process keeps serving the old code otherwise, including the old tool
schema. This is the single most common source of confusion when developing the
power.

The server is two files. `server.js` is the entry point and owns only the
JSON-RPC transport; `scanner.js` holds every detection function and is pure. Run
`node test.mjs` from `server/` before and after any change — it drives the real
stdio protocol _and_ imports `scanner.js` directly, then asserts both paths
return an identical profile.

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
  `close-ticket` uses the `glab` CLI instead, which is why the CLI is required.
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

## Licence

MIT — see [LICENSE](LICENSE).
