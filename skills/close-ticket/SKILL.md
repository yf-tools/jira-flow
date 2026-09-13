---
name: close-ticket
description: Ticket closing workflow — final checks, commit, push, and MR/PR creation. Use when the user says they're closing/finishing/wrapping up a ticket, is done with a ticket, wants to create an MR, push, or merge/pull request, or pastes a Jira/Atlassian issue URL (e.g. https://*.atlassian.net/browse/PROJ-1234) alongside closing intent.
---

# Ticket Workflow — Closing a Jira Ticket

When the user says they're done with a ticket or wants to close/wrap up, follow this workflow.

**Skip filler acknowledgments before a tool call.** "Now let me check for an existing MR," "Let me stage the files," "Let's run the formatter" — the tool call itself already shows progress; a sentence announcing it first adds nothing. Speak when you have something to report (a finding, a decision, a question), not before every action leading up to it.

## Mistakes a user can hand you — check for these before acting

Closing writes to shared state: a commit, a push, an MR other people get notified about, a ticket transition the board reflects. A wrong ticket key or a wrong branch here is more expensive than in `new-ticket`, because most of it can't be quietly undone.

Each case says whether to **stop** (wait for an answer) or **flag** (say it and continue).

| What's wrong | Where | Do this |
| --- | --- | --- |
| URL isn't an Atlassian issue link, or key isn't `{PREFIX}-{NUMBER}` | Step 0 | 🛑 **Stop** — don't guess a key |
| Ticket doesn't exist (404) or you can't access it | Step 0 | 🛑 **Stop** |
| Ticket key from the branch ≠ the ticket the user named | Step 1 | 🛑 **Stop** — one of the two is wrong, and you can't tell which |
| Ticket is assigned to someone else | Step 0 | ⚠️ **Flag** — you're about to comment and transition it |
| Ticket is already `Done` / `Merged` / `Closed` | Step 0, re-checked at Step 6 | 🛑 **Stop** — don't re-transition finished work |
| On the integration branch, or another ticket's branch | Step 1 | 🛑 **Stop** |
| Different project prefix on the branch | Step 1 | 🛑 **Stop** — usually the wrong repo |
| Detached HEAD | Step 1 | 🛑 **Stop** |
| Nothing to commit (clean tree, no unpushed commits) | Steps 2–3 | ⚠️ **Flag** — say there's nothing to close and ask what they expected |
| An MR already exists for this branch | Step 5 | ⚠️ **Flag** — update it, don't open a second |

The 🛑 cases in Steps 0–1 must be settled **before** Step 2 stages anything. After that point every step already has its own gate, so fold the rest into those rather than adding pauses.

## Step 0 — Scan the Project and Resolve Jira Context (ALWAYS FIRST)

Call the `get_project_profile` MCP tool (from the `project-scanner` server bundled with this power) with the workspace root path. **Everything project-specific below comes from this scan.**

**Scan fresh — do not reuse a profile from earlier in the session.** If `new-ticket` ran before this, its profile is definitely stale: a branch was created and files were edited since. `git.currentBranch`, `git.isDirty` and `git.ticketBranches` would all be wrong, and Step 1 verifies the branch using exactly those values. The stable fields (package manager, hooks, framework) don't change, but the git ones are the whole basis of the checks below.

### Resolve `cloudId` here, not later

Every Atlassian tool call takes a required `cloudId`, and **Step 5 needs it too** — the MR/PR description links back to the ticket, which means knowing the site URL before the MR is created. Resolve it once now:

1. If you have a ticket URL like `https://yoursite.atlassian.net/browse/PROJ-123`, try the hostname (`yoursite.atlassian.net`) as `cloudId` directly — this usually works.
2. If you only have a bare ticket key, or that fails, call `getAccessibleAtlassianResources` to list reachable sites and pick the matching one. If several could match, ask the user rather than guessing.
3. The ticket key itself normally comes from `git.currentBranchTicketKey` in the scan — no need to ask if the branch already embeds it.

Keep the resolved `cloudId` and the ticket's browse URL for use in Steps 5, 6 and 7.

**If the user gave a URL or key, check it's actually an Atlassian issue reference first** — shape `https://{site}.atlassian.net/browse/{PREFIX}-{NUMBER}`, or a bare `{PREFIX}-{NUMBER}`. A board view, filter, Confluence page, or a key-shaped string that isn't a ticket (`UTF-8`, `HTTP-404`) is not something to extract a key from. 🛑 Stop and ask rather than acting on a partial match.

**Then read the ticket and check it's yours to close.** You're about to comment on it and move it on the board, so use `getJiraIssue` with `fields: ["*all"]` and `expand: "names"`, plus `atlassianUserInfo`. Rebuild the decision-relevant context (assignee/status, hierarchy, links, acceptance criteria and `timetracking`) rather than relying on stale values from `new-ticket`.

- **Read failed (404 / permission)** — 🛑 **Stop.** Wrong key or wrong site. Don't retry with a guessed variant; say what you tried and ask.
- **Assigned to someone else** — ⚠️ **Flag it.** *"`PROJ-420` is assigned to {name}, not you — I'm about to comment and transition it. Flagging in case that's not the ticket you meant."* Continue unless they correct you.
- **Already in a `done` category** (`Done`, `Merged`, `Closed`) — 🛑 **Stop** before Step 6 tries to transition it again. Say so and ask whether the work should go somewhere else, or whether this is the wrong ticket.

### Establish the authoritative `{TARGET}` before reviewing any diff

Check for an existing open MR/PR for the current branch now, not after commit/push:

1. Existing MR/PR → its target/base is authoritative.
2. No MR/PR, same session as `new-ticket`, and the branch was created there → reuse the explicitly confirmed `{TARGET}`.
3. Otherwise → ask the user to confirm the target. `git.integrationBranch` is only a proposal; branch existence and merge-base heuristics do not prove intent.

Use this one `{TARGET}` for every comparison, staged summary, MR/PR proposal and final report. Never review against `develop` and later create an MR to an epic branch.

Before any target-relative diff, refresh the authoritative remote ref with `git fetch origin {TARGET}` and compare against `origin/{TARGET}`. If `{TARGET}` intentionally has no remote ref, verify that explicitly and use the named local ref; never silently compare against a stale local branch.

The fields this workflow depends on:

