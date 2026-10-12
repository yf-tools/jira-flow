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

## Recovery Actions

1. **Dirty working tree:** If uncommitted changes exist, give the user two choices:
   - Stay on current branch and abort ticket onboarding.
   - Create a named stash so the tree is clean for checkout.
2. **Assignee mismatch:** Ask explicitly: `"PROJ-123 is currently assigned to {name}. Did you mean to take over this ticket or start a different one?"`
3. **Status conflict:** If already in a `done` category or active by someone else, stop and report the current status and assignee immediately.
