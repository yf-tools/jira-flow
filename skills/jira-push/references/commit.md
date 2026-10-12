# Commit Message Conventions

Use the convention discovered by `git-prep.mjs` in `commitConvention.suggestedFormat` or recent `git log`.

## 1. Conventional Commits with Ticket Scope

When the scan reports conventional commits, format commit messages as:
`{type}({TICKET-KEY}): {imperative summary}`

Examples:

- `fix(PROJ-4703): clear auth state on credential re-entry`
- `feat(PROJ-2167): enable next button on employment step`
- Multiple tickets: `fix(PROJ-4861/4862): history screen fixes`

## 2. General Commit Rules

- Use lowercase for the commit type (`feat`, `fix`, `refactor`, `chore`, `test`).
- Write in imperative mood ("add", "fix", "remove", not "added" or "fixing").
- Do not exceed 72 characters on the subject line.
- If the repository uses `ticket-key-prefix` (e.g. `[PROJ-123] ...`) or freeform commits, adhere to the detected pattern.