| Field | Used for |
| --- | --- |
| `git.currentBranch` | Step 1 branch verification |
| `git.currentBranchTicketKey` / `currentBranchProjectPrefix` | Detecting a ticket/branch mismatch |
| `git.integrationBranch` | Candidate target when no existing MR/PR or confirmed epic target exists; Step 0 establishes authoritative `{TARGET}` before diff review |
| `git.commitConvention.suggestedFormat` | The commit message shape this repo actually uses |
| `git.isDirty` | Whether there's anything to commit |
| `gitHooks.preCommitContent` / `prePushContent` | What the hooks will run, so you can pre-empt them |
| `stagedFormatter.tool` | Which staged-file formatter to run before committing |
| `commands.lint` / `.test` / `.format` | Verification commands — resolve on any ecosystem, not just JavaScript |
| `packageManager.runCommandPrefix` | Script invocation when `commands` has no entry (JavaScript only) |
| `gitHooks.declarative` | `true` → hook content is YAML describing hooks, not a script to run |
| `vcs.host` | "MR" (GitLab) vs "PR" (GitHub/Bitbucket) terminology |
| `mrTemplate` | The repo's own MR/PR description template — use it instead of a generic body (Step 5) |

If the scanner is unavailable, fall back to plain git commands and **ask the user** for the target branch and commit convention instead of assuming.

### Ticket key format is dynamic

Use whatever prefix appears in the actual ticket key — `PROJ-1234`, `ABC-482`, whatever the user gives you — consistently across branch name, commit message, and MR/PR title. Never hardcode or carry over a prefix from a previous project.

## Step 1 — Verify Branch

### If commits already exist that you didn't gate

This skill's value is the checks in Step 2, and they only work if they run
*before* the commit. If you arrive and find the ticket's work already committed —
because a previous turn ran `git commit` without going through this skill — don't
just carry on to the push.

Say so, then run the Step 2 checks against the committed changes instead of the
working tree:

- `git show --stat HEAD` and `git diff origin/{TARGET}...HEAD` (or the explicitly verified local-only `{TARGET}` ref) in place of
  a staged diff
- Look for linter/formatter config and anything secret-shaped **in the commits**,
  not just uncommitted files
- Get the user's confirmation on that diff before pushing

The checks are still worth running late. What isn't acceptable is skipping them
because a commit already happened.

### Branch identity

**If the user named a ticket AND the branch embeds a different one, stop.** This is the highest-value check in the step, because both values look authoritative and you can't tell which is wrong: they may be on the wrong branch, or they may have typed the wrong key. Either way, guessing picks one and commits real work against it.

> ⚠️ You asked me to close `{USER-KEY}`, but this branch is `{currentBranch}` — ticket `{BRANCH-KEY}`. Which is right: am I on the wrong branch, or is that the wrong ticket key?

Wait for an answer. Don't resolve it by preferring the branch (it might be a leftover checkout) or by preferring what the user typed (it might be a typo) — the point is that the two disagree.

When the user gave no key at all, `git.currentBranchTicketKey` is the only source and there's nothing to cross-check; say which ticket you inferred from the branch so a wrong checkout is still visible.

Then compare `git.currentBranch` against the ticket being closed:

- **On the branch for this ticket** — good, proceed.
- **On the integration or default branch, or another branch with the SAME project prefix** — warn:
  > ⚠️ You're currently on `{currentBranch}`, not on the ticket branch. Please confirm which branch we should be closing and pushing.

  Ask before continuing.
- **On a branch with a DIFFERENT project prefix** (e.g. closing `PROJ-235` while on `OTHER-3391`) — flag it explicitly; this usually means the wrong repo or an unfinished branch switch:
  > ⚠️ You're on `{currentBranch}` (project `{OLD-PREFIX}`), but you're closing `{NEW-PREFIX}` work. This looks like the wrong branch or repo for this ticket — confirm before I run any git operations.

  Do not proceed with commit or push until the user confirms.
- **Detached HEAD** — stop and ask; never commit or push from a detached state without explicit instruction.

**State the branch you're operating on before any git write, whether or not you need an answer.** When you're already on the ticket's branch, say so and carry on — that's a statement, not a question, and stopping for confirmation there is friction with no benefit. When anything is off (wrong branch, different prefix, detached HEAD), it becomes a question and you wait.

## Step 2 — Pre-Commit Checklist

**Check there's actually something to close before running the checklist below.** If `git.isDirty` is false (or a fresh `git status --porcelain` confirms it now) and the branch has no commits ahead of `{TARGET}` either, there's nothing for this skill to do. Don't run 2.1–2.3 against an empty diff and don't invent something to check. Say so plainly and ask what they expected — a clean tree with nothing pushed usually means the wrong branch, an already-closed ticket, or a session that never actually implemented anything:

> There's nothing to close on `{currentBranch}` — the tree is clean and there's nothing ahead of `{TARGET}`. Is this the wrong branch, or did you expect changes here?

Wait for an answer rather than treating a clean tree as an implicit "we're done, move on to Jira." A clean tree with no unpushed work should stop the workflow, not skip quietly through the rest of it.

Inspect first (2.1, 2.2 — read-only), then stage and review (2.3). Nothing here
commits; that's Step 3, and it only runs once the user has approved what's staged.

### Project review checklist

Apply the project's own review conventions **against the actual diff** (not from
memory) after running the built-in checks below.

