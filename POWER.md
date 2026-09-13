---
name: "jira-ticket-workflow"
displayName: "Jira Ticket Workflow"
description: "ACTIVATE whenever a message contains a Jira ticket key ({PREFIX}-{NUMBER}) or an Atlassian issue URL (https://<site>.atlassian.net/browse/KEY-123) — a bare key or URL alone means 'start working on this ticket'. End-to-end Jira ticket workflow: starting a ticket, closing a ticket, and a project scanner that auto-detects tooling so the workflow adapts to any project instead of hardcoding assumptions."
keywords:
  [
    "jira",
    "ticket",
    "atlassian",
    "branch",
    "merge-request",
    "pull-request",
    "workflow",
    "project-scanner",
    "atlassian.net",
    "browse",
    "ticket-key",
    "jira-url",
  ]
author: "Youssef Fathalla"
---

# Jira Ticket Workflow

## When to Activate

Activate this power **before responding** whenever a message contains any of:

- A Jira ticket key in `{PREFIX}-{NUMBER}` form — any uppercase project prefix followed by a number (e.g. `PROJ-235`, `ABC-1234`, `TEAM-77`)
- An Atlassian issue URL, e.g. `https://<site>.atlassian.net/browse/KEY-123`
- Intent phrases: "start ticket", "new ticket", "start working on", "close ticket", "wrap up", "done with this ticket", "create an MR", "create a PR"

This activates **regardless of what else is in the message.** A bare key or URL with no other text means "start working on this ticket." A key or URL bundled with a bug description, screenshots, before/after images, or annotations ("image 1 = wrong, image 2 = correct") means exactly the same thing — the accompanying material is context for the ticket, not a separate request to investigate directly. **This combined shape — URL + description + screenshots — is the normal, common case, not an edge case**, and it must not be read as "the user wants me to skip the workflow and go straight to debugging." All of it gets folded into Step 1's ticket summary and Step 3's scope confirmation; the branch/questions/transition steps still happen before any code is touched.

**Mechanical requirement, not a suggestion.** `kiro_powers activate` returns skill *names* only — it does not return their step-by-step content. Immediately after activating this power, call `kiro_powers readSkill` with `skillName: "new-ticket"` (starting work) or `skillName: "close-ticket"` (finishing work), and follow it from Step 0. Do this **before** fetching the ticket, searching the codebase, or writing any code.

This is the single most common failure mode observed in practice: the agent calls `activate`, sees the power matched, and — without ever calling `readSkill` — goes straight to fetching the ticket, investigating the code, and implementing the fix. Every gate the skill exists to enforce (branch setup, the Step 3 confirmation questions, the Jira status transition, the time estimate) gets silently skipped, because the workflow document describing them was never actually loaded into context. `activate` succeeding is not evidence that the workflow was read.

Route to `new-ticket` for starting work, `close-ticket` for finishing work.

## Overview

This power handles the full lifecycle of working on a Jira ticket: starting it (branch setup, scope clarification, navigation guide, time estimate), and closing it (pre-push checks, commit, push, MR/PR handoff, Jira status transition, worklog). It's backed by a project-scanner MCP tool that detects real project conventions by scanning the filesystem and git history — package manager, git hooks, linters, frameworks, monorepo tools, VCS host, test runners, plus which branch feature work is cut from, how branches are named, and what shape commit messages take. The same workflow therefore adapts correctly across different codebases without hardcoded assumptions.

Detection spans ten ecosystems (JavaScript, Python, Rust, Go, Java/Kotlin, Ruby, PHP, .NET, Dart, Elixir) rather than assuming Node. Frameworks, monorepo tools and test runners are reported as arrays because a polyglot repo genuinely has several. The scanner also resolves a `commands` block — lint, test, build, format — preferring the repo's own task runner (`make`, `just`, `task`) over a package script, and a generic ecosystem default last, so verification works even on a stack whose tooling the scanner doesn't know.

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

`close-ticket`'s pre-commit checklist uses the scanner's `reviewChecklist` as a fast
path, but that matches on filenames — so when it comes back empty the skill looks
itself and judges candidates by **what each one's description says it does**, not by
what it's called. A checklist named `pre-flight.md` or `definition-of-done.md` is
found as reliably as one named `code-review.md`. When something turns up it's named
and offered rather than applied silently, folded into the staged-review gate that
already exists.

## Requirements

**Bundled:** the `project-scanner` MCP server ships with this power. It needs `node` and `git` and nothing else. `git` is resolved to an absolute path from the standard install locations rather than trusted from `PATH`; set `PROJECT_SCANNER_GIT_PATH` if yours lives somewhere unusual.

**Not bundled — Jira and Git-host integrations.** Both come from the user's own Kiro MCP config. [README.md](README.md) describes them as capabilities rather than reproducing vendor setup instructions, which change.

