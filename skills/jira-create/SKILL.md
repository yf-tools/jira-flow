---
name: jira-create
description: Standardized Jira ticket creation workflow — guides issue description, reproduction steps, acceptance criteria, components, parent epic, active sprint vs backlog placement, and pre-coding handoff to jira-pull. Use when the user wants to create a new ticket, file a bug, report an issue, add a task to Jira, or triggers "jira-create", "create ticket", "new ticket", "file bug", "new issue".
---

# Ticket Workflow — Creating a Jira Ticket (jira-create)

Follow this executive workflow to create high-quality, standardized Jira tickets that adhere to team engineering standards.

**Dry-Run / Test Mode:** Activated ONLY when the user explicitly includes the flag `--dry-run` or `--test-mode` (or phrases like `simulate only`). Never trigger on generic words like "test", "testing", or "write tests":

- Formulate the full standardized proposal (Summary, Type, Priority, Sprint, Epic, Description).
- 🛑 **MANDATORY**: Solicit user confirmation using `ask_question` (or chat fallback).
- After confirmation, print `[Dry-Run Summary]` detailing what ticket would have been created in Jira without calling mutating tools.
- Stop immediately after the summary.

**Skill Boundary:** This skill ends after ticket creation and provides a clean handover to `jira-pull` if the user wants to start working on the new ticket immediately.

> For issue templates and standards, see [references/templates.md](./references/templates.md).  
> For sprint resolution, see [references/sprints.md](./references/sprints.md).  
> For common creation mistakes, see [references/mistakes.md](./references/mistakes.md).

---

## Step 1 — Resolve Jira Site, Project & Active Sprint

1. **Resolve `cloudId`:** Extract site from existing Jira URLs or call `getAccessibleAtlassianResources`.
2. **Detect Project Key:**
   - Run `git-prep.mjs` against the workspace repository:

     ```bash
     node "<jira-pull-skill-dir>/scripts/git-prep.mjs" --workspace "<repo-path>"
     ```

   - Inspect `detectedProjectKeys` from the output (e.g. `["PROJ"]`).
   - If multiple project keys are detected or ambiguous, confirm the target project key with the user.
3. **Fetch Issue Types Metadata:**
   - Call `getJiraProjectIssueTypesMetadata` with `cloudId` and `projectIdOrKey: {PROJECT_KEY}` to verify available types (`Bug`, `Task`, `Story`, `Improvement`).
4. **Discover Active Sprint:**
   - Query Jira via JQL:

     ```text
     searchJiraIssuesUsingJql → cloudId: {resolved},
       jql: "project = '{PROJECT_KEY}' AND sprint in openSprints() ORDER BY updated DESC",
       fields: ["summary", "customfield_10020"],
       maxResults: 1
     ```

   - Extract active sprint name and ID (per [references/sprints.md](./references/sprints.md)). If none is found, default to Backlog.

---

## Step 2 — Formulate Standardized Issue Content

Gather context from the user's prompt, error logs, screenshots, or open files, then formulate:

1. **Summary:** Format as `[Component/Area] Clear active description` (e.g. `[Auth] Login button unresponsive on mobile viewport`). Avoid generic titles.
2. **Issue Type:**
   - **Bug:** For defects, crashes, broken UI, regressions, or unexpected behavior.
   - **Task / Chore:** For refactoring, updates, tech debt, tooling, or backend maintenance.
   - **Story:** For user-facing feature work.
3. **Description:** Apply the standard Markdown template from [references/templates.md](./references/templates.md):
   - **Bug:** Problem Summary, Steps to Reproduce (numbered), Expected vs Actual, Environment/Context, Error Logs / Stack Traces, Technical Clues.
   - **Task / Story:** Background & Motivation, Scope of Work, Acceptance Criteria (`- [ ] ...`), Technical Notes.
4. **Priority:** Default to `Medium` unless critical (Highest/High) or minor polish (Low/Lowest).
5. **Component / Area:** Suggest component matching repo module or directory.

---

## Step 3 — Determine Sprint & Epic Placement

1. **Sprint Destination:**
   - **Current Active Sprint (`{activeSprint.name}`):** Recommended when filing a bug or task intended for immediate work in the current sprint cycle.
   - **Backlog:** Recommended for future enhancements, deferred tech debt, or items requiring sprint refinement.
2. **Parent Epic Link:**
   - If working on a feature branch associated with an Epic, or if user specifies an Epic key, propose setting the parent / Epic link (`customfield_10014`).

---

## Step 4 — User Confirmation Gate (Single Turn)

Present the formulated ticket for review before writing to Jira:

🛑 **Gate: User Confirmation Required Before Creating Ticket.**

- **If `ask_question` tool is available in your environment (Antigravity, Claude Code):** You MUST invoke `ask_question` with the question structure below.
- **Graceful Fallback (Kiro, Cursor, Windsurf, VS Code):** Format the questions clearly in chat markdown with numbered options and wait for the user's reply before proceeding.

**Question Structure (Modal Carousel or Chat Fallback):**
Provide distinct questions (`1 of 2` or `1 of 3`):

1. **Question 1 (Review & Create Ticket):**
   - Display full preview:
     - **Project:** `{PROJECT_KEY}`
     - **Type:** `{issueTypeName}`
     - **Summary:** `{summary}`
     - **Priority:** `{priority}`
     - **Sprint:** `{activeSprint.name}` or `Backlog`
     - **Description:** formatted template
   - **Recommended option:** Approve and create ticket in Jira.
   - Alternate options: Edit details first, or cancel.
2. **Question 2 (Sprint Destination — if active sprint exists):**
   - **Recommended option:** Put into Current Sprint (`{activeSprint.name}`).
   - Alternate option: Put into Backlog (no sprint).

---

## Step 5 — Create Issue in Jira

Once approved:

1. Assemble `createJiraIssue` parameters:

   ```text
   createJiraIssue →
     cloudId: {resolved},
     projectKey: {PROJECT_KEY},
     issueTypeName: {issueTypeName},
     summary: {summary},
     description: {description},
     contentFormat: "markdown",
     additional_fields: {
       "priority": { "name": "{priority}" },
       "components": [{ "name": "{component}" }],  // if resolved
       [sprintFieldKey]: activeSprint.id            // if Current Sprint chosen
     }
   ```

2. Call `createJiraIssue`.
3. Capture returned `key` (e.g. `PROJ-1050`) and issue URL.

---

## Step 6 — Report & Handover to `jira-pull`

1. Display created ticket summary:

   ```text
   ### Ticket Created: [{KEY}](https://{site}.atlassian.net/browse/{KEY})
   - **Summary:** {summary}
   - **Type:** {issueTypeName} | **Priority:** {priority}
   - **Sprint:** {Sprint Name or "Backlog"}
   - **Status:** To Do
   ```

2. Seamless handover prompt:
   > "Ticket **{KEY}** is created. Would you like to start working on it right now with `jira-pull`?"
