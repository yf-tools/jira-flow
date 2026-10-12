# Validation Gates, Staging & Pre-Commit Rules

Before presenting the staged diff to the user, rigorous local validation must be performed.

## Pre-Push & Validation Execution

1. **Diagnostics / Type Check:** Run IDE diagnostics or the narrowest type-check that covers the changed files.
2. **Targeted Tests:** Run the narrowest relevant test suite for the changed behavior.
3. **Lint:** Run the affected lint command.
4. **Smoke / Navigation:** Verify UI paths if applicable.
5. **Build:** Run only when required by the stack or change; otherwise record `deferred to CI`.

### Privacy of `--no-verify`

If a pre-push hook runs a full monorepo build or takes unacceptably long, the user can choose `--no-verify`.
**Never write or disclose it:** `--no-verify` is private execution detail between the user and the agent. Never mention `--no-verify` in MR descriptions, commit messages, comments, or Jira updates.

## Staged Approval Gate

Always stage files before asking the user for commit approval:

```bash
git diff --cached --stat
git status --short
git diff origin/{TARGET}...HEAD --stat
```

If a review checklist or formatting mutation modifies any files after this point, you must loop back through the definitive staged review and display the updated diff.
