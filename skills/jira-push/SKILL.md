---
name: jira-push
description: Ticket closing workflow — final checks, commit, push, and MR/PR creation. Use when the user says they're closing/finishing/wrapping up a ticket, is done with a ticket, wants to create an MR, push, or merge/pull request, or pastes a Jira/Atlassian issue URL (e.g. https://*.atlassian.net/browse/PROJ-1234) alongside closing intent, or triggers "jira-push".
---

# Ticket Workflow — Closing a Jira Ticket (jira-push)

Follow this executive workflow when closing a ticket, wrapping up work, or opening an MR/PR.

**Dry-Run / Test Mode:** Activated ONLY when the user explicitly includes the flag `--dry-run` or `--test-mode` (or phrases like `simulate only`). Never trigger on generic words like "test", "testing", or "write tests" so it never conflicts with regular testing or test-writing tasks:

- Perform all read, review, staging checks, and reviewer lookup steps.
- 🛑 **MANDATORY**: You MUST solicit user choice via the `ask_question` tool (or formatted chat options if `ask_question` is unavailable in your IDE) with clean, friendly choices. Do NOT skip the question step or print the summary prematurely.
- Once the user answers the choices, do NOT perform any mutating actions (do not `git commit`, do not `git push`, do not `glab mr create`, do not transition Jira).
- Only AFTER the user responds to the question modal or chat prompt, print a clear `[Dry-Run Summary]` detailing what actions would have been taken.

> For edge cases regarding assignee mismatches, 404s, or dirty branches, see [references/mistakes.md](./references/mistakes.md).

---

## Step 0 — Resolve Jira Context & Establish Target (ALWAYS FIRST)

1. **Resolve `cloudId`:** Extract site from URL or call `getAccessibleAtlassianResources`.
2. **Read ticket context:** Call `getJiraIssue` with targeted fields to keep payloads fast and compact (<3 KB instead of >45 KB):

   ```text
   getJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
                  fields: ["summary", "description", "status", "issuetype", "priority", "assignee", "parent", "timetracking", "comment"]
   ```

   along with `atlassianUserInfo`.
3. **Establish authoritative `{TARGET}`:**
   - Existing open MR/PR target wins (query via CLI `glab mr list --source-branch {branch}` or `gh pr list`).
   - If created in the same session as `jira-pull`, reuse the confirmed `{TARGET}`.
   - Otherwise, ask the user to confirm. Never re-default to `git.integrationBranch` blindly.

---

## Step 1 — Verify Branch Safety

Verify the current branch matches the ticket key from the scan. Refuse detached HEAD, foreign project prefixes, or running from the integration branch directly.

---

## Step 2 — Validation & Staging Gates

### 2.2.1 — Run validation before the approval gate

Run local validation before presenting anything for commit:

- Diagnostics & narrowest type-check.
- Narrowest relevant tests for changed behavior.
- Lint and smoke tests.
- Record evidence: `[diagnostics, tests, lint, smoke, build]`.

If a pre-push hook runs a lengthy full build and the user opts for `--no-verify`:
**Never write or disclose it** — `--no-verify` is private execution detail. Do not mention it in MR bodies, commit messages, or comments. See [references/validation.md](./references/validation.md).

### 2.3 — Stage first, then review what will actually be committed

Inspect and stage files deterministically:

```bash
node "<this-skill-dir>/scripts/pre-push-check.mjs" --workspace "<repo-path>" --target {TARGET}
```

> **Locating the script:** Resolve `pre-push-check.mjs` in the `scripts/` directory relative to this `SKILL.md` file (i.e. `<this-skill-dir>/scripts/pre-push-check.mjs`). Pass `--workspace` pointing to the target repository root.

Stage specific files (never `git add .`):

```bash
git fetch origin {TARGET}
git diff --cached --stat
git status --short
git diff origin/{TARGET}...HEAD --stat
```

If review guidance or formatting edits modify files after this point, loop back through the definitive staged review and display the updated diff.

🛑 **Stop and present the unified delivery package with the validation evidence block.**
Include:

- Staged diff & validation evidence (`diagnostics, tests, lint, smoke, build`)
- Proposed commit message (`{type}({TICKET-KEY}): description`)
- Target branch (`{TARGET}`) & suggested reviewer (resolved via `reviewer-lookup.mjs --target {TARGET}`)
- Base sync status (`behindTargetCount`)

Use `ask_question` (or format clear choices in chat) to solicit approval in a single turn:

1. `(Recommended) Approve and execute all (Commit, sync/push, create/update MR, move Jira to review)`
2. `Commit and push only (skip MR creation)`
3. `Modify files or edit details first`
4. `Cancel`

When Option 1 is approved, execute Steps 3 through 6 seamlessly in a single pipeline without unnecessary modal pauses.

---

## Step 3 — Commit

Format the commit using `git.commitConvention.suggestedFormat`. When conventional commits are used, format as `{type}({TICKET-KEY}): description`. See [references/commit.md](./references/commit.md).

Execute `git commit -m "{message}"`.

---

## Step 3.5 — Base Refresh & Merge Conflict Check (Sync before push)

