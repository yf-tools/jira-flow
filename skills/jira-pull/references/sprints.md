# Jira Sprint Resolution & Assignment

When onboarding (`jira-pull`) or creating (`jira-create`) a ticket, verifying sprint status ensures that:

1. Active work is accurately reflected on the Scrum board and burndown charts.
2. Unplanned work or bugs discovered mid-sprint are intentionally placed into the active sprint or kept in the backlog.
3. Existing sprint assignments made during sprint planning are never accidentally overwritten.

---

## 1. Reading Sprint Status on a Ticket

Fetch the issue including the standard Jira Cloud sprint custom field (`customfield_10020`):

```text
getJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
               fields: ["summary", "description", "status", "issuetype", "priority", "assignee", "parent", "timetracking", "comment", "issuelinks", "components", "customfield_10014", "customfield_10020"]
```

### Inspecting the Sprint Value:
In Jira Cloud, sprint data is stored as an array of sprint objects:
```json
[
  {
    "id": 42,
    "name": "Sprint 14",
    "state": "active",
    "boardId": 10
  }
]
```

- **In Active Sprint:** If any object in the array has `state === "active"`, the ticket is currently in an active sprint. Record: `{ inActiveSprint: true, sprint: { id, name } }`.
- **In Future Sprint:** If sprints are present but all have `state === "future"`, the ticket is scheduled for a future sprint.
- **In Backlog:** If the sprint field is `null`, `[]`, or undefined, the ticket has no sprint assignment (Backlog).

---

## 2. Discovering the Active Sprint

When a ticket is in the Backlog (or when creating a new ticket with `jira-create`), query Jira to find the current active sprint for the project:

```text
searchJiraIssuesUsingJql → cloudId: {resolved},
  jql: "project = '{PROJECT_KEY}' AND sprint in openSprints() ORDER BY updated DESC",
  fields: ["summary", "customfield_10020"],
  maxResults: 1
```

From the returned issue:
1. Inspect `issue.fields.customfield_10020` (or whichever custom field contains sprint objects with `state: "active"`).
2. Extract:
   - `activeSprint = { id: sprint.id, name: sprint.name, boardId: sprint.boardId }`
   - `sprintFieldKey = "customfield_10020"` (or the discovered field name).

### Fallbacks:
- If 0 issues match `project = '{PROJECT_KEY}' AND sprint in openSprints()`, try broader JQL: `sprint in openSprints() ORDER BY updated DESC`.
- If no active sprint is found across the board/project (e.g. Kanban board or between sprint cycles), proceed gracefully without blocking or erroring.

---

## 3. Assigning an Issue to the Active Sprint

### For Existing Tickets (`jira-pull`):
When the user approves adding the ticket to the current sprint:
```text
editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
                fields: { [sprintFieldKey]: activeSprint.id }
```

### For New Tickets (`jira-create`):
When the user chooses to put the new ticket into the current active sprint:
```text
createJiraIssue → cloudId: {resolved}, projectKey: {PROJECT_KEY}, ...,
                  additional_fields: { [sprintFieldKey]: activeSprint.id }
```

---

## 4. Safety Rules

1. **Never overwrite an existing active sprint:** If a ticket is already in an active sprint, keep it as-is.
2. **Warn on future sprints:** If a ticket is scheduled for a future sprint, inform the user: *"Ticket is scheduled for future sprint '{name}'. Do you want to pull it into the current sprint '{current}'?"*
3. **Explicit consent:** Always ask the user before moving an issue from the backlog into the active sprint. Never move it silently.