**If `new-ticket` already ran this search earlier in the same session, don't
repeat the discovery step.** Reuse what it found (or didn't) rather than
re-searching and potentially re-applying the same checklist twice. It's still
worth re-checking only if the diff has grown since then — new files or a
follow-up fix the checklist never saw. If nothing changed since, just carry
the earlier result into the Step 2.3 line below. When `close-ticket` is invoked
fresh (a new session, or the user skipped straight to it without `new-ticket`),
run the search here as normal — this is the only place it happens for that path.

**Start with the scanner, then fall back to judging by description.**
`reviewChecklist.checklistContent` from Step 0 is the fast path — when it's
non-null, the scanner already found and inlined a checklist, so use it directly.
But the scanner matches on filenames and keywords, so it misses anything named
unexpectedly. When it comes back empty, don't conclude the project has no review
conventions:

1. **`checklistContent` non-null** → apply it directly. Only items relevant to the
   changed files; a 40-item list against a 3-line fix should produce 2–3 checks.
2. **`checklistContent` null** → look yourself, and judge candidates by **what they
   say they do**, not by what they're called. Steering files, skills, and rule files
   nearly always carry a `description` in frontmatter; read it and decide whether
   it's about reviewing, verifying, or checking work before it ships. Check
   `reviewChecklist.allSources` first since the scanner already listed it, then
   wherever else this project keeps agent-facing instructions — a steering
   directory, a skills directory, repo-root rule files under whatever name this
   project uses, `CONTRIBUTING.md`. **These are hints, not a fixed list**: a
   checklist called `pre-flight.md`, `merge-readiness.md`, or
   `definition-of-done.md` counts exactly as much as one called `code-review.md`.
   A file whose description says "how to run the local database" doesn't, however
   review-ish its filename looks.
3. **Nothing describes itself that way** → rely on the built-in pass below; 2.1 and
   2.2 already cover the generic checks.

**When you find something, name it and offer it rather than applying it silently:**

> Found `.kiro/steering/code-review-self.md` — its description says it's a
> self-review checklist to run before pushing. Want me to check the staged changes
> against it before we commit?

Fold that offer into the **Step 2.3 staged review**, which is already a blocking
gate — one decision point for the user instead of two. If they say yes, apply it and
report what it found; if they decline, note that and move on.

**Do not resolve this offer yourself before folding it in.** The checklist offer and the Step 2.3 review belong together, in one presentation, with one reply covering both. What's forbidden: asking the checklist question on its own first, answering it yourself with the generic 2.2 checks ("I did a quick pass myself"), then presenting Step 2.3 as if that stood in for the user's answer — "otherwise I'll proceed to the summary" followed immediately by the summary in the same breath is a self-supplied answer, not the user replying. Same standard as reporting any other unverified claim: put the named checklist's status as an open line inside the Step 2.3 presentation itself (per the "found and offered" wording above) and let its one closing question cover it — never report a finding or count attributed to that checklist unless you actually opened its content and followed it.

A steering file marked `inclusion: manual` isn't already in your context the way an
always-included one is — reading it here explicitly is the only way you'll see it,
which is exactly the case this fallback exists for.

If the checklist catches something, fix it inline and then **loop back through the definitive staged review**: re-stage changed files, rerun the staged formatter when relevant, rerun affected validation checks, show the new `git diff --cached`, and wait for approval again. The first approval covered the old bytes, not the checklist-modified result.

**This search always produces a visible line in Step 2.3 — never skip reporting
it, even when nothing was found.** A silent pass is indistinguishable from a
skipped one; the user has no way to tell "I looked and there's nothing" from
"I forgot to look." State the outcome as one of:

- Found and applied: `Ran {name} against the diff — caught {what}, fixed.`
- Found and declined: `Found {name} — you said skip it.`
- Looked, nothing found: `Checked {where you looked} for a review checklist — nothing found.`

### 2.1 — Local-only config changes

Check `git status` and `git diff` for changes to linter/formatter config (`eslint.config.*`, `.eslintrc*`, prettier config) that were made for local dev convenience and were never meant to ship.

If you find any, **do not revert them yourself.** Reverting discards uncommitted work irreversibly, and whether a config change was "local-only" is a judgment call you can get wrong. Instead:

1. Show the user the exact diff for each file in question
2. State plainly what would be lost: "Reverting `{file}` will permanently discard these uncommitted changes."
3. Ask which of them, if any, should be reverted

Only after explicit confirmation, and only for the files the user named:

```bash
git checkout -- {config-file-path}
```

If the user is unsure, prefer keeping the change and letting review catch it — that's recoverable, a discarded diff isn't. Skip this step entirely when no such changes exist.

### 2.2 — Leftovers, untracked files, and anything that shouldn't ship

Run `git status` and check for:

- **Unstaged changes** that should be part of this ticket — ask the user
- **Untracked local tooling** (`.vscode/`, `.kiro/hooks/`, `.kiro/steering/`, `.kiro/skills/`) — leave it out
- **Spec files** (`.kiro/specs/{TICKET-KEY}-*/`) — **always include these**; the spec documents requirements, design, and task plan and ships with the code
- **Anything that looks like a secret** (`.env`, credential files, tokens, keystores) — stop and flag it before it gets staged

**Also scan the actual diff for debug leftovers.** These are far more commonly committed by accident than a lint-config tweak, and no hook catches them:

- `console.log`, `console.debug`, `print`, `dump`, `debugger` statements
- Commented-out code left from trying an approach
- Hardcoded local values — a `localhost` URL, a test account, a stubbed return, a bypassed guard
- `TODO` / `FIXME` / `XXX` added during this change
- Test files switched to `.only` or `.skip`, or an assertion commented out
- Timeouts or feature flags flipped for local convenience

Don't strip these silently — some are deliberate. List what you found with file and line, say which look accidental, and let the user decide. A `debugger` reaching review is embarrassing; a bypassed auth guard reaching `develop` is a real problem.

### 2.2.1 — Run validation before the approval gate

Validate the actual ticket changes before staging the definitive review set:

- Run IDE diagnostics or the narrowest type-check that covers the changed code.
- Run the narrowest relevant tests for changed behavior.
- Run the affected lint command.
- Perform the navigation/smoke path from `new-ticket` when applicable.
- Run a build only when required by the change or requested; otherwise record `deferred to CI`.

Record each tool/command and result. If a check is unavailable or not applicable, keep that visible with the reason. Any formatter or checklist mutation after this point must re-run every affected check before the user is asked to approve again.

### 2.3 — Stage first, then review what will actually be committed

**Order matters here.** Reviewing before staging means the user approves a set of *changes*, then you separately decide which *files* to commit — so the thing they approved isn't the thing that gets committed. Stage first, then show them the staged result.

1. **Stage the files for this ticket** (this is the staging that used to sit in Step 3):
   - Only files belonging to this ticket — never `git add .`
   - Include `.kiro/specs/{TICKET-KEY}-*/` if a spec was created
   - Leave out local tooling and anything flagged in 2.2

2. **Run the staged-file formatter now, before the review**, if `stagedFormatter.tool` is set. It edits files, so running it after the review would change what was approved. Use `gitHooks.preCommitContent` to find the exact command and invoke it via `packageManager.runCommandPrefix`, or `commands.format` on a non-JavaScript stack. When `gitHooks.declarative` is `true` the content lists hooks rather than defining a script — read which formatter it names, then run that formatter's own command. Re-stage anything it modified.

3. **Now show the definitive picture:**

```bash
git diff --cached --stat                         # exactly what will be committed
git status --short                               # what is deliberately left out
git diff origin/{TARGET}...HEAD --stat   # anything already committed on this branch; use verified local ref only when target has no remote
```

Then list the staged files plainly, say what each change does, and explicitly name anything you left unstaged and why — an omission is as much a decision as an inclusion, and it's the harder one for the user to spot.

Include a mandatory **Validation evidence** block in the same presentation:

- Diagnostics/type check — command/tool and result, or why unavailable
- Targeted tests — narrowest relevant command and result, or why not applicable
- Lint — command and result
- Smoke test — result or why it could not run
- Build — result when required, otherwise `deferred to CI`

Every skipped check remains visible and the MR/PR Testing section must make the same claims — never more.

**Always include a review-checklist line in this presentation — this is not optional and not conditional on finding something.** One of:

- `Review checklist: found {name} — its description says {what it's for}. Want me to check the staged diff against it before you approve this?` — use this **open-question** form the first time a resource is found and this is the first Step 2.3 presentation of the run. Nothing about applying it or what it caught belongs in this line yet — those facts don't exist until the user has actually answered. The staged-diff approval question at the end of Step 2.3 covers this line too; don't answer it yourself first and then present this line as already resolved.
- `Review checklist: found {name}, {applied it / you declined}` — use this **already-resolved** form only once the user's reply to a prior presentation actually settled it (e.g. a re-presentation after a checklist-triggered fix loop, or a carried-over result from `new-ticket` per the note above).
- `Review checklist: checked {where}, nothing found describing itself as a review/pre-push check.`

If this line is missing from what you show the user, Step 2.3 is incomplete — go back and do the search from "Project review checklist" above before presenting.

**🛑 Wait for the user's reply before Step 3.** Don't present this and commit in the same turn.

"I reviewed the diff and it's exactly the intended fix" is **not** this gate — that's you approving your own work. Observed in practice: an agent inspected its own one-line diff, declared it correct, and committed without the user ever seeing it. The point of this step is a second pair of eyes, so it only counts when the eyes belong to someone else.

Cheap to skip, expensive when wrong: a commit containing a stray debug line, a leftover config tweak, or an unrelated file is easy to make and awkward to unpick once pushed and reviewed.

## Step 3 — Commit

Skip only if there is genuinely nothing staged and nothing to commit. Don't decide this from a `git.isDirty` value read at Step 0 — re-check now, since the tree has changed since then.

Staging and formatting already happened in 2.3, and the user has approved the staged set. What's left is the message and the commit itself.

### Show the commit message before you write it

The message you're about to use goes into permanent history. Once pushed, changing it needs a rewrite and a force-push, which is more disruptive than editing an MR title. So include it in the 2.3 review, or post it now and wait:

> Committing the staged files as:
> `fix(PROJ-716): remove feedback option from complaint type dropdown`

One line, one reply. If the user amends the wording, use theirs verbatim — don't "improve" it.

### Choosing the format

Use the format from `git.commitConvention.suggestedFormat`. When the scan reports `conventional-commits` with ticket keys in scope, that's `{type}({TICKET-KEY}): short description`:
   - `fix(PROJ-4703): clear auth state on credential re-entry`
   - `feat(PROJ-2167): enable next button on employment step`
   - Multiple tickets: `fix(PROJ-4861/4862/4863): history screen fixes`

   If the scan reports a different pattern (`ticket-key-prefix`, or `mixed-or-freeform`), follow that instead — match the repo.

   **When repo-wide `suggestedFormat` is `null`, check `commitConvention.author` before asking.** Plenty of real repos are mixed overall while the individual contributor is perfectly consistent. The scanner runs the same analysis restricted to the current git user, so if `author.suggestedFormat` is set, use it and say where it came from:

   > "The repo has no enforced convention (`mixed-or-freeform`, 0.55), but your own last {n} commits are consistently `{author.suggestedFormat}` — I'll use that."

   **Respect `author.lowConfidence`.** The scanner withholds `author.suggestedFormat` (returns `null`) when the author has fewer than `author.minSampleForSuggestion` commits here, because this power writes commits itself — with one or two samples, the only evidence can be a commit this workflow generated, making the suggestion circular. When `lowConfidence` is `true`, treat the author signal as absent and ask.

   Only ask the user outright when both the repo-wide and author-scoped formats are `null`. Ask once, then reuse the answer for the rest of the session.

Don't reach for `--no-verify` on commit. If a hook fails, fix the cause, re-stage, and commit again. (Pre-*push* hooks that run full builds are a separate case — see Step 4, where the user decides.)

### Use the terminal for `add`, `commit` and `push` — not git MCP tools

When `gitHooks.manager` is set, run these as **terminal commands**. Do not use git
MCP tools (`git_add` / `git_commit`) on a repo with hooks.

Hooks run either way, but through an MCP tool you lose everything you need when one
misbehaves:

- **No visible output** — you can't see which hook is running or what it's waiting on
- **No timeout** — a stalled hook spins indefinitely, indistinguishable from a crash
- **No TTY** — anything expecting an interactive terminal, or producing enough output
  to fill a pipe nobody drains, can block outright

Observed in practice: `git_add` reported success, then `git_commit` hung with no
output at all while the pre-commit hook ran `pretty-quick --staged`. From outside
there was no way to tell whether it was slow or deadlocked.

A terminal `git commit` streams hook output live and fails on a timeout you can act
on. Running the staged formatter in 2.3 is what keeps the hook fast enough that it
doesn't matter.

## Step 4 — Push

### Check what the pre-push hook will actually run, first

Read `gitHooks.prePushContent` from the scan before pushing. If it runs a full
build or a whole-monorepo lint (e.g. a `check` script chaining
`lint:* && build:*:prod`), the push will take **many minutes** and will likely
exceed any command timeout — verified on a real repo where the hook ran
`pnpm run check` across six projects.

This is the one place where two rules in this skill genuinely collide: "don't run
a production build" and "don't use `--no-verify`". Resolve it by handing the
decision to the user rather than picking silently:

> "This repo's pre-push hook runs `{command}`, which builds all {n} projects and
> will take several minutes. Options: (a) let it run — safest, it's the same
> check CI will do, (b) I hand you the command to run in your own terminal where
> a long-running task is fine, or (c) skip the hook with `--no-verify`, which I'd
> only suggest if CI runs the same checks anyway. Which?"

Default to (a) or (b). **Never choose (c) on your own** — a hook that exists
because someone wanted it enforced shouldn't be bypassed by a tool acting alone.
If the user explicitly picks (c), use `--no-verify` privately as execution detail
only. **Never write or disclose it in the MR/PR title, description, comments,
threads, Jira comment, or any other remote text.** In the Testing section, list
only checks that actually ran; leave other boxes unticked without naming the
private push option.

**Warn about the timeout when you present the options.** If `prePushContent` runs
production builds, option (a) will very likely exceed the command timeout available
to you — verified on a real repo where the mobile production build alone ran past
ten minutes and the push was killed mid-hook. Say so up front so the choice is
informed: *"(a) is the safest but will probably exceed my command timeout; (b) runs
the same thing in your terminal with no limit."* For a monorepo building several
apps, (b) is usually the realistic option.

### If the option the user chose then fails

This is where the temptation to downgrade is strongest, and it must be resisted.
Observed: the user chose (a), the build timed out, and the agent's next move was
*"let me just push with `--no-verify`"* — silently switching to the option it had
been told not to pick alone. It caught itself, but only after starting.

When the chosen path fails:

1. **Say what failed and how far it got.** A timeout during the hook is not the
   same as a rejected push — the commit is intact, nothing was sent.
2. **Confirm the actual state** with `git status -sb` and `git log --oneline -1`,
   so you know whether the push landed before the hook was killed.
3. **Re-offer the remaining options.** Choosing (a) is not consent to (c) if (a)
   doesn't work. Hand the decision back.
4. **Never treat a failure as authorisation to escalate.** "The safe option didn't
   work, so I'll use the unsafe one" is exactly backwards; a hook that just failed
   to complete is the weakest possible reason to skip it.

### The push

```bash
git push -u origin {branch-name}
```

If an SSH passphrase or credential prompt is required, hand the command to the
user to run themselves rather than trying to drive an interactive prompt.

**Branch deletion pushes trigger the hook too.** `git push origin --delete
{branch}` has no content to check, but hook scripts usually run unconditionally,
so cleanup can stall the same way. Mention it rather than letting it look like a
hang.

**Commands and builds:**

- Prefer `commands.*` from the scan; use `packageManager.runCommandPrefix` only when `commands` has no entry for that task — never hardcode a package manager.
- **Do not run a full production build** as part of closing unless the user asks. Rely on IDE diagnostics and lint.

## Step 5 — Create the Merge/Pull Request

### First: does one already exist?

Closing a ticket twice is normal — you push a review fix and wrap up again. Creating a second MR for the same branch is not. **Before proposing anything, check for an existing open MR/PR for the current branch.**

On GitLab, use `glab_mr_list` filtered by `source_branch`. Verified working — it
returns exactly the one matching MR.

Because the glab MCP server has no repo working directory, **pass the `repo`
flag** (which this tool does expose, unlike `glab_mr_create`), derived from
`vcs.remoteUrl` in the scan:

```json
{"flags": {"repo": "group/subgroup/project", "source_branch": "{current branch}"}}
```

Alternatively run `glab mr list --source-branch {branch} --output json` from the
repo directory. If an MR exists:

- Say so, with its URL and current state
- Do **not** create another
- Offer instead to update it (title/description via `glab_mr_update`) or just report that the new commits are already pushed to it, since the MR tracks the branch automatically
- Then skip to Step 6

Only continue below when there's genuinely no MR/PR yet.

**Don't reach for a `glab_mr_*` tool that targets one specific MR to look at that existing MR** — `glab_mr_view`, `glab_mr_note`, `glab_mr_diff`, `glab_mr_approve`, `glab_mr_issues` are all confirmed failing this way, and an unlisted sibling should be assumed to fail the same way rather than tried first. Those MCP tools shell out assuming they're already running inside the repo, and the `glab` MCP server's actual working directory isn't — so they fail on a git check before your request is even read:

```
fatal: not a git repository (or any of the parent directories): .git
git: exit status 128
```

**Passing `--repo`/`repo` does not help these specific tools** — the git check runs first, unconditionally, before any flag is considered. `glab_mr_list` is the one exception in this family that actually works with `repo` passed (used above); the read/write single-MR tools are not. Use `glab_api` with an explicit encoded project path instead, or the CLI (`glab mr view {iid} --output json`) from the repo directory — both used later in this step for exactly this reason.

### Then: confirm everything in one message

The power creates the MR/PR directly rather than handing over a link. But first, **confirm everything with the user in one message**. Present:

1. **Target branch** — use the authoritative `{TARGET}` established in Step 0. Present that exact value and its provenance (existing MR/PR base, same-session confirmation, or fresh user confirmation). Never re-default to `git.integrationBranch` here.
2. **Title** — propose one matching the commit convention: `{type}({TICKET-KEY}): short description`
3. **Description** — **use the repo's own template if it has one.** Check `mrTemplate` in the scan first.

   **`mrTemplate.content` is set** → that's the team's template. Fill it in and use it. Do **not** replace it with a generic body: it exists because the team decided what an MR here must state, and reviewers read it expecting that shape. Overriding it drops required sections silently.

   Filling one in:
   - Complete the prose sections from what you actually did
   - Put the real ticket URL wherever it asks for the ticket
   - **Tick only the checkboxes you can honestly tick.** A checklist is a claim. If it lists `Lint`, `Build`, `Reviewed RTL`, `Reviewed Light/Dark Theme` and you ran lint and a build but never looked at RTL or theming, tick the first two and leave the rest empty.
   - When you leave boxes unticked, say which and why in your confirmation message: *"I've left RTL and Light/Dark unticked — I didn't verify those."* That way the user ticks them deliberately or knows to check.
   - Never tick a box to look complete. A falsely ticked "Reviewed RTL" is worse than an empty one, because it tells the reviewer not to look.
   - Keep the template's own headings and order. Don't tidy it.

   **`mrTemplate.files` has several entries but `defaultFile` is `null`** → the repo has named templates (e.g. `Bugfix.md`, `Feature.md`) and no single default. Show the list and ask which fits, rather than picking for the user.

   **`mrTemplate.kind` is `null`** → no template in the repo. Only then fall back to a generic body:

```
## Summary
{1–2 sentences on what was done}

## Changes
- {key changes}

## Testing
- {what was verified}

## Ticket
{ticket URL for the actual tracker site and key}
```

   > Note: a GitLab project can also set a default description template in project settings, which lives outside the repo and can't be detected here. If `mrTemplate.kind` is `null` but the created MR comes back pre-filled with something else, that's why — mention it rather than fighting it.

4. **Assignee** — default to the current user, but get the username from the **VCS host**, not from git config.

   `git.user.name` in the scan is the *commit* identity and frequently doesn't
   match the host username. A real observed case: git config said
   `janedoe` while the GitLab account was `jane.doe` — passing
   the former to `assignee` would simply fail to resolve.

   Resolve it properly:
   - GitLab: `glab_auth_status` reports `Logged in to {host} as {username}`. Use that username.
   - GitHub: `gh auth status` reports the login similarly.
   - Treat `git.user.name` / `git.user.email` as a hint for the *display* name only, or as a last-resort fallback.

   State the resolved username and confirm, or ask if someone else should be assigned.
5. **Reviewer(s)** — ask who should review, accepting a first name, full name, or username.

   **Resolve names against recent merge requests, not the project member list.** A reviewer does not have to be a project member: verified on a real repo where the reviewer on an open MR (`hodei` / "Hodei López") was absent from all 8 entries of `members/all`, including inherited ones. Querying members returned `[]` and would have looked like "no such person".

   Resolution order:
   1. **Recent MRs** — list recent merge requests for the project and collect the usernames appearing in their `reviewers` and `assignee` fields. This reflects who genuinely reviews in this repo, and catches non-member reviewers. Match the user's input against those names.
   2. **Project members** — `members/all?query={name}` as a secondary source. Useful, just not sufficient alone.
   3. **Instance-wide user search** — `/users?search={name}` if the above find nothing.
   4. **Ask** — if there are zero or several matches, show the candidates you found and ask which. Never guess between two people.

   Once resolved, pass the **username** to `reviewer`. If the user skips, create without a reviewer and say so.
6. **Draft?** — ask if this should be a draft MR (work in progress) or ready for review.

### 🛑 Stop. Post all six, then wait for a reply.

**Do not call `glab mr create`, `gh pr create`, or any MR/PR creation tool in the same turn as presenting these.** Post the six items, end your turn, and wait for the user to actually respond.

Present the **full text**, not a description of it:

- ❌ "I'll open the MR with a standard description summarising the change"
- ✅ The complete title and the complete description body, verbatim, exactly as it will appear

If the user can't read the exact words before they exist, there was no review.

**Why this one is stricter than the local steps.** A branch or a commit is private and cheap to redo. A merge request is not:

- It notifies the assignee and any reviewer immediately. You cannot un-notify someone.
- It appears on the team's board and in review queues.
- Its title and description are what colleagues judge the change by, and edits after the fact are often missed by anyone already notified.
- On a shared repo, other people see it within seconds.

Observed in practice: an MR was created with no confirmation and no chance to read the description first. That has happened, so treat it as the expected failure rather than a hypothetical.

**A user saying "close the ticket" is not confirmation of MR content.** It authorises the workflow to run and reach this point; it does not approve a title and description that didn't exist yet.

Only once the user has replied — approving or amending — continue below.

### GitLab: two tooling gotchas, both verified on a self-hosted instance

**1. `glab_api` defaults to `gitlab.com` — always pass the hostname.** Unlike the
dedicated tools (`glab_mr_list`, `glab_mr_create`), which auto-detect the host
from the repo remote, `glab_api` does not. On a self-hosted instance it fails
with `401 Unauthenticated` against the wrong server, which looks like an auth
problem rather than a targeting one.

Derive the hostname from `vcs.remoteUrl` in the scan and pass it explicitly:

```json
{"args": ["/projects/{url-encoded-path}/members/all?query=name"],
 "flags": {"hostname": "git.internal.example.com"}}
```

**2. `glab_api` cannot return JSON arrays.** Its schema validation rejects them
with `expected record, received array`, client-side, before you see any data —
even though the underlying call succeeded. Most list endpoints (members, users,
MRs) return arrays, so for those either use a dedicated `glab_*` tool, or run
`glab api "..." --hostname {host}` through the terminal and parse the output.

### Creating the MR — use the CLI, not the MCP tool

**`glab_mr_create` (MCP) does not work.** Verified twice on separate attempts: it
fails before touching any of your parameters with

```
Could not create recovery file: fatal: not a git repository (or any of the parent directories): .git
git: exit status 128
```

The glab MCP server doesn't run with the workspace as its working directory, and
unlike `glab_mr_list` the create tool exposes **no `repo` flag** to compensate.
So it cannot locate the project, whatever you pass it.

Run the CLI from the repo directory instead. Flags are kebab-case, and
`--assignee` / `--reviewer` are **repeatable flags, not arrays**:

```bash
glab mr create \
  --source-branch "{current branch}" \
  --target-branch "{confirmed target}" \
  --title "{confirmed title}" \
  --description "{confirmed description}" \
  --assignee {username} \
  --reviewer {username} \
  --no-editor \
  --yes
```

Add `--draft` for a draft. Other useful flags: `--remove-source-branch`,
`--squash-before-merge`, `--label`, `--milestone`.

**Don't use `--template`.** It attaches the repo's template *unfilled* — empty
checkboxes and placeholder prose. Read `mrTemplate.content` from the scan, fill it
in, and pass the completed text through `--description`.

**Passing a multi-line description — go straight to a temp file.** Don't attempt an
inline multi-line string first; a PowerShell here-string built inside a tool call
fails on quoting and you'll just burn a turn. Verified: the inline attempt errored,
the temp-file version worked. Write it to a file and read it back:

```powershell
# PowerShell
glab mr create --description (Get-Content $body -Raw) --title "..." ...
```

```bash
# bash / zsh
glab mr create --description "$(cat "$body")" --title "..." ...
```

Delete the temp file afterwards. Check the created MR's description came through
with its structure intact — if newlines were flattened, the checkboxes won't
render and the reviewer sees one long paragraph.

Verified working end-to-end this way: title, description, target and source
branch, `--draft` (produces a genuine draft — `draft: true`,
`work_in_progress: true`, `detailed_merge_status: "draft_status"`), and
`--assignee` resolving the username from `glab_auth_status`.

If a future glab MCP release fixes the cwd problem, its `flags` object uses
snake_case keys (`target_branch`, `source_branch`) with `assignee`/`reviewer` as
arrays of strings — but treat that as unverified until someone confirms it.

### GitHub / Bitbucket (when `vcs.host` is `github` or `bitbucket`)

There is no GitHub MCP server assumed here, so use the CLI if it's installed:

```
gh pr create
  --title "{confirmed title}"
  --body "{confirmed description}"
  --base "{confirmed target}"
  --assignee "{username}"
  --reviewer "{username}"
```

Verify `gh` exists before relying on it. Bitbucket has no widely available CLI equivalent — expect to use the fallback below.

### Fallback

If no MCP tool or CLI is available for MR/PR creation, provide:
- The create link from the `git push` output
- The confirmed title, description, assignee, and reviewer for the user to fill in manually
- Say explicitly which tool you looked for and couldn't find, so the user can install it if they want automation next time

### After creation

Report back:
- The MR/PR URL (from the tool output)
- The target branch, assignee, and reviewer as set
- Whether it's a draft or ready for review

Use the same marker convention as `new-ticket`'s branch-state presentation, minus `➕` (nothing here is "about to be created" the way a branch is) — ✅ done as intended, ⚠️ needs attention, ➖ deliberately absent:

> ✅ **MR !487** created → https://…/merge_requests/487
> - ✅ Target: `develop`
> - ✅ Assignee: `jane.doe`
> - ➖ Reviewer: none set
> - ⚠️ Draft — mark ready when you want review
> - ⚠️ Left unticked in the template: Reviewed RTL, Light/Dark

Anything you couldn't verify or deliberately left out gets ⚠️ or ➖, never ✅. The point of the markers is that a wall of ✅ means "nothing to check" — that only stays true if it's honest.

**Icons are for chat only.** Never in the MR title, description, commit message or Jira comment.

### If creation reports a failure

Show the **exact error** and don't retry silently. Then check whether it failed
completely or partially, because `glab mr create` can create the MR and *still*
return an error from a later step such as assigning a reviewer:

```bash
glab mr list --source-branch {branch} --output json
```

- **No MR** → it genuinely failed. Report the error and ask how to proceed.
- **An MR exists** → it partially succeeded. Say exactly that: *"`glab mr create`
  returned an error, but MR !NNN was created — likely the reviewer assignment
  failed after creation."* Then verify each field against what the user approved
  and report any that didn't take.

**Do not invent an explanation for a failure.** Observed: after `glab mr create`
errored, an agent reported *"the push already auto-created the MR (likely a GitLab
project setting)"* — contradicting its own earlier `glab mr list` which returned
`[]` **after** the push. It then described the MR's title, description, assignee
and reviewer as "correct" without comparing them to what had been proposed.