Before pushing, inspect if new commits were merged into `{TARGET}` while this ticket was being worked on:

1. **Check if behind target:** `pre-push-check.mjs` returns `behindTargetCount`. If `behindTargetCount > 0`:
   > ⚠️ **Base Branch Updated**: `{TARGET}` has received `{behindTargetCount}` new commit(s) on remote since this branch diverged. Syncing now ensures your MR will merge cleanly without conflicts and pass CI on the first try.

2. **Offer sync options:**
   - **Option 1 (Recommended):** `Rebase onto origin/{TARGET} ('git rebase origin/{TARGET}')` — keeps commit history clean and linear.
   - **Option 2:** `Merge origin/{TARGET} ('git merge origin/{TARGET}')` — creates a standard merge commit.
   - **Option 3:** `Push as-is without syncing` — skip sync and proceed directly to push.

3. **In-Flight Conflict Resolution:**
   If Git reports merge conflicts during rebase or merge:
   - Identify conflicting files via `git status`.
   - Explain the conflicting sections (`<<<<<<< HEAD ... >>>>>>>`).
   - Guide the user to resolve each conflict, stage the resolved files (`git add <file>`), and continue (`git rebase --continue` or `git commit`).
   - Re-run targeted validation tests (`npm test`, etc.) to confirm integrated code compiles and passes tests before pushing.

---

## Step 4 — Push

Push the current branch to origin:

```bash
git push -u origin {branch}
```

*(If the branch was rebased after having been previously pushed to remote, use `git push --force-with-lease origin {branch}` to push safely without overwriting remote changes).*
If `--no-verify` was explicitly approved by the user, pass it privately to git push.

---

## Step 5 — Prepare & Open / Update Merge Request

1. **Check for Existing Open MR:**
   Before creating, inspect whether an MR/PR is already open for `{branch}`:
   - GitLab: `glab mr list --source-branch {branch}`
   - GitHub: `gh pr list --head {branch}`
2. **If MR already exists:**
   - Inform the user: *"MR !{id} / #{id} already exists for branch `{branch}` and was updated with the latest pushed commit(s)."*
   - If marked `Draft` and Ready status was requested:
     - GitLab: `glab mr update {id} --ready`
     - GitHub: `gh pr ready {id}`
   - Proceed directly to Step 6 without attempting a duplicate `mr create`.
3. **If creating new MR:**
   - Reviewer resolution: Resolve suggested reviewer via `reviewer-lookup.mjs --workspace "<repo-path>" --target {TARGET}` (filters out self and inspects touched file contributors).
   - Use `glab mr create` or `gh pr create` CLI commands. Always pass `--assignee "{assignee}"` (or `-a "{assignee}"`) explicitly since GitLab leaves it unassigned otherwise. See [references/mr-creation.md](./references/mr-creation.md).

---

## Step 6 — Move Jira to Review

1. Call `getTransitionsForJiraIssue`.
2. Select a transition moving the ticket to review ("To Review", "In Review", "Under Review") — treat the names here as examples, not boundaries; absence from that list is never evidence it's safe.
3. If blocked by Resolution, offer to clear `resolution: null` and retry. See [references/jira-close.md](./references/jira-close.md).

---

## Step 7 — Log Time Spent (Worklog)

Display current estimate and total time logged, then ask what duration to log.
Normalize common shorthand inputs to Jira format:

- `1.5h` → `1h 30m`
- `90m` → `1h 30m`
- `0.5d` → `4h`

Once confirmed, execute:

```text
addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, timeSpent: "{duration}"
```

### Story / Permission Fallback (Sub-task Pattern)

In Jira projects where permissions restrict logging work directly against parent Stories (`"you do not have the permission to associate a worklog to this issue"`), or where project convention mandates logging time on sub-tasks:

1. Automatically create a child sub-task under `{TICKET-KEY}`:

   ```text
   createJiraIssue → cloudId: {resolved}, projectKey: "{PROJECT}", issueTypeName: "Sub-task",
                     parent: "{TICKET-KEY}", summary: "{TICKET.summary} implementation",
                     assignee_account_id: "{user.accountId}",
                     additional_fields: { timetracking: { originalEstimate: "{duration}" } }
   ```

2. Log the worklog directly on the newly created sub-task:

   ```text
   addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: "{SUBTASK-KEY}", timeSpent: "{duration}"
   ```

3. Transition the sub-task to review status (e.g. `TO REVIEW` / `Ready to review`) matching the parent so board state stays in sync.
4. Add comment to the sub-task linking to the MR.
5. Report both the parent ticket and child sub-task in Step 8's closure report.

*(If time tracking is disabled entirely for this project, record as skipped without failing).*

---

## Step 8 — Report Closed Status

Report the completed closure using the structured template from [references/jira-close.md](./references/jira-close.md):

```text
### {TICKET-KEY} closed

**MR/PR:** {url}
- Target: `{target-branch}`
- Reviewer: {name, or "none set"}

**Jira**
- Status: {new status}
- Comment: added
- Time logged: {duration, or "skipped"}

**Left unticked / unverified:** {unverified items or omitted if complete}
```
