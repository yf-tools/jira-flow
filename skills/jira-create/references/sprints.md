# Sprint Discovery & Assignment for Ticket Creation

When creating a new Jira ticket via `jira-create`, placing it into the right sprint ensures proper planning and visibility.

---

## 1. Discovering the Active Sprint

Query Jira to discover the project's current active sprint:

```text
searchJiraIssuesUsingJql → cloudId: {resolved},
  jql: "project = '{PROJECT_KEY}' AND sprint in openSprints() ORDER BY updated DESC",
  fields: ["summary", "customfield_10020"],
  maxResults: 1
```

From the returned issue:

1. Locate the active sprint object (`state === "active"`).
2. Extract:
   - `activeSprint = { id: sprint.id, name: sprint.name, boardId: sprint.boardId }`
   - `sprintFieldKey = "customfield_10020"` (or discovered field name).

If no open sprint is found (e.g. Kanban board or between sprint cycles), default to creating the issue in the **Backlog**.

---

## 2. Choosing Sprint Placement

Offer two clear options during the confirmation gate:

1. **Current Sprint (`{activeSprint.name}`):**
   - **Recommended for:** Urgent bugs, mid-sprint scope additions, or immediate fixes that will be started right away.
   - Sets: `additional_fields: { [sprintFieldKey]: activeSprint.id }`.

2. **Backlog (No Sprint):**
   - **Recommended for:** Future enhancements, non-urgent tech debt, ideas, or items requiring sprint grooming/refinement first.
   - Omit the sprint field from `additional_fields`.