Two rules from that:

- **A guess about why something failed must be labelled as a guess**, or not
  offered. "I don't know why this errored, but the MR exists" is a good answer.
  A confident wrong cause sends the user looking in the wrong place.
- **Never describe a field as correct without reading it back.** If you're
  reporting on an MR you didn't fully create, fetch it (`glab mr view {iid}
  --output json`) and compare target branch, title, description, assignee and
  reviewer against what the user approved. Report differences rather than
  assuming they match.

## Step 6 — Update Jira

Use the `cloudId` resolved in Step 0. Transition the ticket and add a summary comment.

**If Jira tools aren't available or aren't authenticated**, say so, give the user the suggested status and comment text to apply manually, and continue to Step 7 — don't stall the workflow.

### Default: move to review + comment

1. Transition to the project's "To Review" equivalent
2. Add a comment covering what changed, any notable technical decisions for the reviewer, and known follow-ups or limitations

### Confirm status, comment AND time in one message

Ask for the time spent **here**, not after the transition. All three are Jira
updates for the same ticket, so batching them means one reply from the user and one
sequence of writes instead of two:

**Pull `timetracking` (estimate, already-logged total, remaining) when you re-read
the ticket for this step, and show it as context alongside the time question —
don't ask for a bare number with no reference point.** A worklog is additive, not
an overwrite, so there's no "keep or change" choice like `new-ticket`'s estimate —
but the user still benefits from seeing where they stand before naming a figure:

> "Ready to wrap up `PROJ-420`:
>
> - **Status:** To Review
> - **Comment:**
>
>   *{full proposed comment text}*
>
> - **Time spent this session?** Estimate was `{originalEstimate}`, `{timeSpent}`
>   already logged (`{remainingEstimate}` remaining). (e.g. `2h`, `30m`, `1d`)
>
> Confirm and I'll apply all three."

**Omit the estimate/logged/remaining clause if `timetracking` came back empty** —
a ticket with no estimate and no prior worklogs has nothing to show, and inventing
zeros would be worse than saying nothing.

- **Yes + a duration** → transition, comment, and log the worklog
- **A different status** → use that, adjust the comment
- **No comment** → transition and worklog only
- **No time / declines** → transition and comment only, and say the worklog was skipped

Asking for time after the transition has already landed is a wasted round trip —
observed in a real run, where the status moved, then the user was asked for time,
then a second Jira call logged it. Nothing was wrong with the result; it just cost
an extra exchange for information that could have been gathered up front.

**Never transition without confirmation.** Post the proposed status and the full comment text, end your turn, and wait for a reply — don't propose and execute in the same turn. Like an MR, a transition is visible to the team the moment it lands: it moves the ticket on the board and notifies watchers. Show the comment verbatim rather than describing it, since it's what a reviewer reads first.

### Choosing the status

| Context | Status |
| --- | --- |
| Done, pushed, ready for review | **To Review** |
| Not finished, continuing later | Leave as **In Progress** — say so rather than transitioning |
| Blocked externally (API, design, another team) | **Blocked** — name the blocker in the comment |
| Abandoned / won't fix | Ask the user |

### Performing the transition

**Never guess transition names.** They vary by project — "Push for Review", "Ready for Review", "Mark for review", "Submit". Always read what's available first.

**Match on `to.name`, never on `to.statusCategory`.** `statusCategory` has only
three values and its `indeterminate` bucket displays as "In Progress", so
unrelated statuses like `Merged`, `Blocked` and the current status itself all
report the same category. Selecting by category can mark a ticket **Merged**
when you meant to send it for review. Compare the actual `to.name`, and never
choose a transition targeting `Merged`, `Rejected`, `Closed` or `Done` unless
the user explicitly asked for that.

1. Call `getTransitionsForJiraIssue` with the `cloudId` from Step 0 to see what's reachable **from the ticket's current status**.
2. **Already in the review state?** Say so and skip.
3. **Already in a `done` category** (`Done`, `Merged`, `Closed`, `Rejected`)? Don't transition it — Step 0 should have caught this, but re-check here since the ticket may have moved while you were working. Say where it is and ask what they want, rather than moving finished work backwards or sideways on your own initiative.
4. **Direct path exists?** Use it.
5. **No direct path?** Some workflows require an intermediate hop before review becomes reachable. When that's the case:
   - Look through the available transitions for one leading to a status from which the review state is reachable
   - Tell the user what you're doing and why: *"`{TICKET}` is in `{status}`, which has no direct transition to review. I'll move it to `{intermediate}` first, then to review."*
   - Do the first hop, call `getTransitionsForJiraIssue` **again** to confirm the second is now available, then do it
   - Don't chain more than two hops without asking. Beyond that, show the user the workflow you're seeing and let them decide.
6. **Blocked by a set Resolution.** A reopened ticket can refuse transitions while it still carries a Resolution. **Say what you intend to do before doing it** — the user consented to a status change, not to editing other fields:

   > `{TICKET}` won't transition because it still has Resolution `{value}` set. Clearing that should unblock it. Clear it and retry?

   Once they agree:
   ```
   editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, fields: { "resolution": null }
   ```
   Retry the transition once. If it still fails, go to point 7 rather than trying further field edits.
7. **If a transition fails, surface it — never continue silently and never report success.** Report all three of:
   - the exact error Jira returned
   - the ticket's current status, unchanged
   - the transitions that *are* available right now

   Then ask how to proceed. The MR is already created and pushed at this point, so a stuck status is recoverable — but only if the user knows about it.

## Step 7 — Log Time Spent

Use the duration gathered in Step 6 — don't ask again.

```
addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, timeSpent: "{duration}"
```

`timeSpent` takes the same format as an estimate: `30m`, `2h`, `1d`, `1w`, or a
combination like `1d 4h`. A range is invalid, so if the user answered with one
("2-3h"), ask which single value they meant.

Do this in the same turn as the transition and comment. If the user declined to give
a duration, skip it and say so rather than asking a second time. If the call fails,
report it — a missing worklog is minor, but silently dropping one the user asked for
is not.

## Step 8 — Where this skill ends

The ticket is now pushed, in review, and logged. **Stop here.** Do not:

- ❌ **Merge or approve the MR/PR** — no `glab mr merge`, `glab mr approve`, `gh pr merge`, and no clicking through the API
- ❌ Delete the source branch, locally or on the remote
- ❌ Transition the ticket to Done, Merged, Closed or Resolved
- ❌ Start on another ticket

**Merging is the one to be most careful about.** The entire point of the MR you just opened is that a human reviews it. Merging it yourself makes the review you requested impossible, lands unreviewed code on a shared branch, and on most setups can't be undone cleanly. It doesn't matter that CI is green or that the change looks trivial — you are not the reviewer.

The same goes for approving. An approval from the author is meaningless at best and misleading at worst, since it may satisfy a required-approvals rule that existed to stop precisely this.

**Branch deletion waits for the merge.** The source branch is what the MR points at. Deleting it before the merge breaks the MR; deleting it after is usually handled by the host's own "delete source branch" setting.

**Done/Merged status belongs to whoever merges**, not to whoever opened the MR. Moving the ticket there now tells the board the work has landed when it hasn't.

If the user explicitly asks you to merge, that's their call — but say what will happen first, including whether the MR has any approvals, and let them confirm rather than treating the request as blanket permission.

**What to do instead — report in this shape, not a prose paragraph:**

```
### {TICKET-KEY} closed