- **Jira** (required for anything ticket-related): needs tools that can resolve the accessible site, fetch an issue, list and apply transitions, edit fields, add a comment, and add a worklog. Seven capabilities total. The skills call whatever Jira tools are present rather than a named server, so Cloud, Data Center, Server or any equivalent provider all work without changes here.
- **Git host** (recommended): needs to create an MR/PR, list MRs by source branch, list recent MRs with their reviewers, and report the authenticated username. The vendor CLIs cover all four once authenticated.

Deliberately not bundled: the Atlassian server was tried and reverted. It shipped roughly 40 tool definitions for the 7 actually used, tied the power to Atlassian Cloud, duplicated any existing user configuration, and created a dependency users cannot cleanly disable — Kiro's _Disable Server_ action fails on power-declared servers, and `"disabled": true` is invalid in a power's `mcp.json`.

**MR/PR creation needs a CLI.** `glab` on GitLab, `gh` on GitHub. The `glab_mr_create` MCP tool does not work — it fails with `fatal: not a git repository` because the glab MCP server has no repo working directory and exposes no `repo` flag to compensate.

**Without Jira tools the power still works.** Branch setup, commit conventions, pre-push checks and MR/PR handoff are all local. The skills detect that Jira tools are missing or unauthenticated and ask the user to paste the ticket description, then hand over the status and comment text to apply manually instead of stalling.

> Note on schemas: a **plugin's** `mcp.json` follows the stricter Agent Plugins schema — `type` is required and unknown keys such as `disabled` or `autoApprove` are rejected, which is why an invalid entry gets skipped with a "Component Issues" warning. A user's own Kiro settings file uses a different, more permissive format where those keys are valid.

## Available Skills

- **new-ticket** — Onboarding workflow for starting a new Jira ticket: branch setup, scope identification, navigation guide, time estimate, optional spec creation. See [skills/new-ticket/SKILL.md](skills/new-ticket/SKILL.md).
- **close-ticket** — Closing workflow for wrapping up a Jira ticket: pre-push checklist, commit, push, MR/PR handoff, Jira status transition, worklog. See [skills/close-ticket/SKILL.md](skills/close-ticket/SKILL.md).
- **scan-project** — Documents the `get_project_profile` tool used by both workflows above to detect project-specific tooling. See [skills/scan-project/SKILL.md](skills/scan-project/SKILL.md).

## Available MCP Tools

The `project-scanner` MCP server provides:

| Tool                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_project_profile` | Scans a project directory across ten language ecosystems and returns a ready-to-run `commands` block (lint/test/build/format, resolved task-runner-first with provenance), plus ecosystems, package managers per ecosystem, task runners with parsed targets, git hooks (husky/pre-commit/lefthook/overcommit/native), staged-file formatter, linters per ecosystem, frameworks and monorepo tools as arrays, test runners with invocation commands, VCS host, MR/PR template, review-checklist location, and git state/conventions (current, default and integration branch, branch naming prefixes, commit message format, dirty working tree). |

Both `new-ticket` and `close-ticket` call this tool at the start of their workflow instead of guessing at project conventions.

**Note:** `gitlab-mr-review` is deliberately standalone and does not call this scanner or depend on this power.

## Best Practices

- Always call `get_project_profile` once at the start of a ticket workflow, before assuming any package manager, branch name, or commit format
- Nothing project-specific is hardcoded: the Jira prefix comes from the actual ticket key, and the package manager, integration branch, branch prefixes, commit format and Git host all come from the scan
- Treat `git.integrationBranch` as a candidate, not proof of intent. Existing MR/PR base wins; otherwise use the epic-aware target explicitly confirmed with the user and preserve that `{TARGET}` through review and MR creation
- Treat `null` scan fields as "not detected" and ask the user, rather than falling back to a default
- Ask for explicit confirmation before any Jira status transition — never transition automatically
- Ask before discarding uncommitted work. The only destructive step in these workflows (reverting local-only lint config) requires showing the diff and getting per-file confirmation first
- The navigation guide in `new-ticket` applies to tickets with a reachable screen or flow; it's skipped for tooling, CI, dependency and pure-refactor work

## Configuration

The bundled `project-scanner` needs no configuration. Two optional environment variables exist: `PROJECT_SCANNER_GIT_PATH` to point at a non-standard git install, and `PROJECT_SCANNER_MIN_AUTHOR_SAMPLE` to change how many of the user's own commits are required before their commit convention is treated as evidence (default 5).

Jira and Git-host MCP servers must be configured by the user — see Requirements and the Setup section in [README.md](README.md).

---

**Package:** none (zero-dependency Node.js script for the scanner; requires `node` and `git`)
**MCP Server:** `project-scanner` only (stdio, launched from `${PLUGIN_ROOT}/server/server.js` so the power is portable across machines and users). That entry point holds just the JSON-RPC transport; detection lives in `server/scanner.js` and is importable on its own for testing. Kiro lists the server as `power-jira-ticket-workflow-project-scanner`. Jira and Git-host servers come from the user's own config — see Requirements.
