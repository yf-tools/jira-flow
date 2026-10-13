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

🛑 **Stop and present the staged diff with the validation evidence block. Wait for user approval before Step 3.**
Use the `ask_question` tool (or format clear choices in chat if `ask_question` is not available in your IDE) to solicit approval (e.g. `["(Recommended) Approve and commit", "I will modify files first", "Cancel"]`). The user can also type custom instructions in the write-in input.

---

## Step 3 — Commit

Once the user approves the staged diff, format the commit using `git.commitConvention.suggestedFormat`. When conventional commits are used, format as `{type}({TICKET-KEY}): description`. See [references/commit.md](./references/commit.md).

Execute `git commit -m "{message}"`.

---

## Step 4 — Push

Push the current branch to origin:
```bash
git push -u origin {branch}
```
If `--no-verify` was explicitly approved by the user, pass it privately to git push.

---

## Step 5 — Prepare & Open Merge Request
 
1. **Parameters:** Confirm all six parameters individually with the user before creation. **Never merge Assignee and Reviewer into one item, and never assume Assignee without verifying:**
   - 1. Target: authoritative `{TARGET}`
   - 2. Title: formatted with ticket key
   - 3. Description: from `mrTemplate.content` (or standard fallback template if repo has none)
   - 4. **Assignee:** Explicitly confirm the username to assign (e.g. current username or designated assignee).
   - 5. **Reviewer:** Resolved from recent MRs or user input.
   - 6. Draft status: Draft or Ready.
2. **Reviewer Resolution:** Use the helper script to resolve usernames:
   ```bash
   node "<this-skill-dir>/scripts/reviewer-lookup.mjs" --workspace "<repo-path>" --query {name}
   ```
3. **Execution:** Use `glab mr create` or `gh pr create` CLI commands. Always pass `--assignee "{assignee}"` (or `-a "{assignee}"`) explicitly since GitLab leaves it unassigned otherwise. The `glab_mr_*` MCP tools are unusable due to cwd restrictions (they fail with `fatal: not a git repository`). See [references/mr-creation.md](./references/mr-creation.md).

🛑 **Gate: User Confirmation Required Before Creating MR.**
- **If `ask_question` tool is available in your environment (Antigravity, Claude Code):** You MUST invoke `ask_question` with the question structure below.
- **Graceful Fallback (Kiro, Cursor, Windsurf, VS Code):** If `ask_question` is NOT registered in your active tools, format the questions clearly in chat markdown with numbered options, end your turn, and wait for the user's reply before proceeding.

**Question Structure (Modal Carousel or Chat Fallback):**
Provide distinct questions (`1 of 2` or `1 of 3`):
1. **Question 1 (MR Readiness & Target):**
   - **Recommended option:** Create draft MR (or ready MR) targeting `{TARGET}`.
   - Alternate options: Change target branch, or cancel MR creation.
2. **Question 2 (Reviewers & Assignee):**
   - **Recommended option:** Assign to me and add suggested reviewer `{reviewer}`.
   - Alternate options: Add different reviewer, or create without reviewer for now.

- Keep phrasing friendly and conversational. Avoid robotic AI markers like brackets, em dashes, or stiff formulaic tags.
- Note: When using `ask_question`, it automatically provides a write-in text field by default on every question. In chat fallback, mention that the user can pick a number or type custom text.

---

## Step 6 — Move Jira to Review

1. Call `getTransitionsForJiraIssue`.
2. Select a transition moving the ticket to review ("To Review", "In Review", "Under Review") — treat the names here as examples, not boundaries; absence from that list is never evidence it's safe.
3. If blocked by Resolution, offer to clear `resolution: null` and retry. See [references/jira-close.md](./references/jira-close.md).

---

## Step 7 — Log Time Spent (Worklog)

Display current estimate and total time logged, then ask what duration to log. Once confirmed, execute:
```text
addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, timeSpent: "{duration}"
```

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