**MR/PR:** {url}
- Target: `{target-branch}`
- Reviewer: {name, or "none set"}

**Jira**
- Status: {new status}
- Comment: added
- Time logged: {duration, or "skipped"}

**Left unticked / unverified:** {anything from the MR template you didn't check, or omit this line if everything was covered}
```

One block per fact, not a run-on sentence — the same rule the triage and summary
reports in `mr-comments` follow, for the same reason: a wall of text is easy to
skim past, a short list of labeled facts isn't.

## Quick Reference

| Step | Action |
| --- | --- |
| 0. Scan | `get_project_profile` **fresh** (never reuse an earlier profile — the branch has changed) + resolve `cloudId`, which Step 5 also needs |
| 0. Validate | URL/key actually an Atlassian issue reference? Read failed → **stop**. Assigned to someone else → flag. Already `done` category → **stop** |
| 0. Target | Existing MR/PR base wins; otherwise reuse same-session confirmation or ask. Fetch `origin/{TARGET}` before every target-relative diff and never re-default later |
| 1. Verify branch | **Branch's ticket key ≠ the key the user named → stop**, you can't tell which is wrong. Then state the branch; ask only if it's wrong, a different prefix, or detached. Handle work already committed outside this skill |
| 2. Anything to close? | Clean tree and nothing ahead of `{TARGET}` → **stop and ask** what they expected, before running 2.1–2.3 against an empty diff |
| 2.1 Local-only config | Show the diff, get per-file confirmation before discarding anything |
| 2.2 Leftovers | Unstaged files, local tooling, specs to include, debug leftovers, anything secret-shaped |
| 2.2.1 Validate | Run diagnostics/type-check, targeted tests, lint and applicable smoke test; build when required. Record exact evidence and reasons for skips |
| 2. Checklist | Scanner's `checklistContent` first; if empty, judge candidates by their **description**, not filename. Found one → name it and offer it in 2.3, don't apply silently. **Always report the outcome as a line in 2.3, even "nothing found" — never silent** |
| 2.3 Stage → review | **Stage first, format, then show `git diff --cached`.** 🛑 Wait for the user before Step 3 |
| 3. Commit | Show the message, wait, then commit per `commitConvention.suggestedFormat`. Terminal git, not MCP tools |
| 4. Push | Check `prePushContent`; if it runs a full build, let the user pick. `git push -u origin {branch}` |
| 5. MR/PR | Check for an existing MR first. Use `mrTemplate` if the repo has one — tick only what you actually did. Confirm target + title + description + assignee + reviewer + draft. 🛑 Wait. Create with the **`glab` / `gh` CLI** — `glab_mr_create` (MCP) does not work |
| 6. Jira | `getTransitionsForJiraIssue`, match on `to.name` not `statusCategory`. Propose status + comment **+ ask time spent** in one message, 🛑 wait |
| 7. Apply | Transition, comment and `addWorklogToJiraIssue` together — don't ask for time again |
| 8. Stop | **Do not merge, approve, delete the branch, or set Done.** Report the MR URL and stop |
