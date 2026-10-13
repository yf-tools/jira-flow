# Mistakes When Creating a Jira Ticket

Catch poorly formed tickets, wrong project keys, or misrouted sprints before writing to Jira.

---

## Pre-Creation Mistake Matrix

| Mistake | Risk | Recovery Action |
| --- | --- | --- |
| **Vague Summary** (e.g. *"Fix bug"*, *"Something broken"*) | Triage confusion, duplicate tickets | Refactor title to `[Area] Active description of behavior`. |
| **Missing Steps to Reproduce** (on Bugs) | QA or other developers cannot reproduce | Prompt user for the 3 minimal steps or inspect current error log to infer them. |
| **Missing Acceptance Criteria** (on Tasks/Stories) | Scope creep, ambiguous definition of done | Formulate clear checkbox criteria (`- [ ] ...`) before submission. |
| **Wrong Project Key** | Ticket lands in wrong team's backlog | Detect project key from repo via `git-prep.mjs` and confirm with user. |
| **Orphan Subtask** | Jira rejects creation if parent is missing | Subtasks require an explicit `parent` issue key. If none exists, create as a standard `Task` or `Bug`. |
| **Blind Sprint Overwrite** | Disrupting sprint planning or adding backlog debt without consent | Always prompt whether to place in **Current Active Sprint** or **Backlog**. |

---

## Best Practices

1. **Always Preview Before Writing:** Never call `createJiraIssue` without presenting the proposed summary, issue type, sprint destination, and description for user approval.
2. **Auto-Link Context:** If creating a ticket while working on an existing branch that has an Epic or Parent Story, offer to link it automatically.
3. **Offer Immediate Handover:** After ticket creation, ask if the user wants to start working on it right away using `jira-pull`.
