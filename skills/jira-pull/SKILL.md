---
name: jira-pull
description: Jira ticket onboarding workflow — branch setup, ticket status transition, scope identification, and pre-coding checklist. Use when the user wants to start working on a Jira/Atlassian ticket, mentions a ticket key (e.g. PROJ-1234), pastes a Jira/Atlassian issue URL (e.g. https://*.atlassian.net/browse/PROJ-1234) with or without other text, or says things like "start ticket", "jira-pull", "new ticket", "start working on", "investigate ticket", "test ticket", "check ticket", "reproduce issue", "verify issue", or includes flags like "--investigate" / "-i".
---

# Ticket Workflow — Starting a Jira Ticket (jira-pull)

Follow this executive workflow **before writing any code** when starting a Jira ticket.

**Bare URL or key alone:** Treat as "start working on this ticket".
**URL or key with extra content (screenshots, logs, notes):** This is additional context for Step 1's summary and Step 3's scope check — not a shortcut to skip branch creation or status transitions.

**Investigation vs. Implementation Mode:**
- **Investigation / Verification First:** Activated for bugs, QA defects (e.g. `(QA)` prefix), spikes, tickets with existing prior MRs, or when the user mentions "investigate", "test", "check", "verify", or passes `--investigate` / `-i`. The workflow prioritizes syncing latest remote base branch and reproducing/investigating on `{TARGET}` before cutting any branch, preventing empty or wasted git branches.
- **Direct Implementation:** For clear features or stories where immediate branch creation from `{TARGET}` is desired.

**Dry-Run / Test Mode:** Activated ONLY when the user explicitly includes the flag `--dry-run` or `--test-mode` (or phrases like `simulate only`). Never trigger on generic words like "test", "testing", or "write tests" so it never conflicts with regular testing or test-writing tasks:

- Always run the full onboarding flow (Step 1 to Step 3) regardless of whether the ticket is already `In Progress` or an audit task.
- 🛑 **MANDATORY**: You MUST solicit user input using the `ask_question` tool (or formatted chat options if `ask_question` is not available in your IDE) with clean, friendly choices. Do NOT skip the question step or print the summary prematurely.
- Once the user answers the choices, do NOT perform any mutating actions (do not cut or switch git branches, do not edit Jira assignees or transitions).
- Only AFTER the user responds to the question modal or chat prompt, print a clear `[Dry-Run Summary]` detailing what actions would have been taken.
- Stop immediately after the summary without starting implementation or code changes.

**Skill Boundary:** This skill ends at implementation. It does not commit, push, or open a merge request — that's `jira-push`, invoked separately by the user.

> For the pre-action checklist of URL errors, assignment mismatches, and status conflicts, see [references/mistakes.md](./references/mistakes.md).

---

## Step 1 — Validate & Read Ticket Context

1. **Resolve `cloudId`:** Extract hostname from URL or call `getAccessibleAtlassianResources`.
2. **Fetch Ticket:** Whichever tool you use initially, make one authoritative call with targeted fields to keep payloads fast and compact (<3 KB instead of >45 KB):

   ```text
   getJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
                  fields: ["summary", "description", "status", "issuetype", "priority", "assignee", "parent", "timetracking", "comment", "issuelinks", "components", "customfield_10014", "customfield_10015", "customfield_10020"]
   ```

3. **Resolve Parent & Epic:** Resolve direct parent to epic with a bounded lookup; use display-name-based Epic Link only as a verified fallback. See [references/hierarchy.md](./references/hierarchy.md).
4. **Check Sprint Status:** Inspect `customfield_10020` (or sprint objects) per [references/sprints.md](./references/sprints.md). If active, note `Sprint: {name} (Active)`. If in Backlog or future sprint, query active sprint via `project = '{PROJECT_KEY}' AND sprint in openSprints()` to prepare the offer for Step 3.
5. **Sanity Check:** Check assignee against `atlassianUserInfo`. Flag if assigned to someone else; offer assignment if unassigned. If status is `Done`/`Merged`/`Closed` or `In Progress` under another person, stop.
6. **Ticket Classification (Investigation vs. Implementation Candidate):**
   Evaluate whether this ticket requires testing or reproduction before cutting a branch:
   - `issuetype.name` is "Bug", "Defect", or "Spike".
   - `summary` or description starts with or contains `(QA)`, `[QA]`, `reproduce`, `investigate`, `verify`, or `test`.
   - Jira comments or git history mention a prior MR/PR (e.g. reopened bug, QA re-test, or already-existing merge request).
   - User prompt includes investigation phrases (`investigate`, `test`, `check`, `verify`, `--investigate`, `-i`).
   When any of these match, flag `isInvestigationCandidate = true`.

---

## Step 2 — Check Branch State & Authoritative Target (git-prep.mjs)

Fast-check local git state, base branches, and conventions using the deterministic helper script:

```bash
node "<this-skill-dir>/scripts/git-prep.mjs" --workspace "<repo-path>" --ticket {TICKET-KEY} --epic {EPIC-KEY}
```

> **Locating the script:** Resolve `git-prep.mjs` in the `scripts/` directory relative to this `SKILL.md` file (i.e. `<this-skill-dir>/scripts/git-prep.mjs`). Pass `--workspace` pointing to the target repository root.
>
> **Git Host CLI vs MCP:** The single-repo `gitlab` MCP daemon runs outside the repository directory, causing `glab_mr_*` tools to fail with `fatal: not a git repository`. When checking MRs/PRs, always use `run_command` with the `glab` or `gh` CLI directly inside the workspace directory (e.g. `glab mr list --source-branch {branch}`, `glab mr view {id}`, `gh pr list --head {branch}`).

The script returns:

- `integrationBranch` (`develop` or `main`) & `defaultBranch`
- `branchNaming.dominantPrefixes` (e.g. `fix`, `feature`)
- `commitConvention.suggestedFormat`
- `vcsHost`: `{ type, cli, remoteUrl }` (GitLab, GitHub, Bitbucket)
- `mrTemplate`: `{ path, content }`
- `project`: `{ packageManager, hasPrePushHook, hasPreCommitHook, linter, testRunner }`
- `ticket`: `{ exists, local, remote, name, isMergedIntoTarget, mergedInto }`
- `epic`: `{ exists, local, remote, name }`
- `detached` and `isDirty` (`uncommittedFiles`)

### Branch State Decision Matrix

1. **Case A — New branch:** Does not exist $\rightarrow$ cut from confirmed base `{TARGET}` (`integrationBranch` or epic branch).
2. **Case B — Existing active branch:** Exists and `isMergedIntoTarget: false` $\rightarrow$ checkout and pull latest.
3. **Case C — Reopened / QA Rejected / Previously Merged Ticket:**
   If `ticket.isMergedIntoTarget: true` (or previous MR is already merged into `{TARGET}`):
   🛑 **Do NOT checkout the old merged commit directly.**
   In Step 3, clearly inform the user:
   > "Previous branch `{name}` is already merged into `{TARGET}` (MR merged, QA re-test/rejected). Propose cutting a fresh branch `fix/{TICKET-KEY}-qa-fix` from latest `{TARGET}`, or resetting `{name}` to latest `{TARGET}`."
   Wait for user confirmation on whether to cut a fresh branch or reset to latest `{TARGET}`.
4. **Case D — Already Standing on Ticket Branch:**
   If `currentBranch` already matches `{TICKET-KEY}`:
   Do NOT propose creating or switching branches. Propose continuing on `currentBranch` and pulling latest remote changes.
5. **Branch state safety:**
   - Detached HEAD → 🛑 **Stop**.
   - Dirty tree → Offer:
     1. `(Recommended if edits belong to this ticket) Carry edits onto new branch` (`git stash push -u -m "carry-{TICKET-KEY}" && git checkout -b {branch} origin/{TARGET} && git stash pop`)
     2. `Stash and leave for later` (`git stash push -u -m "stash-unrelated"`)
     3. `Stay here and abort ticket setup`

---

## Step 3 — Confirm Scope, Branch & Setup (Single Turn)

Present one structured message asking all necessary questions before acting:

1. **Branch type & name:** Proposed `{type}/{TICKET-KEY}` (where `{type}` is from `git.branchNaming.dominantPrefixes`). Note if fresh/reset branch due to previous merge, or if already on branch. This workflow enforces one Jira ticket per branch.
2. **Authoritative target branch:** `{TARGET}` (`integrationBranch` or epic branch).
3. **Time estimate:** Propose or confirm Original estimate (`timetracking.originalEstimate`). Propose a guess made before reading code; never confuse planned estimate with logged time.
4. **Assignment consent & In Progress transition:** Explicit separate consent for each.
5. **Scope confirmation:** Brief summary of requirements and QA feedback.

🛑 **Gate: User Confirmation Required Before Proceeding.**

- **If `ask_question` tool is available in your environment (Antigravity, Claude Code):** You MUST invoke `ask_question` with the 3-question carousel structure below.
- **Graceful Fallback (Kiro, Cursor, Windsurf, VS Code):** If `ask_question` is NOT registered in your active tools, format the 3 questions clearly in chat markdown with numbered options, end your turn, and wait for the user's reply before proceeding.

**Question Structure (Modal Carousel or Chat Fallback):**
Provide distinct questions (3 questions standard, or 4 if sprint assignment is needed):

1. **Question 1 (Branch Setup & Investigation Gate):**
   - **If already standing on ticket branch (`currentBranch` contains `{TICKET-KEY}`):**
     - **Option 1 (Recommended):** `(Recommended) Continue on current branch '{currentBranch}' (pull latest remote origin/{currentBranch})`
     - Alternate option: `Reset '{currentBranch}' to latest 'origin/{TARGET}'`
   - **For Bugs, QA Verification, Spikes, Prior MRs, or Investigation Candidates (`isInvestigationCandidate = true`):**
     - **Option 1 (Recommended):** `(Recommended) Investigate & test on '{TARGET}' first (sync latest remote, cut branch only if fix is confirmed)`
     - Alternate options:
       - `Create and switch to branch '{type}/{TICKET-KEY}' immediately from '{TARGET}'`
       - `Stay on current branch '{currentBranch}'`
   - **For Standard Features / Stories:**
     - **Option 1 (Recommended):** Must be the clean short branch name `{type}/{TICKET-KEY}` (e.g. `feature/PROJ-101` or `fix/PROJ-101`) from `{TARGET}`. Never recommend long slugged names as option 1.
     - Alternate options: Long descriptive branch (e.g. `feature/{TICKET-KEY}-slug`), stay on current branch, or cancel.
2. **Question 2 (Assignment & Status):**
   - **Recommended option (Option 1):** Assign ticket to me and move to `In Progress` (or `Under Analysis` if present on board) — actively reflects that you are spending time and investigating this ticket.
   - Alternate options:
     - Keep assigned to me and keep status as `{status}` (quiet investigation without board movement).
     - Keep unassigned / change status only.
3. **Question 3 (Time Estimate):**
   - **Recommended option:** Propose estimate (e.g. `2d`).
   - Alternate options: Alternate estimate or skip estimate for now.
4. **Question 4 (Sprint Assignment — ONLY when ticket is in Backlog and an active sprint was found):**
   - **Recommended option:** Add ticket to current sprint `{activeSprint.name}`.
   - Alternate option: Leave in Backlog (no sprint assignment).

- Keep phrasing friendly and conversational. Avoid robotic AI markers like brackets `[FE]`, em dashes `—`, or artificial formulaic tags.
- Note: When using `ask_question`, it automatically provides a write-in text field by default on every question. In chat fallback, mention that the user can pick a number or type custom text.

---

## Step 3.5 — Investigation & Reproduction Gate (When "Investigate First" is selected)

When the user chooses to investigate/test first, execute this triage phase before creating any branch or modifying code:
If the user approved moving to `In Progress` in Question 2, execute Step 5 immediately (assign ticket, move status, and set Start date to today (`YYYY-MM-DD`)) so active investigation is immediately reflected on the Jira board.

### 1. Mandatory Remote Base Sync (Always Pull Latest First)
🛑 **Never search code or test against a stale local base branch.** A teammate's commit or prior MR may have already resolved or altered the behavior on the remote server.
Execute synchronously before inspecting any files:
1. Fetch latest: `git fetch origin {TARGET}`
2. Fast-forward local target safely: `git checkout {TARGET} && git merge --ff-only origin/{TARGET}`
*(If divergence or uncommitted changes exist, stop and follow Step 2 safety rules).*

### 2. Targeted Code & History Investigation
- **Locate relevant code:** Search codebase for component names, routes, UI strings, or translation keys mentioned in the Jira description (e.g. searching for button labels, translation keys, or error messages).
- **Inspect prior commits/MRs:** If comments or git history mention a prior MR (e.g. `MR #348`), run `git log origin/{TARGET} -n 25 --grep="{TICKET-KEY}"` or inspect recent commits on `{TARGET}` to see if a fix was already merged.
- **Run verification / tests:** Execute targeted unit tests or inspect component logic to reproduce the exact issue described in the ticket.

### 3. The Decision Fork

#### Case A: Issue Confirmed & Code Fix Required
- Present concrete findings to the user:
  > "Verified on latest `{TARGET}`: In `src/app/.../questionnaire.component.html`, the button label is hardcoded to `'Next'` instead of `'Continue'`. A code fix is required."
- Ask confirmation to transition into development:
  > "Issue is reproduced. Ready to cut branch `{type}/{TICKET-KEY}` from `{TARGET}` and move Jira to In Progress?"
- Upon user confirmation:
  - Proceed directly to **Step 4** (Create branch `{type}/{TICKET-KEY}` from `{TARGET}`)
  - **Step 5** (Move Jira to In Progress & Assign)
  - **Step 6** (Record Time Estimate)
  - **Steps 7–9** (Implementation)

#### Case B: Issue Already Resolved / Cannot Reproduce / Test-Only (No Code Change Needed)
- Present findings clearly with evidence:
  > "Verified on latest `{TARGET}`: The label is already updated to `'Continue'` (commit `{hash}` / MR `{id}`). Unit tests pass and the issue cannot be reproduced on latest `{TARGET}`."
- Offer immediate Jira resolution and time logging without git pollution:
  > "No branch or code changes are required. Would you like me to:
  > 1. Post a verification summary comment to Jira with commit evidence?
  > 2. Transition Jira ticket to `Resolved` / `Done` / back to QA?
  > 3. Log time spent investigating on this ticket (e.g. 15m, 30m, 1h)?"
- Execute approved actions:
  - **Comment:** `addCommentToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, comment: {evidenceSummary}`
  - **Transition:** `transitionJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, transition: {id}`
  - **Log Time:** If duration provided, `addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, timeSpent: "{duration}"`
- Report completed triage:
  ```text
  ### {TICKET-KEY} verified & closed (Investigation Only)

  **Jira**
  - Status: {new status}
  - Comment: posted with verification evidence
  - Time logged: {duration, or "skipped"}
  - Git: 0 branches created (stayed cleanly on {TARGET})
  ```
- 🛑 **End ticket onboarding cleanly with zero git branches created and zero git clutter.**

---

## Step 4 — Create or Switch Branch

1. Fetch latest: `git fetch origin {TARGET}`.
2. Fast-forward local target safely: `git checkout {TARGET} && git merge --ff-only origin/{TARGET}`. Stop on divergence.
3. Apply branch action:
   - **New branch / Fresh QA branch:** `git checkout -b {branch} {TARGET}`.
   - **Existing active branch:** `git checkout {branch} && git pull origin {branch}`.
   - **Reset branch (if confirmed):** `git checkout {branch} && git reset --hard origin/{TARGET}`.

---

## Step 5 — Assign, Move to In Progress & Assign Sprint

Right after branch creation (or when entering active investigation), execute approved changes:

1. **Assignment is an explicit action:** If unassigned and approved, call `editJiraIssue` with the user's account ID.
2. **Sprint assignment:** If approved in Step 3, assign to active sprint via `editJiraIssue` (`fields: { [sprintFieldKey]: activeSprint.id }`). See [references/sprints.md](./references/sprints.md).
3. **Set Start Date to Today:** Whenever moving a ticket to `In Progress` (or active investigation), set the Start date field (`customfield_10015` in Jira Cloud) to today's local date (`YYYY-MM-DD`) via `editJiraIssue`:
   ```text
   editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
                   fields: { customfield_10015: "{YYYY-MM-DD}" }
   ```
   *(Batch with assignee and sprint in a single `editJiraIssue` call to minimize API roundtrips).*
4. **Positive Transition Safety:**
   - The safe test is a positive one (not a safe-list in disguise). Select a transition only when `to.statusCategory.key == "indeterminate"` and the name clearly signifies active development ("In Progress", "In Development", "Start work").
   - When nothing reachable is unambiguously active, stop and ask.
   - For 2-hop transitions (e.g. `TO REVIEW` $\rightarrow$ `To Do` $\rightarrow$ `In Progress`) or resolution blocks, consult [references/transitions.md](./references/transitions.md).

---

## Step 6 — Record Planned Estimate

If the user confirmed or updated the estimate, apply it:

```text
editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
                fields: { timetracking: { originalEstimate: "{estimate}" } }
```

---

## Steps 7–9 — Implementation Preparation

1. **Pre-coding Checklist:** Identify files, designs, dependencies, and API requirements.
2. **Navigation Guide:** Provide verification routes only when there is a reachable screen or flow.
3. **Implementation Spec:** For complex tickets, propose creating a spec—never create unasked.
9.5 **Plan & Validate:** Outline plan. Required validation evidence: capture diagnostics, targeted tests, lint, smoke tests, and build evidence before completion.
9.6 **Self-Review Checklist:** Discover existing repository checklists by description. See [references/review-discovery.md](./references/review-discovery.md).

---

## Step 10 — Stop & Handover

Once code is implemented and verified locally:

- ❌ Do NOT `git commit` or `git push`.
- ❌ Do NOT create an MR/PR or move Jira to review.
- Hand back to user:
  > "Implementation is complete and verified locally. Ready for `jira-push` to commit, push, and create the MR?"
