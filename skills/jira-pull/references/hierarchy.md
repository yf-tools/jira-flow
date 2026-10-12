# Jira Issue Hierarchy & Parent Resolution

When starting a ticket, resolving its direct parent and root Epic is essential to determine:

1. Whether an active epic branch exists to branch from (or merge to).
2. The full context, acceptance criteria, and architecture of the feature.

## Authoritative Read

Fetch the issue with targeted fields:

```text
getJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
               fields: ["summary", "description", "status", "issuetype", "priority", "assignee", "parent", "timetracking", "comment", "issuelinks", "components", "customfield_10014"]
```

## Bounded Recursive Parent Lookup

Do not assume `issue.fields.parent` is always an Epic:

- In Jira Cloud, a **Subtask** has a parent that is a **Story/Bug/Task** (`hierarchyLevel: 0`).
- That Story/Task in turn has a parent that is an **Epic** (`hierarchyLevel: 1`).
- Or higher levels (Initiative / Theme).

### Resolution Procedure

1. Inspect `issue.fields.parent`:
   - If `parent.fields.issuetype.hierarchyLevel == 1` (or issuetype name is `Epic`), this is the Epic.
   - If `parent.fields.issuetype.hierarchyLevel == 0` (it is a standard Story/Task), fetch that parent issue to inspect *its* parent.
2. Bounded depth: Limit lookup to **3 levels** maximum to avoid circular or runaway API calls.
3. **Fallback: Epic Link**:
   - Some Jira instances (especially Jira Software Data Center / Server or legacy configurations) store the epic in a custom field named "Epic Link" rather than `parent`.
   - Use `expand: "names"` to resolve the custom field ID (e.g. `customfield_10014`) whose display name is `"Epic Link"`.
   - If `parent` is null, inspect this resolved field ID for the epic key.
