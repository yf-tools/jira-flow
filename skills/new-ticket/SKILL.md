---
name: new-ticket
description: Jira ticket onboarding workflow — branch setup, ticket status transition, scope identification, and pre-coding checklist. Use when the user wants to start working on a Jira/Atlassian ticket, mentions a ticket key (e.g. PROJ-1234), pastes a Jira/Atlassian issue URL (e.g. https://*.atlassian.net/browse/PROJ-1234) with or without other text, or says things like "start ticket", "new ticket", or "start working on".
---

# Ticket Workflow — Starting a New Jira Ticket

When the user says they want to start working on a ticket (or mentions a Jira ticket key), follow this workflow **before writing any code**.

**Bare URL or bare key with no other text.** If the user's entire message is just a Jira/Atlassian issue URL or a ticket key with no accompanying instruction, treat it as "start working on this ticket" by default — fetch the issue and begin this workflow, rather than just describing the link.

**URL or key WITH extra content — same workflow, not a shortcut.** A ticket key/URL alongside a bug description, screenshots, before/after images, or annotations ("1st image = wrong, 2nd = correct") is the common case in practice, not the exception. Treat it as "start working on this ticket, and here's extra detail for it" — never as an implicit instruction to skip straight to investigating the code. The extra text and images become part of the Step 1 ticket summary (they usually clarify or supplement acceptance criteria) and get referenced again in Step 3's scope confirmation; they do not replace Steps 2–6. If you catch yourself moving directly to codebase investigation because the message "already told you what's wrong," stop — that's this exact failure mode.

**Follow the steps in order.** Steps 1 and 2 gather everything needed so that Step 3 can ask all its questions in a single round trip. Don't ask the user anything before you've read the ticket and checked the branch state — you can't recommend a branch type without knowing whether the ticket is a bug or a feature.

**The ordering that matters most is after Step 3.** Once the user answers, Steps 4 (branch), 5 (approved assignment, then In Progress) and 6 (estimate) run immediately and in that order, before any code is read or written. This is the step most often skipped, particularly when the user's answer arrives with screenshots or new requirements attached — see the checkpoint at the end of Step 3.

**This skill ends at implementation.** It does not commit, push, or open a merge request — that's `close-ticket`, invoked separately by the user. See Step 10.

**Skip filler acknowledgments before a tool call.** "Now let me check the branch state," "Let me read the ticket," "Let's look at the scanner output" — the tool call itself already shows progress; a sentence announcing it first adds nothing and slows down a workflow that's already many steps long. Speak when you have something to report (a finding, a decision, a question), not before every action that leads up to it.

## Mistakes a user can hand you — check for these before acting

A ticket key or URL is a single string that's easy to get wrong, and this workflow acts on it by switching branches and moving a ticket other people watch. Catch a mismatch before it costs a wrong branch, a transition on someone else's ticket, or work started on the wrong thing.

Each case below says whether to **stop** (wait for an answer before continuing) or **flag** (say it, keep going, let the user's next reply correct course).

| What's wrong | Where | Do this |
| --- | --- | --- |
| URL isn't an Atlassian issue link, or key isn't `{PREFIX}-{NUMBER}` | Step 1 | 🛑 **Stop** — don't guess a key from a partial match |
| Ticket doesn't exist (404) or you can't access it | Step 1 | 🛑 **Stop** — likely a typo or a wrong site |
| Ticket is assigned to someone else | Step 1 | ⚠️ **Flag** — legitimate sometimes, but the shape of a typo |
| Ticket is unassigned | Step 1 | ⚠️ **Flag** — offer to assign it to the user |
| Ticket is already `Done` / `Closed` / `Merged` | Step 1 | 🛑 **Stop** — starting work on finished work is almost always wrong |
| Ticket is already `In Progress` with someone else's name on it | Step 1 | 🛑 **Stop** — two people on one ticket is worth a word first |
| Standing on a different ticket's branch | Step 2.2 | ⚠️ **Flag** (same prefix) / 🛑 **Stop** (different prefix) |
| Detached HEAD | Step 2.2 | 🛑 **Stop** |
| Dirty working tree | Step 2.2 | 🛑 **Stop** — offer leave / stash, never commit |

Most of these fold into Step 3, which is already a blocking gate — surface them there rather than inventing new pauses. The ones marked 🛑 in Steps 1–2 are the exceptions: they need an answer *before* Step 4 touches a branch, because by then the mistake has already cost something.

## Step 0 — Scan the Project (ALWAYS FIRST)

Call the `get_project_profile` MCP tool (from the `project-scanner` server bundled with this power) with the workspace root path. **Everything project-specific below comes from this scan** — package manager, branch names, commit format, git hooks, framework, test runner. Never guess or carry over conventions from a previous project.

**One `get_project_profile` call is enough.** Step 2.1 needs `ticket_keys`, which include the parent epic — and you don't know the epic until Step 1 has read the ticket. So the efficient order is: resolve `cloudId`, read the ticket (Step 1), then scan **once** with `ticket_keys: [ticket, epic]`, covering both this step and 2.1. "Step 0" means *before you act on anything*, not literally the first tool call.

**This applies to the scanner only — it is not a licence to consolidate Jira reads.** Fetching the ticket and fetching its `parent` are separate concerns, and `parent` isn't in the default field list. Dropping it to save a call produced a false "no parent epic" on a ticket that had one. Fewer calls is not the goal; a correct picture before you act is.

The fields this workflow depends on:

| Field | Used for |
| --- | --- |
| `git.currentBranch` | Step 2.2 branch-state check (no need to shell out for it) |
| `git.currentBranchTicketKey` / `currentBranchProjectPrefix` | Detecting a ticket/project mismatch |
| `git.ticketBranches` | Step 2.1 — whether this ticket and its epic already have branches. Only populated when you pass `ticket_keys` |
| `git.integrationBranch` | Candidate target when no existing MR/PR or confirmed epic target exists; Step 2.1.1 establishes authoritative `{TARGET}` |
| `git.branchNaming.dominantPrefixes` | Whether this repo uses `feature/` + `fix/`, `feat/`, `bugfix/`, etc. |
| `git.branchNaming.usesTicketKeyInBranch` | Whether branch names embed the ticket key at all |
| `git.isDirty` / `git.detached` | Whether it's safe to switch branches at all |
| `commands.lint` / `.test` / `.build` | How to verify a change — works on any ecosystem, already carries the right precedence |
| `packageManager.runCommandPrefix` | Script invocation when `commands` has no entry (JavaScript only) |
| `frameworks`, `monorepoTools`, `testRunners` | Locating affected code and how to verify. **Arrays** — a polyglot repo has several, and reading the deprecated singular fields hides the rest |
| `ecosystems` | Which stacks the ticket could touch at all |

If the scanner is unavailable, fall back to `git branch --show-current` and `git branch -r`, and **ask the user** for the integration branch and branch naming convention rather than assuming `develop` / `feature`.

### Ticket key format is dynamic

A ticket key is always `{PREFIX}-{NUMBER}` — for example `PROJ-1234`, `ABC-482`, `TEAM-77`. Whatever prefix appears in the key the user gives you, use that exact prefix consistently for the branch name, commit message, and any spec folder. Never substitute a default prefix, and never carry over a prefix from earlier in the session or from a previous project.

## Step 1 — Read the Ticket

### First: is the ticket reference even valid?

Before resolving anything, check what you were actually given. A Jira issue URL has the shape `https://{site}.atlassian.net/browse/{PREFIX}-{NUMBER}`; a bare key is `{PREFIX}-{NUMBER}`.

**If neither matches, stop and ask — don't extract a best-effort key from a partial match.** A wrong key sends every call below to the wrong ticket, and the first visible symptom is often a transition landing on someone else's work. Two cases worth naming:

- **A URL that isn't an Atlassian issue link** — a Confluence page, a board/backlog view (`/jira/software/projects/.../boards/1`), a filter, or a link to a comment on something else. These contain project-ish strings that look extractable but aren't a single issue. Say what you received and ask for the issue link or key.
- **A key-shaped string that isn't a ticket** — `UTF-8`, `COVID-19`, `HTTP-404`, an ISO date fragment. If a "key" appears in prose rather than as the message's subject, confirm before acting on it.

### Resolving `cloudId` (required by every Jira tool)

Every Atlassian tool call takes a required `cloudId`. Resolve it once and reuse it for the whole workflow:

1. If the user gave a URL like `https://yoursite.atlassian.net/browse/PROJ-123`, try the hostname (`yoursite.atlassian.net`) as `cloudId` directly — this usually works.
2. If that fails, or you only have a bare ticket key with no URL, call `getAccessibleAtlassianResources` to list the sites you can reach and pick the matching one. If several could match, ask the user rather than guessing.

Then read the ticket **using `getJiraIssue` with `fields: ["*all"]` and `expand: "names"`** — not `fetch` or `search`, which cannot reliably return hierarchy or custom fields (see below). `*all` is intentional here: acceptance criteria, environment, release and dependency fields are frequently custom and their IDs differ per Jira site. Summarize only the decision-relevant fields; don't dump the raw response into chat.

Build a compact context bundle for Steps 2–3:

- A 1–2 sentence summary of the scope
- Description and acceptance criteria (use `expand: "names"` to identify custom fields by display name rather than hardcoding an ID)
- Issue type, priority, status, assignee and reporter
- Original estimate, time already logged and remaining estimate — keep all three labels distinct
- Direct parent and resolved epic ancestry (bounded lookup described below)
- Components, labels, fix versions/release and environment
- Blocking, blocked-by and related issue links, preserving their direction
- Subtasks/children relevant to the requested work
- Attachments/screenshots: list name and type, and state whether each was actually inspected
- Relevant comments that clarify or change the requirements
- Which apps/libs/modules are **probably** affected, based on the real project structure (`monorepoTools`, `frameworks` and `ecosystems` from the scan, steering files, or direct exploration). Label this preliminary until code has been inspected — the scanner identifies stacks, not exact ownership

For every important category, distinguish **absent** from **not inspected**. Never say "no acceptance criteria," "no epic," or "no attachments" when the tool response simply didn't include or inspect that field.

### Then: is this the right ticket, and is it yours to start?

A successful read can still come back describing a ticket that isn't the one to start work on. Run these three checks before Step 2, since Step 4 is about to create a branch named after this key.

**The read failed.** A 404 or permission error means the key doesn't exist on this site, or you're pointed at the wrong site. 🛑 **Stop** — don't retry with a guessed variant of the key or silently fall back to a different site. Say which key you tried on which site, and ask. A transposed digit (`PROJ-4123` for `PROJ-4213`) resolves to a real but unrelated ticket just as often as it 404s, which is why the assignee and status checks below matter even on a successful read.

**Check the assignee** against the current user — `atlassianUserInfo` gives you who you're authenticated as, and it's one call:

- **Assigned to someone else** — ⚠️ **Flag it, don't block.** Picking up a colleague's ticket is normal (they're away, you're pairing, work got handed over), but it's also exactly what a mistyped key looks like. Say it plainly and let the reply settle it: *"`PROJ-625` is assigned to {name}, not you — flagging in case that's not the ticket you meant. Continuing on the assumption it is."*
- **Unassigned** — ⚠️ **Flag it and offer.** An unassigned ticket you're about to start should almost certainly be yours: *"`PROJ-625` is unassigned. Want me to assign it to you as part of moving it to In Progress?"* Fold the offer into Step 3's batch rather than asking separately, and only assign if they say yes — `editJiraIssue` with the `assignee` field.
- **Assigned to the current user** — say so in the Step 3 summary (`Assignee: Jane Doe (you)`) and carry on. No question needed.

**Check the status** — read `status.statusCategory.key` alongside `status.name`:

- **Category `done`** (`Done`, `Closed`, `Merged`, `Rejected`, `Won't Fix`) — 🛑 **Stop.** Starting fresh work on a finished ticket is almost always a wrong key or a ticket that needs reopening first, and the decision belongs to the user: *"`PROJ-625` is already `Done`. Starting new work on it looks wrong — did you mean a different ticket, or should this be reopened first?"*
- **Category `indeterminate` and assigned to someone else** (`In Progress` under another name) — 🛑 **Stop.** Two people on one ticket at once is worth a sentence before you create a second branch for it: *"`PROJ-625` is already `In Progress`, assigned to {name}. Are you taking it over, or is this the wrong ticket?"*
- **Category `indeterminate` and assigned to the current user** — fine. It's probably work you're resuming; Step 2.1 will find the existing branch. Note that Step 5's transition is likely a no-op and say so there.
- **Category `new`** (`To Do`, `Backlog`, `Open`) — the normal case. Proceed.

Don't run these as three separate messages. Gather all of it, then present it once — either as part of Step 3's blocking batch (for the ⚠️ flags) or immediately as a single question (for a 🛑).

### Identifying the parent epic

**⚠️ Only `getJiraIssue` can return the parent. `fetch` and `search` cannot.**

This is the single most reliable way to get the epic wrong, and it has happened in
two consecutive runs.

When the user pastes a ticket **URL**, the natural tool is `fetch` — and it returns
plenty: title, description text, and metadata with status, issue type, priority,
assignee, reporter and dates. Enough to write a convincing ticket summary. But its
response shape has **no `parent` field whatsoever**, and it accepts only an `id`, so
there is no parameter that would add one. The same goes for `search`.

The result is a silent false negative: you report "no parent epic" when the ticket
has one, because the tool you used is incapable of telling you either way.

**So: whichever tool you used initially, make one authoritative `getJiraIssue` call with all fields before claiming the context is complete.**

```
getJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY},
               fields: ["*all"], expand: "names"
```

`fields: ["*all"]` is deliberate. Jira sites store acceptance criteria, affected environment and release metadata under different custom-field IDs; `expand: "names"` lets you identify them by display name instead of hardcoding an instance-specific ID. Summarize only the useful fields listed above.

**Never state "no parent epic" unless this authoritative read came back without a usable parent after the bounded ancestry check below.** If the response omitted a category, report it as not inspected rather than absent.

Why it matters beyond tidiness: if the epic has a branch, missing it means the ticket is cut from the integration branch instead of the epic branch, and the MR then targets the wrong base. Both are silent until review.

Then resolve hierarchy without assuming every `parent` is an epic:

```
issue.parent.key                              -> direct parent
issue.parent.fields.issuetype.hierarchyLevel -> 1 means Epic, 0 means Story/Bug/Task
```

- Direct parent is hierarchy level 1 → use it as the epic.
- Direct parent is level 0 (common for subtasks) → fetch that parent once with `fields: ["parent", "issuetype", "summary"]`. If its parent is level 1, that grandparent is the epic.
- No usable `parent` → inspect the authoritative `*all` response's field-name map for a legacy field displayed as **Epic Link**. If it contains a ticket key, fetch that issue and verify its issue type/hierarchy before using it. Never hardcode a custom-field ID; Jira instances assign different IDs.
- Stop after the direct-parent follow-up or verified Epic Link fallback. Do not walk an arbitrary hierarchy indefinitely; report deeper ancestry as unchecked and ask only if it affects branching.

Keep the direct parent and epic separate in the summary. A subtask's parent Story is useful context even when its grandparent Epic determines the branch target.

**If Jira tools aren't available or aren't authenticated**, don't stall — say so and ask the user to paste the ticket description and acceptance criteria, then continue. Skip Step 5 and note that status has to be moved manually. The rest of this workflow does not depend on API access.

## Step 2 — Check Branch State

### 2.1 — Does a branch already exist? (for this ticket AND its epic)

**Call `get_project_profile` with `ticket_keys`** for the ticket and its epic (from
Step 1). If you deferred the Step 0 scan as suggested, this is that single call —
don't scan twice:

```
get_project_profile({ workspace_path: "...", ticket_keys: ["PROJ-716", "PROJ-241"] })
```

This returns `git.ticketBranches` keyed by ticket, each with
`exists`, `local`, `remote`, `localOnly`, `remoteOnly`. Matching is done in code
and is exact — `PROJ-24` will not match `feature/PROJ-241`.

Do **not** try to answer this from `git.currentBranch` alone. That only tells you
what you're standing on; a branch for this ticket can easily exist while you sit
on `develop`, and a repo with 80+ branches makes eyeballing unreliable.

Read the two results:

**The ticket's own branch (`ticketBranches[TICKET]`)**

- `exists: false` → nothing to reuse, create it in Step 4.
- `exists: true` → **do not create a second branch.** Report the name(s) found
  and plan to switch to it instead. Skip the branch-type question in Step 3, but
  **do not skip target confirmation** — branch existence proves the branch name,
  not what it should merge into. Resolve `{TARGET}` as described below.
  - `remoteOnly: true` → it's on the remote but not local. Check it out tracking
    the remote.
  - `localOnly: true` → local only, never pushed. Switch to it, but say there's
    nothing to pull.
  - Several matches → show them all and ask which, rather than guessing.

**The epic's branch (`ticketBranches[EPIC]`)**

- `exists: true` → the epic has a branch. This changes the Step 3 target
  question: offer the epic branch as the likely base rather than defaulting
  silently to the integration branch.
- `exists: false` → no epic branch. The integration branch is the right default;
  mention the epic exists but has no branch, so the user can say if they want one
  created.

### 2.1.1 — Establish one authoritative `{TARGET}`

`{TARGET}` is the branch this ticket will eventually merge into. Resolve it now and carry it through the rest of this session:

1. An open MR/PR already exists for the ticket branch → its `target_branch`/base is authoritative.
2. This workflow is creating a new branch → `{TARGET}` is the base explicitly confirmed in Step 3 (epic branch or integration branch).
3. A branch exists but no MR/PR exists → **ask**. The branch name and merge-base heuristics do not prove intent; never claim its base is "already decided."

State `{TARGET}` in the Step 3 plan and retain it for `close-ticket`. If `close-ticket` runs in a new session it must rediscover or reconfirm it; conversational memory is not durable state.

### 2.2 — Where are you standing?

Compare `git.currentBranch` against the ticket you're about to start, and handle these cases:

- **On the integration branch** (`git.integrationBranch`) **or the default branch** — good starting point.
- **On a branch whose ticket key matches this ticket** — the branch already exists. Skip branch creation in Step 4 and just pull latest.
- **On a branch for a DIFFERENT ticket with the SAME project prefix** (e.g. on `PROJ-420`, starting `PROJ-235`) — warn the user:
  > ⚠️ You're currently on `{currentBranch}`, which belongs to a different ticket. We'll need to switch branches before starting this work.
- **On a branch for a DIFFERENT project prefix** (e.g. on `OTHER-3391`, starting `PROJ-235`) — a stronger signal than a same-project switch: a different prefix usually means a different Jira project, and possibly a different codebase or repo than this ticket belongs to. Do NOT treat it as a routine branch swap:
  > ⚠️ You're on `{currentBranch}` (project `{OLD-PREFIX}`), but this ticket belongs to project `{NEW-PREFIX}` — a different Jira project. Before switching, confirm: is this the correct repository for `{NEW-PREFIX}` tickets? Mixing branches across unrelated projects in one repo is unusual.

  Wait for confirmation before doing anything else.
- **Detached HEAD** (`git.detached` is true) — stop and ask the user how they want to proceed; don't branch from a detached state silently.
- **On an epic branch** — note it, and ask in Step 3 whether this ticket should branch off it.

**If `git.isDirty` is true**, stop before any checkout and ask how to protect the existing work. Do not continue ticket setup while unrelated changes ride across a branch switch.

Offer only these:

- **Stay here and end ticket setup for now** — no git state changes.
- **Create a named stash** — `git stash push -m "{reason}"`, then tell the user exactly how to restore it (`git stash pop`). Never stash silently; an invisible stash is work the user has forgotten about.

**Do not offer to carry the changes across or commit them.** Carrying them puts unrelated bytes on this ticket branch, where they can be mistaken for ticket work; committing them would put unrelated history there. If the user explicitly asks to delete changes, show each affected diff and reconfirm because deletion is irreversible.

### Step 2 performs no git operations

Step 2 is diagnosis only. Do not `checkout`, `pull`, `stash` or `fetch` here — the user hasn't confirmed anything yet, and Step 3 may change the plan entirely. Where a case says "just pull latest", that describes what Step 4 will do, not something to do now.

Always show the user what branch they're on before proceeding.

### Presenting branch state

**Every bullet gets its own leading icon — no exceptions, and no icon on the section header instead.** Putting a single ⚠️ on the heading and leaving the bullets underneath unmarked defeats the entire point: the reader has to read every line to find the problem instead of scanning icons. Repeat the icon on each line even when several lines in a row share the same one.

> **Branch state**
>
> - ⚠️ Current branch: `fix/PROJ-716` — a different ticket in this project
> - ✅ Working tree: clean
> - ➕ Existing branch for PROJ-625: none, will create
> - ➖ Epic PROJ-300 branch: none, so `develop` is the base

When a single finding needs more than one line of explanation (e.g. a dirty tree whose changes turn out to overlap the ticket's own scope), keep the icon on the first line and indent the continuation as a sub-bullet **without its own icon** — the icon marks the finding, not every line of prose about it:

> - ⚠️ Working tree: dirty — uncommitted changes already implement part of this ticket's scope:
>   - `payment-card.component.ts`: new `showAutoPay` input
>   - `payment.locales.ts`: new translation keys

Use ✅ when something is as it should be, ⚠️ when it needs the user's attention, ➕ for something that will be created, ➖ for a legitimate absence. A block of all ✅ tells the user at a glance there's nothing to think about; one ⚠️ in it is impossible to miss. Never mark a real problem with ✅ to make the summary look tidy.

## Step 3 — Confirm the Plan (BLOCKING, ask everything at once)

Do NOT create branches, write code, or change anything until these are answered. Present the ticket summary from Step 1, the branch state from Step 2, and then **all** of these questions in one message:

### Presenting the summary

Lead directly with the one-line emoji header below — **no generic heading like "Ticket summary" above it.** The emoji line already announces what this is; a label above it is redundant weight in a message that's already long.

> 🐛 **PROJ-625** · 🟡 Medium · ⚪ To Do · 🎯 Epic PROJ-300
>
> The "Get help signing in" button does nothing when a user selects to connect their bank.

Then the detail. **This is a fixed template, not an example to riff on.** Use exactly these row labels, in exactly this order, and no others — never substitute a row you think is more useful (e.g. `Related`, `Steps to reproduce`) for one in this list, and never fold three distinct fields into one row (`Original estimate`, `Time logged`, and `Remaining estimate` are three separate rows even when only one has a value):

| | |
| --- | --- |
| **Type** | 🐛 Bug |
| **Priority** | 🟡 Medium |
| **Status** | ⚪ To Do |
| **Assignee** | Jane Doe (you) |
| **Reporter** | Sam Patel |
| **Parent** | 📗 PROJ-299 — Login improvements |
| **Epic** | 🎯 PROJ-300 — Payments Platform |
| **Original estimate** | 5h |
| **Time logged** | 2h |
| **Remaining estimate** | 3h |
| **Components** | Web, Authentication |
| **Fix version** | 4.8.0 |

The one-line emoji header above compresses Type/Priority/Status/Epic for scannability — it does **not** replace this table. Every field the header shows in shorthand still gets its own full row here, including **Parent**, which the header omits.

Additional information that doesn't fit one of these twelve rows (steps to reproduce, related/linked issues, environment) goes in its own short section **below** the table, titled with what it is — never smuggled into the table as an invented row.

Follow the table with short sections for **Acceptance criteria**, **Dependencies**, and **Attachments** when present — as their own sections, never as table rows. For attachments, state `inspected` or `not inspected`; listing a filename is not the same as understanding its content.

When the assignee isn't the current user, mark the row so it can't be skimmed past — `⚠️ Unassigned` or `⚠️ Sam Patel (not you)` — rather than stating the name flatly as though it were expected. Same for a status that isn't in the `new` category on a ticket you're starting fresh.

Omit rows whose fields are genuinely absent. If a field wasn't returned or an attachment wasn't opened, label it `not inspected` rather than presenting absence as fact.

**Issue type** — from `issuetype.name`:

| Type | | Type | |
| --- | --- | --- | --- |
| Bug | 🐛 | Epic | 🎯 |
| Story | 📗 | Sub-task | 🔹 |
| Task | ☑️ | Improvement | ⬆️ |
| Spike / Research | 🔬 | Anything else | 📄 |

**Priority** — from `priority.name`:

| Priority | | Priority | |
| --- | --- | --- | --- |
| Highest | 🔴 | Low | 🟢 |
| High | 🟠 | Lowest | 🔵 |
| Medium | 🟡 | Unset / unknown | ⚫ |

**Status** — derive the colour from `status.statusCategory.key`, **not** from the status name:

| Category | | Meaning |
| --- | --- | --- |
| `new` | ⚪ | Not started (To Do, Backlog, Open) |
| `indeterminate` | 🔵 | In flight (In Progress, TO REVIEW, Blocked) |
| `done` | 🟢 | Finished (Done, Merged, Rejected) |

Using the category means custom status names work automatically — a board with `TO REVIEW` or `Awaiting QA` colours correctly without anything hardcoded. This is the one place `statusCategory` is the *right* signal; for **choosing a transition** it's actively dangerous, since `Merged` and `Blocked` also report `indeterminate` (see Step 5).

Rules:

- Only use an icon when you have the real value. An unmatched priority name gets ⚫ rather than a guess — some projects rename their priorities.
- Keep the text alongside the icon. `🟡 Medium`, never a bare 🟡, so nothing is lost if emoji don't render.
- Don't invent fields. If `priority` wasn't returned, omit the row rather than showing ⚫ as though it were a real value.

> **Icons are for chat only.** Never put them in a branch name, commit message, Jira comment, MR title or MR description. Those are read by other people and by tooling, and a 🐛 in a commit subject is noise in `git log` forever.

1. **Branch type** — recommend one based on the ticket's issue type (Bug → a fix-style prefix, Story/Task → a feature-style prefix), choosing from the prefixes the repo actually uses in `git.branchNaming.dominantPrefixes`. State your recommendation and let the user override. If the scan found no clear convention, ask outright.
2. **Target branch** — phrase this based on what Step 2.1 actually found, rather than always asking the same question.

   **Epic branch exists:**

   > This ticket's epic **{EPIC-KEY}** already has a branch, `{epic-branch}`. Should I branch from it and pull the latest, or from `{git.integrationBranch}`?

   Lead with the epic branch, since a ticket under an epic with an active branch usually belongs on it — but don't assume, because epic branches are sometimes stale or abandoned.

   **Epic exists but has no branch:**

   > Target branch: `{git.integrationBranch}`. This ticket sits under epic **{EPIC-KEY}**, which has no branch, so `{git.integrationBranch}` is the right base unless you want an epic branch created first.

   **No epic at all:**

   > Target branch: `{git.integrationBranch}` — confirm, or name a different base.

   Name the branch you're proposing and accept an override. Only explain where it came from if it's likely to surprise — e.g. `git.integrationBranchSource` is `default-branch` because the repo has no `develop`, so work is going onto `main` directly.
3. **Time estimate** — **check `timetracking.originalEstimate` (Step 1) before asking anything**, and phrase the question differently depending on what's there:

   **Already has an estimate** — don't propose a fresh number as though none existed; that overwrites a figure someone (possibly the user, in an earlier session, or someone during grooming) already committed to. Ask whether to keep it:

   > This ticket already has an estimate of **`{originalEstimate}`**. Keep it, or add more time / set a new figure?

   **No estimate set** — "How long do you estimate this will take? (e.g. `2h`, `4h`, `1d`)". Always ask. The user may decline, but never silently skip the question.

   Offer a suggestion based on the ticket's scope and issue type — a single-file style fix ≈ `3h`, a small logic change ≈ `4h`, a multi-view feature ≈ `2d` — and let them confirm or adjust. Never set an estimate without the user agreeing to the number.

   **Suggest a single value, never a range.** `timetracking.originalEstimate` accepts one duration (`30m`, `2h`, `1d`, `1w`, or a combination like `1d 4h`); it cannot store `2-4h`. Proposing a range means either Step 6 fails or you quietly pick one end on the user's behalf. If you're genuinely torn between two figures, offer the higher one and say why.

   Say plainly that any figure you propose is a guess made **before** reading the code — Steps 7 and 8 haven't run yet, so you have the ticket description and nothing else. The user's own number wins by default.

   **"Add more time" means increasing `originalEstimate`, not logging a worklog.** `timetracking.originalEstimate` is the plan set before work starts; a worklog (Step 7 in this skill's counterpart, `close-ticket`) is time actually spent after the fact. If the user wants to bump `2h` to `5h` here, that's still a Step 6 `editJiraIssue` call against `originalEstimate` — don't route it through the worklog API by mistake.
4. **Moving the ticket to In Progress and assignment** — tell them you'll transition it (naming its current status) and ask them to confirm. If the ticket is unassigned, include the explicit assignment offer from Step 1 in the same question. Consent to transition is not automatically consent to assignment, or vice versa.
5. **Scope check** — ask them to confirm your understanding of the scope before you start.

> If Step 2.1 found an existing branch for this ticket, skip only the **branch-type** question — the branch name is known, but its intended MR target is not. Resolve or confirm `{TARGET}` using the rules in Step 2.1.1 above, then still ask about estimate, In Progress/assignment consent and scope.

**Wait for answers before proceeding.** Do not create the branch, transition the ticket, set the estimate, or touch any code until the user has responded to this batch.

### If the reply doesn't cover everything

A short reply like "yes", "go ahead", or "looks good" is common, and it does **not** answer five separate questions. Work out what was actually answered and treat the rest as outstanding:

- **Branch type and target** — a blanket yes can reasonably be read as accepting your stated recommendations, since you named specific values.
- **Time estimate** — if you proposed a figure (or asked "keep or change") and they said yes/keep, use that. If you didn't ask, or they ignored it, ask once more or skip it; never invent a number, and never overwrite an existing estimate on a bare "go ahead."
- **In Progress consent** — ⚠️ **never inferred.** This changes a ticket other people watch. If the reply doesn't clearly cover it, ask before transitioning. "Go ahead" on a scope question is not permission to move a ticket on the board.
- **Assignment consent** — ⚠️ **independent from transition consent.** If the ticket is unassigned, apply assignment only when the reply clearly accepts that offer. A bare approval of the branch or status leaves it unassigned.
- **Scope** — if they didn't engage with your summary, ask before writing code. Silence isn't agreement that you understood the ticket.

When something is genuinely ambiguous, do Step 4 (the branch — local, reversible, and clearly implied by "go ahead") and then ask the one outstanding question rather than stalling the whole workflow or assuming your way through it.

### 🛑 When the answers arrive — Steps 4, 5, 6 come first, in that order

The moment the user replies, your **next three actions** are Step 4, then Step 5, then Step 6, with nothing in between. Before you read, search, or edit **any** project file, all three must be done:

- [ ] **Step 4** — branch created or switched to, with `{TARGET}` recorded
- [ ] **Step 5** — approved assignment applied (or explicitly declined), then ticket moved to In Progress
- [ ] **Step 6** — estimate kept, changed, set, or explicitly declined

**These are setup, not finalisation.** Do not treat Steps 4–6 as bookkeeping to tidy up once the fix is written. Observed failure: an agent diagnosed the bug, wrote the fix, and only then said *"now let's set up the branch, transition the ticket, and set the estimate before I finalize"* — running all three correctly, but after the work. That ordering is wrong even when every individual step succeeds.

**Why the branch cannot wait.** Step 2.2 may have found you standing on a different ticket's branch. Editing before Step 4 means:

- Your edits sit on another ticket's branch. Git will carry uncommitted changes across a later `checkout`, so this can *appear* to work — but only by luck. If the pull in Step 4 touches any file you edited, you get a conflict or a refused checkout, with changes you haven't committed anywhere.
- You reasoned about the code **before** `git pull`, so your fix was written against a stale base. Step 4 pulls the target branch first for exactly this reason.

The checkout takes about ten seconds. Untangling one ticket's work from another's does not.

**If the answer brings new information, this is when the ordering is most likely to break.** Screenshots, designs, a corrected scope, extra requirements — that material is concrete and actionable, and it pulls hard toward implementation. When it happens:

1. Acknowledge the new information in one line, so the user knows you took it in
2. Note what it changes for Steps 7–9
3. **Still complete Steps 4, 5 and 6 before touching code**

An attachment or a scope correction is never a reason to skip branch setup. If the new information invalidates an answer the user just gave — a design that makes it clearly a bigger job than the agreed estimate, say — do Step 4 first, then raise it before Step 6, rather than silently proceeding or silently reworking.

Never run the transition or estimate mid-task, and never after the fix is already written. "I'll set these up before I finalise" is the wrong instinct — by then the branch has already failed to do its job.

If you realise you've written code before completing Steps 4–6, don't quietly carry on. Say so, get onto the correct branch, and tell the user the edits were made against a base that hadn't been pulled yet so they can judge whether a re-check is warranted.

## Step 4 — Git Branch Setup

Let `{TARGET}` be the authoritative target branch confirmed in Step 3, `{type}` the confirmed branch prefix, and `{TICKET-KEY}` the full ticket key as given.

### Flow A: New branch (from the integration branch or an epic branch)

The commands are identical either way — `{TARGET}` already carries whichever base Step 3 confirmed (integration branch or epic branch), so there's nothing left to branch on:

```bash
git fetch origin {TARGET}
git checkout {TARGET}
git merge --ff-only origin/{TARGET}
git checkout -b {type}/{TICKET-KEY}
```

### Flow B: Existing branch (found in Step 2.1)

If it exists on the remote (`remoteOnly` or both):

```bash
git fetch origin {existing-branch-name}
git checkout {existing-branch-name}
git merge --ff-only origin/{existing-branch-name}
```

If the fast-forward fails, stop and show ahead/behind state. Never create an incidental merge commit or begin a rebase during ticket setup.

If it's local only (`localOnly: true`), skip the pull — there's no upstream yet:

```bash
git checkout {existing-branch-name}
```

Say which case applied, so an absent `git pull` doesn't look like an omission.

### Branch naming

Follow the convention the scan observed in `git.branchNaming`, not a hardcoded one. This workflow supports **one Jira ticket per branch**:

- `{type}/{TICKET-KEY}` — e.g. `feature/PROJ-1234` or `fix/PROJ-1234`

If the user asks to combine several tickets, stop and use separate branches or explicitly design a multi-ticket close flow first. `close-ticket` updates one Jira issue, one comment and one worklog; pretending a multi-key branch is fully supported would update only one ticket.

Use lowercase for the `{type}` segment. Match the ticket key's own casing (`git.branchNaming.ticketKeyCase` tells you what the repo does). Keep the prefix from the actual ticket key — never substitute a different one.

## Step 5 — Assign (when approved), then Move the Ticket to In Progress

Right after the branch is created (immediately following Step 4, before any code investigation or changes), act on the separate assignment and transition consents gathered in Step 3.

**Assignment is an explicit action, not an offer that can be forgotten.** If the ticket was unassigned and the user approved assignment, call `editJiraIssue` with the authenticated user's account ID before transitioning, then report the resulting assignee. If assignment fails, report it and ask whether to continue; never claim it succeeded. If they declined, leave it unassigned and say so. If it was already assigned, do nothing.

Then handle the status transition below.

**Never guess transition names.** They vary per project — "Start Progress", "In Development", "Start work", "Begin". Always read the available transitions first.

### ⚠️ Match on `to.name`, never on `to.statusCategory`

`statusCategory` is a coarse Jira bucket with only three values (`new`,
`indeterminate`, `done`), and the `indeterminate` bucket is *displayed* as
"In Progress". Many unrelated statuses fall into it. A real example:

```json
{ "name": "Mark change as accepted", "to": { "name": "Merged",    "statusCategory": { "name": "In Progress" } } }
{ "name": "Blocked",                 "to": { "name": "Blocked",   "statusCategory": { "name": "In Progress" } } }
{ "name": "Edit visibility",         "to": { "name": "TO REVIEW", "statusCategory": { "name": "In Progress" } } }
```

All three report `statusCategory.name === "In Progress"`. None of them is In
Progress. Matching on the category here would mark the ticket **Merged** — a
destructive, hard-to-explain change to a real ticket.

So: compare against `to.name`, and treat `statusCategory` as unreliable for this
decision.

**The safe test is a positive one, and the names below are examples rather than
boundaries.** Apply a transition only when its `to.name` is unambiguously an
active-development status *on this board*. `In Progress`, `In Development` and
`Doing` are confirmed cases, but a project may equally call it `Started`,
`Implementing`, or `In Dev`. A name you recognise as active is a green light; a
name you don't recognise is a question for the user, not a near-match to pick
from.

**The forbidden names are not a safe-list in disguise.** `Merged`, `Rejected`,
`Blocked`, `Closed`, `Done`, and a self-loop back to the current status are all
confirmed wrong targets — but a name's *absence* from that list is never
evidence that it's safe. `Cancelled`, `Won't Do`, `Archived`, `Released`, and
whatever else this project invented are equally wrong and equally unlisted.

**When nothing reachable is unambiguously active, stop and show the user the
full set.** Report every reachable `to.name` and ask which one means "actively
being worked on" here, rather than picking the closest-looking option. Guessing
wrong writes a destructive, hard-to-explain change to a ticket other people
watch; asking costs one message.

### Procedure

1. Call `getTransitionsForJiraIssue` with the resolved `cloudId` to see what's reachable **from the ticket's current status**.
2. **Already in progress?** Say so and skip the rest.
3. **A transition whose `to.name` is unambiguously an active-development status?** Use it. Done.
4. **No direct path?** This is common and expected — verified on a real board, where TO REVIEW offered no route to In Progress at all. Many workflows require an intermediate hop, typically backwards to a backlog/open state (`To Do`, `Open`, `Backlog`, `Reopened` are the common names, not the only ones), then forward. When that's the case:
   - Pick an intermediate whose `to.name` is unambiguously a backlog/open state. In the real example above, `To Do` was the only valid choice among five transitions — `Merged`, `Rejected`, `Blocked` and the self-loop were all dead ends. If no candidate is unambiguous, show the reachable set and ask instead of taking the closest match — the same rule as choosing the active status above.
   - Tell the user what you're about to do and why: *"`{TICKET}` is in `{status}`, which has no direct transition to In Progress. I'll move it to `{intermediate}` first, then to In Progress."*
   - Do the first hop, call `getTransitionsForJiraIssue` **again** to confirm the second hop is now available, then do it.
   - Don't chain more than two hops without asking. Beyond that, show the user the workflow you're seeing and let them decide.
   - If no valid intermediate exists, stop and report — don't force a path through a terminal status.
5. **Blocked by a set Resolution.** A reopened ticket can refuse transitions while it still carries a Resolution. If an error suggests that, **say what you intend to do before doing it**:

   > `{TICKET}` won't transition because it still has Resolution `{value}` set from when it was closed. Clearing that should unblock it. Clear it and retry?

   The user consented to a status change, not to editing other fields, so ask rather than announcing it afterwards. Once they agree:

   ```
   editJiraIssue → cloudId: {resolved}, issueIdOrKey: {TICKET-KEY}, fields: { "resolution": null }
   ```

   Retry the transition once. If it still fails, go to point 6 rather than trying more field edits.
6. **If a transition fails, surface it — never continue silently and never report success.** Report all three of:
   - the exact error Jira returned
   - the ticket's current status, unchanged
   - the transitions that *are* available right now

   Then ask how to proceed, or offer to leave the status alone and move on. A ticket left in the wrong status is a minor annoyance; a workflow that *claims* it moved the ticket when it didn't is a real problem, because the user stops checking.
7. **If Jira tools are unavailable**, say so and ask the user to move it manually.

## Step 6 — Set the Time Estimate

Also happens right after Step 4/5, before any code changes. Use the answer from Step 3.

**If the user chose to keep the existing estimate, skip this call entirely** — there's nothing to write, and calling `editJiraIssue` with the same value it already had risks an unnecessary update on the ticket's history for no reason.

If the user set a new figure or changed an existing one:

```
editJiraIssue → cloudId: {resolved in Step 1}, issueIdOrKey: {TICKET-KEY},
                fields: { timetracking: { originalEstimate: "{estimate}" } }
```

`originalEstimate` takes a single duration string — `30m`, `2h`, `1d`, `1w`, or a combination like `1d 4h`. **A range such as `2-4h` is invalid.** If the user replied with one, ask which single value they want rather than picking for them.

If they declined, or Jira tools are unavailable, move on. As with Step 5, if the call fails, say so rather than assuming it worked.

## Step 7 — Pre-Coding Checklist

> **Precondition — verify before continuing.** Steps 4, 5 and 6 must already be
> done. Confirm you are on the ticket's branch (`git branch --show-current`),
> that the ticket is In Progress, and that the estimate was set or declined. If
> any of those is outstanding, go back and do it now — before reading or editing
> a single project file. Arriving here with the branch unswitched means the work
> is about to land on the wrong branch.

A quick conversation, not a gate. Mention anything the user hasn't already covered:

- [ ] Existing files to modify, or new modules/components needed?
- [ ] New UI/screens — is there a design or mockup to follow?
- [ ] Does this ticket depend on or block other tickets?
- [ ] Any API changes needed, or does the relevant layer already expose what's required?

**Commands and builds:**

- Prefer `commands.lint` / `commands.test` from the scan. Fall back to `packageManager.runCommandPrefix` + a script name only when `commands` is `null` for that task — and never hardcode `pnpm` / `npm` / `yarn`.
- **Do not run a full production build** as part of ticket setup; it's slow and rarely tells you anything useful this early. Rely on IDE diagnostics and lint, unless the user explicitly asks for a build.

## Step 8 — Navigation Guide (when the ticket touches a reachable screen or flow)

If the ticket affects something a user can actually navigate to — a screen, a form, a flow, a visible behavior — work out the exact steps to reach it **before** touching code, so the user can reproduce the current behavior first. Repeat the same steps after the change so they can verify.

> **How to test:**
>
> 1. Log in with `{credentials, if known}`
> 2. Navigate to **{Section}** → **{Sub-section}** → **{Screen}**
> 3. Do X, Y, Z
> 4. Expected: … / Current bug: …

Rules:

- Search the codebase for the relevant route, menu config, and view files to derive the real path — don't invent it
- Mention any required role, permission, or feature flag
- If the path isn't clear from the code, say so and ask rather than guessing

**Skip this step** when there's nothing to navigate to — build config, CI, tooling, dependency bumps, pure refactors, docs, or non-visual internal changes. Say briefly why it doesn't apply and move on.

## Step 9 — Spec Creation (optional)

For a complex ticket (multiple views, new flows, API integration), **propose** a spec at `.kiro/specs/{TICKET-KEY}-{short-description}/`, using the same ticket key as the branch. Say what it would contain and wait for agreement — don't create the folder and files first. A spec the user didn't want is clutter they have to notice and delete.

For small tickets (single file, style fix, minor logic change), skip the spec and go straight to implementation.

## Step 9.5 — Before you edit: show the plan when the change isn't trivial

Step 3's scope check confirmed you understood the *ticket*. It did not approve an *implementation*. Scale what you do next to the size of the change.

**Go straight ahead** for a genuinely small, obvious change — one file, a few lines, no ambiguity about the fix. Announce what you're changing as you do it. Pausing for approval on a one-line fix is friction with no benefit.

**Show the plan first** when any of these is true:

- More than about three files are affected
- Anything shared changes — an interface, a public API, a model, a shared component
- Files get created, moved, renamed or deleted
- There's more than one reasonable approach and you had to pick
- A dependency is added or a config file changes
- The change turns out bigger than the estimate the user just agreed to

The plan is short — the files you'll touch and the approach in a sentence or two:

> This needs three files: `x.ts` (add the filter), `y.model.ts` (new field), `z.spec.ts` (cover it). I'd do it by … rather than … because … Sound right?

Then wait. The point isn't ceremony; it's that a wrong approach caught in one message costs seconds, while one caught after fifteen file edits costs a review cycle.

**If the change grows while you're in it** — you start with one file and find it needs six — stop and say so rather than pressing on. That's the moment the estimate and possibly the scope stopped being accurate, and the user should know while it's still cheap.

### Required validation evidence (before self-review)

After implementation, validate the actual changed behavior and keep a compact evidence block for the wrap-up:

- **Diagnostics/type check** — run IDE diagnostics or the narrowest type-check command; record command/tool and result.
- **Targeted tests** — run the smallest relevant test set for changed behavior; record command and result, or why no applicable test exists.
- **Lint** — run the narrowest relevant `commands.lint`; record command and result.
- **Smoke test** — perform the Step 8 path when applicable, or state why it could not be run.
- **Build** — only when the change requires it or the user asks; otherwise state that it was deferred to CI.

Every skipped check stays visible. Do not replace evidence with "verified" or "lint passes" without naming what ran.

## Step 9.6 — Self-review before offering to wrap up

Once the change is written and verified, do this before saying anything about
committing. **Don't wait for the user to point you at a review checklist** — a
user who has to paste a steering-file reference to get it applied is the
workflow failing to do its own job.

1. **Search for review conventions, judged by description, not filename.**
   Projects name these anything — `code-review-self.md`, `pre-flight.md`,
   `definition-of-done.md`. Check `.kiro/steering/` (including files marked
   `inclusion: manual`, which aren't already in your context), any
   `.kiro/skills/` directory, and repo-root rule files under whatever name this
   project uses (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*.mdc`,
   `.github/copilot-instructions.md`, and equivalents). Read each candidate's
   own description and judge whether it's about reviewing, verifying, or
   checking work before it ships — not whether its filename contains "review".
2. **If you find one, name it and fold the offer into the wrap-up question**
   below rather than asking twice:

   > The fix is in and lint passes. I found `.kiro/steering/code-review-self.md`
   > — its description says it's a self-review checklist. Want me to check the
   > changes against it, and then wrap up the ticket (commit, push, open the MR)?

3. **If they say yes, apply it against the actual diff** (`git diff`), not from
   memory of what you changed. Only the items relevant to the files you
   touched. If it changes anything, re-run every affected validation check from
   the evidence block above and report the updated diff/evidence before offering
   wrap-up again. A checklist result never authorizes committing bytes the user
   has not seen.

   **Do not resolve this offer yourself before presenting it.** The offer and the
   wrap-up question belong **together, in one message**, exactly as shown above.
   Forbidden: pre-empting that single combined message by asking the checklist
   question on its own first, answering it yourself with a generic pass ("I did a
   quick pass myself"), then sending the wrap-up text as if "let me know,
   otherwise I'll wrap up" counted as the user's reply — it doesn't, the named
   checklist was never actually run. Same standard as any other unverified claim
   in this workflow: never report a finding or count attributed to the checklist
   unless you actually opened its content and followed it. Ask the combined
   question exactly once, as one message, and wait for the actual reply.
4. **If nothing describes itself that way, say so — don't skip silently.** Fold
   a one-line "checked {where you looked}, nothing found describing itself as a
   review checklist" into the same wrap-up message from Step 10, then ask the
   plain wrap-up question. A search that finds nothing and says nothing is
   indistinguishable, from the user's side, from a search that never ran —
   don't manufacture a checklist offer where none exists, but always report
   that you looked.

This runs once, here, before Step 10's question — not repeated if the user asks
for another round of changes later in the same ticket.

## Step 10 — Where this skill ends

This skill covers **starting** a ticket and implementing it. It stops there.

Once the change is written and verified locally, **stop and hand back to the user.** Do not:

- ❌ `git commit`
- ❌ `git push`
- ❌ Create a merge request or pull request
- ❌ Transition the ticket to review
- ❌ Log time spent

All of that belongs to **`close-ticket`**, which the user invokes when *they* decide the work is done — by saying "close ticket", "wrap up", "create an MR", or similar.

**Why this boundary is firm.** `close-ticket` isn't a formality wrapped around `git commit`; it's a sequence of checks that only work when run deliberately:

- Reverting linter/formatter config changed for local convenience, with the diff shown and confirmed per file
- Catching unstaged files that belong to the ticket, and stopping outright on anything resembling a secret
- Showing the user `git diff {target}...HEAD --stat` and getting **their** confirmation — reviewing your own diff and declaring it correct is not the same thing
- Deciding what to do about a pre-push hook that runs a full build, which is the user's call
- Checking whether an MR already exists before creating a duplicate
- Confirming the MR target, title, description, assignee and reviewer before anything is created

Committing from here bypasses all of it. Observed in practice: an agent finished a one-line fix, reviewed its own diff, and moved straight to commit and push having never been asked to.

A user answering "go ahead" to the Step 3 scope question is authorising **implementation**, not commits. If you think the work is finished, say so and offer:

> The fix is in and lint passes. Want me to wrap up the ticket — commit, push and open the MR?

(If Step 9.6 found and ran a self-review checklist, that offer already covers this question — don't ask it twice.)

Then wait. If the user explicitly asks you to commit and push in the same breath as approving the work, that's fine — read `close-ticket` and follow it properly rather than improvising a shortened version.

## Quick Reference

`{TARGET}` = the existing MR/PR base or the branch explicitly confirmed in Step 3. `git.integrationBranch` is only a candidate when no stronger target evidence exists. `{type}` = a prefix from `git.branchNaming.dominantPrefixes`.

| Step | Action |
| --- | --- |
| 0. Scan | `get_project_profile` — branch names, commit format, package manager, hooks |
| 1. Validate | URL/key actually an Atlassian issue reference? Read failed (404/permission)? → **stop**, don't guess a variant |
| 1. Read ticket | Resolve `cloudId`, then **`getJiraIssue` with `fields: ["*all"]`, `expand: "names"`**. Resolve direct parent → epic with a bounded lookup; use display-name-based Epic Link only as a verified fallback |
| 1. Sanity-check | Assignee vs current user (`atlassianUserInfo`) → flag if someone else's, offer to assign if unassigned. Status category `done` → **stop**; `indeterminate` under another name → **stop** |
| 2.1 Existing branches | Re-scan with `ticket_keys: [ticket, epic]` — never create a duplicate branch |
| 2.1.1 Target | Existing MR/PR base wins; new branch uses the confirmed base; existing branch without an MR/PR requires the user to confirm `{TARGET}` |
| 2.2 Branch state | Check current branch, prefix mismatch, dirty tree and detached HEAD. Dirty tree → stay/end or named stash; never carry it across |
| 3. Confirm | Branch type + authoritative target + **time estimate** + separate In Progress and assignment consent + scope, in one message |
| 4. Branch | Fetch `{TARGET}`, fast-forward only, then create/switch. Stop on divergence; never merge/rebase implicitly |
| 5. Assign + In Progress | Apply approved assignment explicitly, then `getTransitionsForJiraIssue` and transition; report failures before touching code |
| 6. Estimate | Keep, change, set, or explicitly decline `timetracking.originalEstimate`; never confuse planned estimate with a worklog |
| 7. Checklist | Files, designs, dependencies, API needs |
| 8. Navigation | Only when there's a reachable screen |
| 9. Spec | Only for complex tickets — **propose it, don't create it unasked** |
| 9.5 Plan + validate | Show non-trivial implementation plan; capture diagnostics, targeted tests, lint, smoke-test and build evidence |
| 9.6 Self-review | Discover review guidance by description. Checklist mutations require affected validation and the updated diff to be shown again |
| 10. Stop | Implement, then hand back. **No commit, push, MR, review transition or worklog** — that's `close-ticket`, invoked by the user |

| Scenario | Branch from | Branch name | Merge to |
| --- | --- | --- | --- |
| New feature, no epic | `{TARGET}` | `feature/{TICKET-KEY}` | `{TARGET}` |
| Bug fix, no epic | `{TARGET}` | `fix/{TICKET-KEY}` | `{TARGET}` |
| Ticket under active epic | `{TARGET}` (confirmed epic branch) | `{type}/{TICKET-KEY}` | `{TARGET}` |
| Continue existing work | existing branch | (already named) | existing MR/PR base, or user-confirmed `{TARGET}` |

This workflow supports one Jira ticket per branch. `{TICKET-KEY}` always uses the prefix from the actual ticket — never a hardcoded project.
