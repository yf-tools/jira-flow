# Jira Status Transitions & Safety Rules

Moving a ticket to `In Progress` marks it active for the team. Transition errors or misconfigurations can accidentally mark tickets `Merged` or `Closed` if not guarded carefully.

## 1. The Safe Test is a Positive One

Never rely on a bare denylist of forbidden status names (e.g. `to.name != "Merged"`). If a board has statuses like `Archived`, `Cancelled`, or `Released`, a denylist permits them.

**The safe test is a positive one:**
A candidate transition is safe to select only if its destination status satisfies:

1. `to.statusCategory.key == "indeterminate"` (which represents "In Progress" work in Jira).
2. AND its name unambiguously represents starting active development:
   - e.g., "In Progress", "Start Progress", "In Development", "Start working", "Begin".
   - Refuse transitions targeting `Merged`, `Blocked`, `Closed`, `Done`, `Rejected`, or `Cancelled`, even if Jira miscategorizes them.

## 2. Two-Hop Transition Fallback

If the current status (e.g. `TO REVIEW` or `Icebox`) has **no direct transition** to `In Progress`:

1. Inspect available transitions for an intermediate status (e.g. `To Do`, `Open`, `Ready for Dev`).
2. If an intermediate hop exists:
   - Explain to the user: `"Ticket {KEY} cannot move directly to In Progress from {STATUS}. It requires a two-step move via {INTERMEDIATE}."`
   - Apply transition to `{INTERMEDIATE}`.
   - Re-fetch transitions and apply transition to `In Progress`.
3. If no route exists, report the available transitions and let the user advise.

## 3. Clearing Blocking Resolutions

If an issue was previously marked with a Resolution (e.g. `Done`, `Won't Fix`), Jira workflows often forbid moving it back to `In Progress` until the resolution field is cleared:

1. If the transition fails with a validation error mentioning resolution:
   - Ask the user: `"{TICKET} cannot transition because Resolution is still set. Clear resolution and retry?"`
2. With consent, execute:

   ```text
   editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, fields: { "resolution": null }
   ```

3. Re-try the transition once.

## 4. Reopened / QA Rejected Tickets

When a ticket is rejected by QA after an MR was already merged:
1. The status is often moved back to `In Progress` (or `Reopened` / `To Do`).
2. Ensure Resolution is cleared if previously set (see Section 3).
3. The integration branch (`develop` or `main`) already contains the previously merged MR.
4. Follow the branch setup rule from Step 2: do NOT resume the stale pre-merge commit; either cut a fresh branch (`fix/{TICKET-KEY}-qa-fix`) from the latest integration branch or hard-reset the ticket branch to latest `origin/{TARGET}`.
