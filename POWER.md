---
name: "jira-flow"
displayName: "JiraFlow"
description: "ACTIVATE whenever a message contains a Jira ticket key ({PREFIX}-{NUMBER}) or an Atlassian issue URL (https://<site>.atlassian.net/browse/KEY-123) — a bare key or URL alone means 'start working on this ticket'. End-to-end Jira ticket workflow: starting a ticket and closing a ticket, backed by fast deterministic scripts that detect project tooling and git conventions so the workflow adapts to any project instead of hardcoding assumptions."
keywords:
  [
    "atlassian",
    "atlassian.net",
    "branch",
    "browse",
    "close-ticket",
    "issue-link",
    "jira",
    "jira-flow",
    "jira-link",
    "jira-pull",
    "jira-push",
    "jira-ticket",
    "jira-url",
    "merge-request",
    "pull-request",
    "start-ticket",
    "ticket",
    "ticket-key",
    "workflow",
    "wrap-up-ticket",
  ]
author: "Youssef Fathalla"
---

# JiraFlow

## When to Activate

Activate this power **before responding** whenever a message contains any of:

- A Jira ticket key in `{PREFIX}-{NUMBER}` form — any uppercase project prefix followed by a number (e.g. `PROJ-235`, `ABC-1234`, `TEAM-77`)
- An Atlassian issue URL, e.g. `https://<site>.atlassian.net/browse/KEY-123`
- Intent phrases: "start ticket", "jira-pull", "new ticket", "start working on", "close ticket", "jira-push", "wrap up", "done with this ticket", "create an MR", "create a PR"

This activates **regardless of what else is in the message.** A bare key or URL with no other text means "start working on this ticket." A key or URL bundled with a bug description, screenshots, before/after images, or annotations ("image 1 = wrong, image 2 = correct") means exactly the same thing — the accompanying material is context for the ticket, not a separate request to investigate directly. **This combined shape — URL + description + screenshots — is the normal, common case, not an edge case**, and it must not be read as "the user wants me to skip the workflow and go straight to debugging." All of it gets folded into Step 1's ticket summary and Step 3's scope confirmation; the branch/questions/transition steps still happen before any code is touched.

**Mechanical requirement, not a suggestion.** `kiro_powers activate` returns skill *names* only — it does not return their step-by-step content. Immediately after activating this power, call `kiro_powers readSkill` with `skillName: "jira-pull"` (starting work) or `skillName: "jira-push"` (finishing work), and follow it from Step 0. Do this **before** fetching the ticket, searching the codebase, or writing any code.

This is the single most common failure mode observed in practice: the agent calls `activate`, sees the power matched, and — without ever calling `readSkill` — goes straight to fetching the ticket, investigating the code, and implementing the fix. Every gate the skill exists to enforce (branch setup, the Step 3 confirmation questions, the Jira status transition, the time estimate) gets silently skipped, because the workflow document describing them was never actually loaded into context. `activate` succeeding is not evidence that the workflow was read.

Route to `jira-pull` for starting work, `jira-push` for finishing work.

## Overview

This power handles the full lifecycle of working on a Jira ticket: starting it (`jira-pull`: branch setup, scope clarification, navigation guide, time estimate), and closing it (`jira-push`: pre-push checks, commit, push, MR/PR handoff, Jira status transition, worklog). It is backed by deterministic helper scripts that detect real project conventions by scanning the filesystem and git history — package manager, git hooks, linters, frameworks, monorepo tools, VCS host, test runners, plus which branch feature work is cut from, how branches are named, and what shape commit messages take. The same workflow therefore adapts correctly across different codebases without hardcoded assumptions.

## Catching a wrong ticket before it costs anything

A ticket key is one easily-mistyped string, and both workflows act on it by switching
branches and moving a ticket the whole team watches. Each skill opens with a
**"Mistakes a user can hand you"** table that says, per case, whether to stop and wait
or flag and continue:

- A URL that isn't an Atlassian issue link, or a key-shaped string that isn't a ticket
- A key that 404s or that you can't access — never retried with a guessed variant
- A ticket assigned to **someone else**, or unassigned (with an offer to assign it)
- A ticket already `Done`/`Merged`/`Closed`, or already `In Progress` under another name
- On closing: the branch's ticket key disagreeing with the key the user named — neither
  wins automatically, because either one could be the mistake
