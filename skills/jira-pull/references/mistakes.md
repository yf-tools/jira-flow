# Mistakes a User Can Hand You (Starting Work)

A ticket key or URL is a single string that's easy to get wrong, and this workflow acts on it by switching branches and moving a ticket other people watch. Catch a mismatch before it costs a wrong branch, a transition on someone else's ticket, or work started on the wrong thing.

## Pre-Action Mistake Matrix

| What's wrong | Where | Do this |
| --- | --- | --- |
| URL isn't an Atlassian issue link, or key isn't `{PREFIX}-{NUMBER}` | Step 1 | 🛑 **Stop** — don't guess a key from a partial match. Board views, filter links, Confluence pages, or key-shaped strings (`UTF-8`, `HTTP-404`) must not be parsed as tickets. |
| Ticket doesn't exist (404) or you can't access it | Step 1 | 🛑 **Stop** — likely a typo or wrong site. Never retry with a guessed variant of the key. |
| Ticket is assigned to someone else | Step 1 | ⚠️ **Flag** — legitimate sometimes, but the shape of a typo. Name the assignee and warn before proceeding. |
| Ticket is unassigned | Step 1 | ⚠️ **Flag** — offer to assign it to the user. Assignment requires explicit user consent. |
| Ticket is already `Done` / `Closed` / `Merged` | Step 1 | 🛑 **Stop** — starting fresh work on finished work is almost always a wrong key. |
| Ticket is already `In Progress` with someone else's name on it | Step 1 | 🛑 **Stop** — two people on one ticket is worth a confirmation first. |
| Standing on a different ticket's branch | Step 2.2 | ⚠️ **Flag** (same project prefix) / 🛑 **Stop** (different project prefix — usually the wrong repo). |
| Detached HEAD | Step 2.2 | 🛑 **Stop** — refuse to cut a branch from detached HEAD. |
| Dirty working tree | Step 2.2 | 🛑 **Stop** — offer to stay/end ticket setup or create a named stash (`git stash push -u -m ...`). Never carry dirty work across or commit it blindly. |
| Ticket not in active sprint (Backlog or Future) | Step 1 / 3 | ⚠️ **Flag** — check project active sprint via `openSprints()`. Offer to pull into current sprint or keep as-is. |
| Cutting branch before investigating a Bug/QA ticket | Step 1 / 3 | ⚠️ **Flag** — Bug or QA ticket might already be resolved, invalid, or test-only. Propose "Investigate & test on {TARGET} first" to avoid wasted branch creation. |
| Investigating code on stale local base branch | Step 3.5 | 🛑 **Stop** — always `git fetch origin {TARGET}` and fast-forward before searching code or verifying issues. |
| Closing/resolving investigation ticket without logging time | Step 3.5 Case B | ⚠️ **Flag** — prompt user to log time spent investigating via `addWorklogToJiraIssue` so engineering hours are recorded. |

## Recovery Actions

1. **Dirty working tree:** If uncommitted changes exist, give the user three choices:
   - Carry changes onto the new branch (`git stash push -u -m "carry" && git checkout -b ... origin/{TARGET} && git stash pop`) if edits belong to this ticket.
   - Create a named stash and leave behind for later.
   - Stay on current branch and abort ticket onboarding.
2. **Assignee mismatch:** Ask explicitly: `"PROJ-123 is currently assigned to {name}. Did you mean to take over this ticket or start a different one?"`
3. **Status conflict:** If already in a `done` category or active by someone else, stop and report the current status and assignee immediately.
4. **Sprint unassigned or in future sprint:** If ticket has no active sprint, report: `"Ticket is in Backlog (no active sprint). Active sprint is {Sprint Name}."` Prompt user whether to assign it to current sprint during Step 3.
