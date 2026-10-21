# Mistakes a User Can Hand You (Closing Work)

Closing writes to shared state: a commit, a push, an MR other people get notified about, a ticket transition the board reflects. A wrong ticket key or a wrong branch here is more expensive than in `jira-pull`, because most of it can't be quietly undone.

## Pre-Action Mistake Matrix

| What's wrong | Where | Do this |
| --- | --- | --- |
| URL isn't an Atlassian issue link, or key isn't `{PREFIX}-{NUMBER}` | Step 0 | 🛑 **Stop** — don't guess a key. |
| Ticket doesn't exist (404) or you can't access it | Step 0 | 🛑 **Stop**. |
| Ticket key from the branch ≠ the ticket the user named | Step 1 | 🛑 **Stop** — one of the two is wrong, and you can't tell which. |
| Ticket is assigned to someone else | Step 0 | ⚠️ **Flag** — you're about to comment and transition it. |
| Ticket is already `Done` / `Merged` / `Closed` | Step 0, re-checked at Step 6 | 🛑 **Stop** — don't re-transition finished work. |
| On the integration branch, or another ticket's branch | Step 1 | 🛑 **Stop**. |
| Different project prefix on the branch | Step 1 | 🛑 **Stop** — usually the wrong repo. |
| Detached HEAD | Step 1 | 🛑 **Stop**. |
| Nothing to commit (clean tree, no unpushed commits) | Steps 2–3 | ⚠️ **Flag** — say there's nothing to close and ask what they expected. |
| An MR already exists for this branch | Step 5 | ⚠️ **Flag** — update it, don't open a second. |
| Branch is behind target branch (out-of-sync with develop/main) | Step 3.5 | ⚠️ **Flag** — alert developer that base branch has received new commits. Propose rebasing or merging origin/{TARGET} to avoid merge conflicts on GitLab/GitHub. |

The 🛑 cases in Steps 0–1 must be settled **before** Step 2 stages anything.