- Wrong branch, foreign project prefix, detached HEAD, dirty tree

Most fold into a gate the workflow already has rather than adding new pauses. The
few that stop do so before a branch is created or anything is staged, since after
that the mistake has already cost something.

## Finding your review conventions

When discovering review checklists, the workflow judges candidates by **what each one's description says it does**, not just by what it's called. A checklist named `pre-flight.md` or `definition-of-done.md` is found as reliably as one named `code-review.md`. When something turns up it's named and offered rather than applied silently, folded into the staged-review gate that already exists.

## Requirements

**Bundled:** deterministic helper scripts (`git-prep.mjs`, `pre-push-check.mjs`, `reviewer-lookup.mjs`) ship directly with this power. They need `node` and `git` on `PATH` and nothing else (zero npm dependencies; optional `GIT_PATH` env var to override).

**Not bundled — Jira and Git-host integrations.** Both come from the user's own IDE / MCP config. [README.md](README.md) and [SETUP.md](SETUP.md) describe them as capabilities.

- **Jira** (required for anything ticket-related): needs tools that can resolve the accessible site, fetch an issue, list and apply transitions, edit fields, add a comment, and add a worklog. Seven capabilities total. The skills call whatever Jira tools are present rather than a named server, so Cloud, Data Center, Server or any equivalent provider all work without changes here.
- **Git host** (recommended): needs to create an MR/PR, list MRs by source branch, list recent MRs with their reviewers, and report the authenticated username. The vendor CLIs cover all four once authenticated.

Deliberately not bundled: the Atlassian server was tried and reverted. It shipped roughly 40 tool definitions for the 7 actually used, tied the power to Atlassian Cloud, duplicated any existing user configuration, and created a dependency users cannot cleanly disable — Kiro's _Disable Server_ action fails on power-declared servers, and `"disabled": true` is invalid in a power's `mcp.json`.

**MR/PR creation needs a CLI.** `glab` on GitLab, `gh` on GitHub. The `glab_mr_create` MCP tool does not work — it fails with `fatal: not a git repository` because the glab MCP server has no repo working directory and exposes no `repo` flag to compensate.

**Without Jira tools the power still works.** Branch setup, commit conventions, pre-push checks and MR/PR handoff are all local. The skills detect that Jira tools are missing or unauthenticated and ask the user to paste the ticket description, then hand over the status and comment text to apply manually instead of stalling.

## Available Skills

- **jira-pull** — Onboarding workflow for starting a new Jira ticket: branch setup, scope identification, navigation guide, time estimate, optional spec creation. See [skills/jira-pull/SKILL.md](skills/jira-pull/SKILL.md).
- **jira-push** — Closing workflow for wrapping up a Jira ticket: pre-push checklist, commit, push, MR/PR handoff, Jira status transition, worklog. See [skills/jira-push/SKILL.md](skills/jira-push/SKILL.md).

## Best Practices

- Run `git-prep.mjs` at the start of a ticket workflow before assuming any branch name or commit format
- Nothing project-specific is hardcoded: the Jira prefix comes from the actual ticket key, and the integration branch, branch prefixes, and commit format come from the repository
- Treat `git.integrationBranch` as a candidate, not proof of intent. Existing MR/PR base wins; otherwise use the epic-aware target explicitly confirmed with the user and preserve that `{TARGET}` through review and MR creation
- Ask for explicit confirmation before any Jira status transition — never transition automatically
- Ask before discarding uncommitted work. The only destructive step in these workflows requires showing the diff and getting per-file confirmation first
- The navigation guide in `jira-pull` applies to tickets with a reachable screen or flow; it's skipped for tooling, CI, dependency and pure-refactor work

## Configuration

Optional environment variable: `GIT_PATH` to point at a non-standard git install.

Jira and Git-host integrations must be configured by the user — see Requirements and the Setup section in [README.md](README.md) and [SETUP.md](SETUP.md).

---

**Package:** zero-dependency Node.js helper scripts bundled under `skills/` (requires `node` and `git`).
**MCP Servers:** None bundled. Jira and Git-host integrations come from your own environment or IDE config — see Requirements.

