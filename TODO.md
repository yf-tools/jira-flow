# TODO

What's left before sharing this power with anyone else. Completed items are
dropped rather than struck through — `git log` is the record.

## Blocking

### 1. Test `new-ticket` end to end

The only surface never executed. Everything else — the scanner, and
`close-ticket`'s git and MR path — has been exercised against a real repo.

Unrun:

- Step 5, the In Progress transition itself
- Step 5's two-hop fallback. Verified *necessary* on a real board (TO REVIEW
  offers no direct route to In Progress; `To Do` was the only valid intermediate
  of five transitions) but the path has never actually run.
- Step 5's refusal logic for `Merged` / `Rejected` / `Blocked`. This is the one
  that matters: Jira's `statusCategory` reports "In Progress" for `Merged`,
  `Blocked` *and* the current status, so matching on category instead of
  `to.name` would mark a ticket **Merged**. Reasoned through against a real
  transition list, never executed.
- Step 6, setting the time estimate

Needs a real Jira write, so it needs a ticket that's safe to bounce
To Do → In Progress and back, or a sandbox project.

Track record: each of the three test rounds so far found exactly three real
bugs, two of which would have failed on first use. Assume this surface holds
more.

### 2. Pick a home, then fill in `plugin.json`

Both fields are optional in the plugin schema and both need a real URL — an
invented one that 404s is worse than an absent field.

- `repository` — where the source lives, so installers can read the code, report
  issues, or contribute. This is the one worth having.
- `homepage` — a docs or landing page. For a tool this size it's usually the same
  URL as `repository`, or just the README. Fine to omit.

Also add a git remote and push. There is currently none, so history is local
only.

## Known limitations — document, don't fix

Environment and upstream issues rather than defects here. Recorded so users
don't rediscover them as bugs. Also listed in the README.

- **`glab_mr_create` (MCP) is unusable.** Fails with `fatal: not a git
  repository` before reading any parameters, because the glab MCP server has no
  repo working directory and that tool exposes no `repo` flag to compensate.
  Reproduced on two separate attempts. `close-ticket` uses the `glab` CLI, which
  is why the CLI is a hard requirement.
- **`glab_api` (MCP) defaults to `gitlab.com`** regardless of the repo remote, so
  self-hosted instances need an explicit `hostname` flag or the call returns 401.
  Note the dedicated tools (`glab_mr_list`, `glab_auth_status`) don't have this
  problem.
- **`glab_api` cannot return JSON arrays** — rejects them client-side as
  `expected record, received array`, before any data is returned. List endpoints
  need a dedicated `glab_*` tool or the CLI.

## Open questions

- ~~**Should the bundled `atlassian` MCP server ship in a shared version?**~~
  **Decided: no, removed.** It shipped roughly 40 tool definitions for the 7 this
  power uses, tied it to Atlassian Cloud, duplicated any existing user config, and
  couldn't be cleanly disabled. The manual alternative is one paste plus one auth
  click, so optional-and-easy beat mandatory-and-hard. Setup instructions for both
  Jira and the Git host now live in the README. The full reasoning, kept because
  the disable constraints are worth not rediscovering:
  - Kiro's *Disable Server* action fails on a power-declared server with
    `Server ... not found in any MCP config file`, because it only looks in user
    settings files. This affects every power that bundles an MCP server.
  - `"disabled": true` in this power's `mcp.json` is **invalid** and was confirmed
    rejected in practice: Kiro reports `Component Issues — the MCP server
    configuration is not valid, so this server was skipped`. The plugin schema
    sets `additionalProperties: false` and `disabled` isn't a permitted key
    (stdio allows `type`, `command`, `args`, `env`, `cwd`; remote allows `type`,
    `url`, `headers`). That key belongs to Kiro's own settings format, not the
    Agent Plugins one. It does *effectively* disable the server, but only as a
    side effect of failing validation, and it leaves a standing warning — not
    something to rely on.
  - It can't be shadowed from user settings either: for `plugin.json`-format
    powers, Kiro manages bundled servers internally and doesn't write them into
    `~/.kiro/settings/mcp.json`, so there's no entry to override.
  - The documented levers are a **permissions deny rule** on
    `power-jira-ticket-workflow-atlassian/*` (gates tool invocation, not the
    server process), **Disable All Tools** in the panel, `includePowers: false`
    for all powers at once, or deleting the block. See the README for the exact
    forms.

  Shipping a dependency whose only clean removal is editing the package is still a
  poor default. Kept for now because auth turned out to be a single click, which
  was the main argument against bundling — but that argument was about
  convenience, and this one is about control.
- **Is `PROJECT_SCANNER_MIN_AUTHOR_SAMPLE` = 5 the right default?** It exists to
  stop the author-convention signal being circular — this power writes commits,
  so at n=1 the only evidence can be a commit it generated itself. 5 is a
  judgement call. Revisit with real usage data.
- **Does `--reviewer` accept a resolved username reliably?** Name *resolution*
  is verified (recent MRs give an unambiguous username where the project member
  list returns nothing), and `--assignee` is verified end to end. Passing a
  reviewer through to a created MR has not been tested, deliberately, to avoid
  notifying a real person with a test MR.
