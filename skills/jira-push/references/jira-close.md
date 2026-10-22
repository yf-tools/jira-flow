# Closing Jira Tickets & Reporting Guidelines

After the MR/PR is opened, close out the ticket lifecycle cleanly.

## 1. Jira Status Transition to Review

1. Fetch legal transitions with `getTransitionsForJiraIssue`.
2. Positive safety check: select a transition whose destination status belongs to review/QA ("In Review", "To Review", "Under Review", "Ready for Review").
3. Apply transition with user confirmation.
4. If blocked by a lingering Resolution value, ask consent to clear resolution:

   ```text
   editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, fields: { "resolution": null }
   ```

## 2. Worklog Logging (`addWorklogToJiraIssue`)

Time logged is additive (not an overwrite).
Ask the user what duration to log (e.g. `1h 30m`), displaying current estimate and time already logged as context. Once confirmed:

```text
addWorklogToJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, timeSpent: "{duration}"
```

### Sub-Task Worklog Fallback (Stories & Epics)

If Jira returns a permission error when logging time directly to a `Story` (e.g. `"you do not have the permission to associate a worklog to this issue"`), or if project guidelines require time to be logged on sub-tasks:

1. Create a child sub-task under the story:

   ```text
   createJiraIssue → cloudId: {resolved}, projectKey: "{PROJECT}", issueTypeName: "Sub-task",
                     parent: "{TICKET-KEY}", summary: "{TICKET.summary} implementation",
                     assignee_account_id: "{user.accountId}",
                     additional_fields: { timetracking: { originalEstimate: "{duration}" } }
   ```

2. Log the worklog directly on the newly created sub-task.
3. Transition the sub-task to match the parent's review status (`TO REVIEW` / `Ready to review`).
4. Cross-link the MR URL on both the parent story and child sub-task.

## 3. Final Report Format

Report closed status in a structured template rather than a run-on prose paragraph:

```text
### {TICKET-KEY} closed

**MR/PR:** {url}
- Target: `{target-branch}`
- Reviewer: {name, or "none set"}

**Jira**
- Status: {new status}
- Comment: added
- Time logged: {duration, or "skipped"}

**Left unticked / unverified:** {anything from template left unverified, or omitted if complete}
```
