# TODO

What's left before sharing this power with anyone else. Completed items are
dropped rather than struck through — `git log` is the record.

## Blocking

### 1. Real-ticket acceptance pass for the hardened workflows

Automated contract coverage now guards the screenshot-derived regressions: existing estimates must be shown as planned estimates (not logged time), checklist discovery must be visible, checklist edits require re-stage/re-review, one authoritative MR target drives every diff and MR proposal, validation evidence is explicit, and `--no-verify` is never disclosed remotely.

Still requires the user's controlled real-ticket acceptance run because agent behavior cannot be proven completely from Markdown policy tests:

- `jira-pull`: existing estimate; unassigned issue; subtask → Story → Epic ancestry; existing branch with no existing MR target
- `jira-push`: checklist changes a file and forces a second staged review; validation evidence; epic target preserved; private `--no-verify`
- `gitlab-mr-review`: multiple threads plus general comment; private `--no-verify`; conflicting title/branch Jira keys before worklog

### 2. Jira workflow transition edge cases

A full run against a real ticket (BIDAYA-2084) exercised Steps 1–10 successfully:
ticket validation, assignee/status checks, branch creation, the In Progress
transition, setting a 3h estimate, implementation, self-review off a
user-referenced steering file, and handoff to `jira-push` (staging, the
review checklist offer, commit, the full pre-push hook actually completing,
push, MR creation with `--reviewer` set, Jira transition to TO REVIEW, comment,
and worklog). No wrong-ticket errors, no skipped gates, no silent failures.

Fixed after this round:

- **Self-review required the user to paste a steering-file reference manually**
  (`#[[steering:workspace:...code-review-self.md]]`) — the skill never looked
  for one on its own. `jira-pull` now has an explicit Step 9.6 that searches
  for a review checklist by **description**, not filename, before offering to
  wrap up, the same discovery approach already used in `jira-push` and in
  `gitlab-mr-review`.
- **The final jira-push report was a prose paragraph.** Step 8 now has a
  structured template (MR/PR, Jira status, time logged, one block per fact)
  instead of a run-on summary.
- **Filler acknowledgments before tool calls** ("Now let me check...", "Let's
  look at...") were common throughout the run. Both skills now say explicitly
  to skip these — speak when there's a finding or a question, not before every
  action.

Still unrun:

- Step 5's two-hop transition fallback. Verified *necessary* on a real board
  (TO REVIEW offers no direct route to In Progress; `To Do` was the only valid
  intermediate of five transitions) but the path itself has never executed —
  BIDAYA-2084 had a direct `Start working` transition.
- Step 5's refusal logic for `Merged` / `Rejected` / `Blocked`. This is the one
  that matters: Jira's `statusCategory` reports "In Progress" for `Merged`,
  `Blocked` *and* the current status, so matching on category instead of
  `to.name` would mark a ticket **Merged**. Reasoned through against a real
  transition list, never executed.

Needs either a ticket whose workflow has an intermediate hop before review, or
a sandbox project set up to have one.

## Known limitations — document, don't fix

Environment and upstream issues rather than defects here. Recorded so users
don't rediscover them as bugs. Also listed in the README.

- **`glab_mr_create` (MCP) is unusable.** Fails with `fatal: not a git
  repository` before reading any parameters, because the glab MCP server has no
  repo working directory and that tool exposes no `repo` flag to compensate.
  Reproduced on two separate attempts. `jira-push` uses the `glab` CLI, which
  is why the CLI is a hard requirement.
- **`glab_api` (MCP) defaults to `gitlab.com`** regardless of the repo remote, so
  self-hosted instances need an explicit `hostname` flag or the call returns 401.
  Note the dedicated tools (`glab_mr_list`, `glab_auth_status`) don't have this
  problem.
- **`glab_api` cannot return JSON arrays** — rejects them client-side as
  `expected record, received array`, before any data is returned. List endpoints
  need a dedicated `glab_*` tool or the CLI.

## Open questions
