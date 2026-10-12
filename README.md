# JiraFlow

A Kiro power for the full lifecycle of a Jira ticket: starting one (`jira-pull`: branch setup,
scope, status transition, estimate) and closing one (`jira-push`: pre-push checks, commit,
push, MR/PR, Jira transition, worklog).

Its distinguishing feature is that **nothing project-specific is hardcoded.** Fast,
deterministic helper scripts inspect the local git repository and derive the package manager, git hooks,
integration branch, branch naming prefixes, commit convention and more, so the
same workflow behaves correctly across different codebases instead of assuming
`npm`, `main`, and conventional commits.

For what each step does, see [POWER.md](POWER.md). For known gaps, see
[TODO.md](TODO.md).

> 🚀 **Team Getting Started**: Follow the step-by-step [Team Setup & Installation Guide](SETUP.md) to set up Git, `glab`, and Jira MCP in under 5 minutes.

This power is packaged to the [Agent Plugins](https://agent-plugins.org/) 1.0
standard (`plugin.json` + `skills/`) rather than anything
Kiro-specific. Kiro is what this was built and tested against, but the same
package format is also read natively by VS Code / GitHub Copilot and Antigravity.

## Requirements

| Requirement         | Needed for                                        | Notes                                                                                                         |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node`              | Running bundled helper scripts (`git-prep`, etc.) | Zero dependencies, nothing to install                                                                         |
| `git`               | Everything                                        | Standard Git install on PATH                                                                                  |
| Jira MCP server     | Reading tickets, transitions, estimates, worklogs | **Not bundled** — connect via official Atlassian Remote MCP (`mcp-remote`). See [SETUP.md](SETUP.md)          |
| `glab` CLI          | Creating merge requests on GitLab                 | **Required** for MR creation on GitLab. See [SETUP.md](SETUP.md)                                              |
| `gh` CLI            | Creating pull requests on GitHub                  | **Required** for PR creation on GitHub (if using GitHub)                                                      |

Bundled helper scripts (`git-prep.mjs`, etc.) ship directly with this power. Everything else is deliberately left to your own configuration — reasoning under Setup.

## Install

**From a GitHub URL** (Kiro's Powers panel → **Add power from GitHub** →
paste the repository URL):

```text
https://github.com/yf-tools/jira-flow
```

For a private repo, whoever you paste it as needs read access — see the repo's own access settings.

**From a local checkout** — this also works for a private repo you don't
have push access to, once someone's given you read and you've cloned it:

```bash
git clone https://github.com/yf-tools/jira-flow.git
```

Then in Kiro: Powers panel → **Add power from Local Path** → select the
cloned directory.

**Do not develop against `~/.kiro/powers/<name>/` directly.** That path is
Kiro's managed slot for the *installed* copy, and it can be overwritten by
Kiro's own install/sync process — clone and edit this repo somewhere else
(e.g. `~/dev/`), then install from that path or from GitHub.

Verify the power is active in your IDE's skills / plugins panel. You can test your setup at any time with a zero-risk dry run:

```text
/jira-pull <YOUR-TICKET-KEY> --dry-run
```

See [SETUP.md](SETUP.md) for full setup instructions and verification.

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
| Create a merge/pull request                          | The main event in `jira-push`                                             |
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
`jira-pull` workflow. To finish up, say "close ticket", "jira-push", "wrap up", or "create an
MR".

**If the agent goes straight to fetching the ticket or writing code** without
creating a branch, asking about scope/estimate/branch type, or moving the
ticket to In Progress, it activated the power but skipped reading the skill
content (`kiro_powers readSkill`). That call is mandatory before Step 1 of
either workflow — see [POWER.md](POWER.md#when-to-activate). If you see this
happen, say so; it means the agent short-circuited the workflow.

To work through review feedback on an MR that already exists, install the
separate [`gitlab-mr-review`](https://github.com/yf-tools/gitlab-mr-review)
power — that's a distinct task from the Jira ticket lifecycle this power
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
